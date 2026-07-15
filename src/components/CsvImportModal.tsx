"use client";

import { useMemo, useState } from "react";
import Papa from "papaparse";
import { collection, doc, getDocs, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Pair, Transaction, TransactionType } from "@/types";
import { formatAmount } from "@/utils/currency";
import toast from "react-hot-toast";

interface CsvImportModalProps {
  pair: Pair;
  userId: string;
  onClose: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5;
type FieldKey = "ignore" | "amount" | "direction" | "description" | "date" | "type";
type Direction = "i_paid" | "they_paid";
type CsvRow = Record<string, string>;

interface ParsedRow {
  rowNumber: number;
  amount: number | null;
  direction: Direction | null;
  description: string;
  date: Date;
  type: TransactionType | null;
  errors: string[];
  fingerprint: string | null;
  duplicate: boolean;
}

interface ImportResult {
  imported: number;
  skippedDuplicates: number;
  rejected: number;
  failed?: string;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 20_000;
const BATCH_SIZE = 400;

const FIELD_OPTIONS: Array<{ value: FieldKey; label: string; required?: boolean }> = [
  { value: "ignore", label: "— Ignore —" },
  { value: "amount", label: "Amount", required: true },
  { value: "direction", label: "Direction (who paid)" },
  { value: "description", label: "Description" },
  { value: "date", label: "Date" },
  { value: "type", label: "Type (payment/request)" },
];

const HEADER_HEURISTICS: Array<{ expression: RegExp; field: FieldKey }> = [
  { expression: /^(amount|amt|total|sum|value|price|cost|paid)$/i, field: "amount" },
  { expression: /^(direction|paid by|payer|who paid|side|flow)$/i, field: "direction" },
  { expression: /^(description|desc|note|notes|memo|details|reason|for)$/i, field: "description" },
  { expression: /^(date|when|event date|tx date|transaction date|created at)$/i, field: "date" },
  { expression: /^(type|kind|category|transaction type)$/i, field: "type" },
];

function autoMap(headers: string[]): Record<string, FieldKey> {
  const used = new Set<FieldKey>();
  return Object.fromEntries(headers.map((header) => {
    const match = HEADER_HEURISTICS.find(({ expression, field }) => expression.test(header.trim()) && !used.has(field));
    if (match) used.add(match.field);
    return [header, match?.field ?? "ignore"];
  }));
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateAtNoon(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function parseDate(value: string): Date | null {
  const text = value.trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const slash = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  let date: Date | null = null;
  if (iso) {
    date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12);
  } else if (slash) {
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    // Slash dates are interpreted as month/day/year, matching the app's US locale.
    date = new Date(year, Number(slash[1]) - 1, Number(slash[2]), 12);
  } else {
    const parsed = new Date(text);
    date = Number.isNaN(parsed.getTime()) ? null : dateAtNoon(parsed);
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() < 1900 || date.getFullYear() > 2100) return null;
  return date;
}

function parseAmount(value: string): { amount: number | null; negative: boolean } {
  const raw = value.trim();
  if (!raw) return { amount: null, negative: false };
  const negative = raw.includes("-") || /^\(.*\)$/.test(raw);
  let numeric = raw.replace(/[()\sA-Za-z$£€¥₹₩₽₺₪]/g, "").replace(/-/g, "");
  const comma = numeric.lastIndexOf(",");
  const dot = numeric.lastIndexOf(".");
  if (comma !== -1 && dot !== -1) {
    const decimal = comma > dot ? "," : ".";
    numeric = decimal === ","
      ? numeric.replace(/\./g, "").replace(",", ".")
      : numeric.replace(/,/g, "");
  } else if (comma !== -1 && /^\d{1,3}(,\d{3})+$/.test(numeric)) {
    numeric = numeric.replace(/,/g, "");
  } else if (comma !== -1) {
    numeric = numeric.replace(",", ".");
  }
  const amount = Number(numeric);
  return { amount: Number.isFinite(amount) ? Math.abs(amount) : null, negative };
}

function parseDirection(value: string): Direction | null {
  const normalized = value.trim().toLowerCase().replace(/[._-]/g, " ").replace(/\s+/g, " ");
  if (!normalized) return null;
  if (/^(i|me|myself|you|outgoing|payment|paid|i paid|paid by me|debit)$/.test(normalized)) return "i_paid";
  if (/^(they|them|partner|other|incoming|request|received|they paid|paid to me|credit)$/.test(normalized)) return "they_paid";
  return null;
}

function parseType(value: string): TransactionType | null {
  const normalized = value.trim().toLowerCase();
  if (["payment", "paid", "expense"].includes(normalized)) return "payment";
  if (["request", "requested", "receive", "received"].includes(normalized)) return "request";
  if (["adjustment", "adjust"].includes(normalized)) return "adjustment";
  return null;
}

function normaliseDescription(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function fingerprintFor(row: Pick<ParsedRow, "amount" | "type" | "description" | "date">): string | null {
  if (row.amount === null || !row.type) return null;
  const cents = Math.round(row.amount * 100);
  return ["v1", formatDateKey(row.date), row.type, cents, normaliseDescription(row.description).toLowerCase()].join("|");
}

function stableId(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    first = Math.imul(first ^ value.charCodeAt(index), 0x01000193);
    second = Math.imul(second ^ value.charCodeAt(value.length - 1 - index), 0x01000193);
  }
  return `import_${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function existingFingerprint(transaction: Transaction): string | null {
  if (transaction.importFingerprint) return transaction.importFingerprint;
  const timestamp = transaction.date?.toDate ? transaction.date.toDate() : transaction.createdAt?.toDate?.();
  if (!timestamp) return null;
  return fingerprintFor({
    amount: transaction.amount,
    type: transaction.type,
    description: transaction.description ?? "",
    date: timestamp,
  });
}

export default function CsvImportModal({ pair, userId, onClose }: CsvImportModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, FieldKey>>({});
  const [parseIssues, setParseIssues] = useState<string[]>([]);
  const [existingFingerprints, setExistingFingerprints] = useState<string[]>([]);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const importDate = useMemo(() => dateAtNoon(new Date()), []);

  const partnerIndex = pair.users.indexOf(userId) === 0 ? 1 : 0;
  const partnerName = pair.userNames[partnerIndex] || pair.userEmails[partnerIndex];
  const reverseMap = useMemo(() => {
    const reverse: Partial<Record<FieldKey, string>> = {};
    for (const [header, field] of Object.entries(mapping)) if (field !== "ignore" && !reverse[field]) reverse[field] = header;
    return reverse;
  }, [mapping]);
  const requiredMapped = Boolean(reverseMap.amount && (reverseMap.direction || reverseMap.type));

  const validatedRows = useMemo(() => rows.map((raw, index): ParsedRow => {
    const errors: string[] = [];
    const amountResult = parseAmount(reverseMap.amount ? raw[reverseMap.amount] ?? "" : "");
    const mappedType = reverseMap.type ? parseType(raw[reverseMap.type] ?? "") : null;
    const rawType = reverseMap.type ? raw[reverseMap.type]?.trim() : "";
    let direction = reverseMap.direction ? parseDirection(raw[reverseMap.direction] ?? "") : null;
    if (!direction && mappedType === "payment") direction = "i_paid";
    if (!direction && mappedType === "request") direction = "they_paid";
    if (!direction && amountResult.negative) direction = "i_paid";
    const type = mappedType ?? (direction === "i_paid" ? "payment" : direction === "they_paid" ? "request" : null);
    const description = normaliseDescription(reverseMap.description ? raw[reverseMap.description] ?? "" : "");
    const rawDate = reverseMap.date ? raw[reverseMap.date]?.trim() : "";
    const date = rawDate ? parseDate(rawDate) : importDate;

    if (amountResult.amount === null || amountResult.amount <= 0) errors.push("enter a positive amount");
    if (!direction) errors.push("map a direction or a payment/request type");
    if (rawType && !mappedType) errors.push("unknown transaction type");
    if (mappedType === "adjustment" && !direction) errors.push("adjustments need a direction");
    if (rawDate && !date) errors.push("invalid date");
    if (description.length > 200) errors.push("description is longer than 200 characters");

    const parsed: ParsedRow = {
      rowNumber: index + 2,
      amount: amountResult.amount,
      direction,
      description,
      date: date ?? importDate,
      type,
      errors,
      fingerprint: null,
      duplicate: false,
    };
    parsed.fingerprint = errors.length === 0 ? fingerprintFor(parsed) : null;
    return parsed;
  }), [rows, reverseMap, importDate]);

  const parsedRows = useMemo(() => {
    const known = new Set(existingFingerprints);
    return validatedRows.map((row) => {
      const duplicate = Boolean(row.fingerprint && known.has(row.fingerprint));
      if (row.fingerprint) known.add(row.fingerprint);
      return { ...row, duplicate };
    });
  }, [validatedRows, existingFingerprints]);
  const invalidCount = parsedRows.filter((row) => row.errors.length > 0).length;
  const duplicateCount = parsedRows.filter((row) => row.errors.length === 0 && row.duplicate).length;
  const readyRows = parsedRows.filter((row) => row.errors.length === 0 && !row.duplicate);

  function handleFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      toast.error("Choose a CSV smaller than 10 MB");
      return;
    }
    setFileName(file.name);
    setParseIssues([]);
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (parsed) => {
        const detectedHeaders = (parsed.meta.fields ?? []).map((field) => field.trim()).filter(Boolean);
        const data = parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
        if (!detectedHeaders.length) return toast.error("We couldn't find a header row in that CSV");
        if (new Set(detectedHeaders).size !== detectedHeaders.length) return toast.error("Column headers must be unique");
        if (data.length > MAX_ROWS) return toast.error(`This file has more than ${MAX_ROWS.toLocaleString()} rows. Split it into smaller files and try again.`);
        setHeaders(detectedHeaders);
        setRows(data);
        setMapping(autoMap(detectedHeaders));
        setExistingFingerprints([]);
        setParseIssues(parsed.errors.slice(0, 5).map((issue) => `Row ${issue.row ?? "?"}: ${issue.message}`));
        setStep(2);
      },
      error: (error) => toast.error(`We couldn't read that CSV: ${error.message}`),
    });
  }

  async function previewImport() {
    setChecking(true);
    try {
      const snapshot = await getDocs(collection(db, "pairs", pair.id, "transactions"));
      const fingerprints = snapshot.docs
        .map((item) => existingFingerprint({ id: item.id, ...item.data() } as Transaction))
        .filter((value): value is string => Boolean(value));
      setExistingFingerprints(fingerprints);
      setStep(3);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't check existing transactions");
    } finally {
      setChecking(false);
    }
  }

  async function importRows() {
    if (!readyRows.length) return;
    setImporting(true);
    setProgress({ done: 0, total: readyRows.length });
    const batchId = `csv_${Date.now().toString(36)}`;
    let imported = 0;
    let racedDuplicates = 0;
    try {
      for (let offset = 0; offset < readyRows.length; offset += BATCH_SIZE) {
        const slice = readyRows.slice(offset, offset + BATCH_SIZE);
        const written = await runTransaction(db, async (transaction) => {
          const refs = slice.map((row) => doc(db, "pairs", pair.id, "transactions", stableId(row.fingerprint!)));
          const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
          let count = 0;
          snapshots.forEach((snapshot, index) => {
            if (snapshot.exists()) return;
            const row = slice[index]!;
            transaction.set(refs[index]!, {
              pairId: pair.id,
              amount: row.amount!,
              type: row.type!,
              description: row.description || (row.direction === "i_paid" ? "Payment" : "Request"),
              createdBy: userId,
              status: "pending",
              date: Timestamp.fromDate(row.date),
              createdAt: serverTimestamp(),
              importFingerprint: row.fingerprint,
              importBatchId: batchId,
            });
            count += 1;
          });
          return count;
        });
        imported += written;
        racedDuplicates += slice.length - written;
        setProgress({ done: Math.min(offset + slice.length, readyRows.length), total: readyRows.length });
      }
      setResult({ imported, skippedDuplicates: duplicateCount + racedDuplicates, rejected: invalidCount });
      setStep(5);
    } catch (error) {
      setResult({
        imported,
        skippedDuplicates: duplicateCount + racedDuplicates,
        rejected: invalidCount,
        failed: error instanceof Error ? error.message : "Import stopped before all rows were written",
      });
      setStep(5);
    } finally {
      setImporting(false);
    }
  }

  const canContinue = readyRows.length > 0 && (invalidCount === 0 || skipInvalid);
  const stepLabel = step === 5 ? "Complete" : `Step ${step} of 4`;

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <section className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
      <header className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div><h2 className="text-base font-semibold">Import transactions from CSV</h2><p className="mt-0.5 text-xs text-gray-500">{stepLabel} · with {partnerName}</p></div>
        <button onClick={onClose} disabled={importing} className="text-xl leading-none text-gray-400 hover:text-gray-700 disabled:opacity-50" aria-label="Close">×</button>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {step === 1 && <UploadStep onFile={handleFile} />}
        {step === 2 && <MappingStep headers={headers} mapping={mapping} setMapping={setMapping} fileName={fileName} rowCount={rows.length} example={rows[0]} parseIssues={parseIssues} />}
        {step === 3 && <PreviewStep rows={parsedRows} currency={pair.currency} invalidCount={invalidCount} duplicateCount={duplicateCount} skipInvalid={skipInvalid} setSkipInvalid={setSkipInvalid} />}
        {step === 4 && <ConfirmStep ready={readyRows.length} invalid={invalidCount} duplicates={duplicateCount} partnerName={partnerName} importing={importing} progress={progress} />}
        {step === 5 && <ResultStep result={result} />}
      </div>
      <footer className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
        {step === 5 ? <span /> : <button onClick={() => step === 1 ? onClose() : setStep((current) => (current - 1) as Step)} disabled={importing || checking} className="text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50">{step === 1 ? "Cancel" : "Back"}</button>}
        {step === 2 && <button onClick={previewImport} disabled={!requiredMapped || checking} className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50">{checking ? "Checking…" : "Preview →"}</button>}
        {step === 3 && <button onClick={() => setStep(4)} disabled={!canContinue} className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50">Continue →</button>}
        {step === 4 && !importing && <button onClick={importRows} className="btn-primary px-4 py-1.5 text-sm">Import {readyRows.length.toLocaleString()} transaction{readyRows.length === 1 ? "" : "s"}</button>}
        {step === 5 && <button onClick={onClose} className="btn-primary px-4 py-1.5 text-sm">Done</button>}
      </footer>
    </section>
  </div>;
}

function UploadStep({ onFile }: { onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);
  return <div className="space-y-4">
    <p className="text-sm text-gray-600">Upload a CSV to add transactions in bulk. You will map columns, review every issue, and confirm before any records are created.</p>
    <label onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) onFile(file); }} className={`block cursor-pointer rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${dragging ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-gray-50 hover:border-gray-400"}`}>
      <input type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); }} />
      <p className="text-sm font-medium text-gray-700">Drop a CSV here, or click to browse</p><p className="mt-1 text-xs text-gray-500">Up to 10 MB or 20,000 rows. The first row must contain unique column names.</p>
    </label>
    <div className="rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-600"><p className="font-semibold text-gray-700">Supported formats</p><p>Amount is required. Provide either a direction (for example, “I paid” or “They paid”) or a type (“payment” or “request”). Descriptions and dates are optional.</p></div>
  </div>;
}

function MappingStep({ headers, mapping, setMapping, fileName, rowCount, example, parseIssues }: { headers: string[]; mapping: Record<string, FieldKey>; setMapping: (next: Record<string, FieldKey>) => void; fileName: string; rowCount: number; example?: CsvRow; parseIssues: string[] }) {
  const used = new Set(Object.values(mapping).filter((field) => field !== "ignore"));
  const update = (header: string, field: FieldKey) => {
    const next = { ...mapping };
    if (field !== "ignore") for (const [otherHeader, otherField] of Object.entries(next)) if (otherHeader !== header && otherField === field) next[otherHeader] = "ignore";
    next[header] = field;
    setMapping(next);
  };
  return <div className="space-y-4"><div><p className="text-sm text-gray-700"><span className="font-medium">{fileName}</span><span className="text-gray-500"> · {rowCount.toLocaleString()} rows</span></p><p className="mt-1 text-xs text-gray-500">We auto-mapped familiar names. Adjust anything that doesn&apos;t look right.</p></div>
    {parseIssues.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><p className="font-semibold">CSV formatting warnings</p>{parseIssues.map((issue) => <p key={issue}>{issue}</p>)}</div>}
    <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">{headers.map((header) => <div key={header} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-medium text-gray-800">{header}</p>{example?.[header] && <p className="truncate text-xs text-gray-400">Example: {example[header]}</p>}</div><span className="text-xs text-gray-400">→</span><select value={mapping[header] ?? "ignore"} onChange={(event) => update(header, event.target.value as FieldKey)} className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm">{FIELD_OPTIONS.map((option) => <option key={option.value} value={option.value} disabled={option.value !== "ignore" && used.has(option.value) && mapping[header] !== option.value}>{option.label}{option.required ? " *" : ""}</option>)}</select></div>)}</div>
    <p className="text-xs text-gray-500">* Amount is required. Also map Direction or Type; a payment/request type supplies the direction automatically.</p>
  </div>;
}

function PreviewStep({ rows, currency, invalidCount, duplicateCount, skipInvalid, setSkipInvalid }: { rows: ParsedRow[]; currency: string; invalidCount: number; duplicateCount: number; skipInvalid: boolean; setSkipInvalid: (value: boolean) => void }) {
  const preview = rows.slice(0, 30);
  const ready = rows.length - invalidCount - duplicateCount;
  return <div className="space-y-3"><div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">{ready.toLocaleString()} ready</span>{duplicateCount > 0 && <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700">{duplicateCount.toLocaleString()} duplicate{duplicateCount === 1 ? "" : "s"} skipped</span>}{invalidCount > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">{invalidCount.toLocaleString()} need attention</span>}<span className="ml-auto text-gray-500">Showing {preview.length} of {rows.length.toLocaleString()}</span></div>
    <div className="overflow-x-auto rounded-lg border border-gray-200"><table className="min-w-full text-xs"><thead className="bg-gray-50 uppercase tracking-wide text-gray-500"><tr><th className="px-2 py-2 text-left">Row</th><th className="px-2 py-2 text-left">Amount</th><th className="px-2 py-2 text-left">Direction</th><th className="px-2 py-2 text-left">Description</th><th className="px-2 py-2 text-left">Date</th><th className="px-2 py-2 text-left">Result</th></tr></thead><tbody className="divide-y divide-gray-100">{preview.map((row) => <tr key={row.rowNumber} className={row.errors.length ? "bg-red-50" : row.duplicate ? "bg-blue-50" : "bg-white"}><td className="px-2 py-1.5 text-gray-400">{row.rowNumber}</td><td className="px-2 py-1.5">{row.amount ? formatAmount(row.amount, currency) : "—"}</td><td className="px-2 py-1.5">{row.direction === "i_paid" ? "You paid" : row.direction === "they_paid" ? "They paid" : "—"}</td><td className="max-w-[190px] truncate px-2 py-1.5 text-gray-600">{row.description || "—"}</td><td className="whitespace-nowrap px-2 py-1.5 text-gray-600">{formatDateKey(row.date)}</td><td className="px-2 py-1.5 text-red-600">{row.errors.join("; ") || (row.duplicate ? <span className="text-blue-700">duplicate — skipped</span> : <span className="text-green-700">ready</span>)}</td></tr>)}</tbody></table></div>
    {invalidCount > 0 && <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={skipInvalid} onChange={(event) => setSkipInvalid(event.target.checked)} className="rounded border-gray-300" />Skip the {invalidCount.toLocaleString()} invalid row{invalidCount === 1 ? "" : "s"} and import the rest</label>}
  </div>;
}

function ConfirmStep({ ready, invalid, duplicates, partnerName, importing, progress }: { ready: number; invalid: number; duplicates: number; partnerName: string; importing: boolean; progress: { done: number; total: number } }) {
  if (importing) {
    const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return <div className="space-y-3 py-4"><p className="text-sm text-gray-700">Importing {progress.done.toLocaleString()} of {progress.total.toLocaleString()}…</p><div className="h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full bg-blue-500 transition-all" style={{ width: `${percent}%` }} /></div></div>;
  }
  return <div className="space-y-3 py-2"><p className="text-sm text-gray-700">Ready to import <span className="font-semibold">{ready.toLocaleString()}</span> pending transaction{ready === 1 ? "" : "s"} with {partnerName}.</p><ul className="list-disc space-y-1 pl-5 text-sm text-gray-600"><li>{duplicates.toLocaleString()} duplicate{duplicates === 1 ? "" : "s"} will be skipped.</li>{invalid > 0 && <li>{invalid.toLocaleString()} invalid row{invalid === 1 ? "" : "s"} will be skipped.</li>}<li>No email notifications are sent for a bulk import, so your partner won&apos;t receive a message for every historical row.</li><li>Each imported transaction stays pending until your partner reviews it.</li></ul></div>;
}

function ResultStep({ result }: { result: ImportResult | null }) {
  if (!result) return null;
  return <div className="space-y-3 py-3"><h3 className={`text-base font-semibold ${result.failed ? "text-amber-700" : "text-green-700"}`}>{result.failed ? "Import stopped" : "Import complete"}</h3><div className="grid grid-cols-3 gap-2 text-center text-sm"><div className="rounded-lg bg-green-50 p-3"><p className="text-lg font-semibold text-green-700">{result.imported.toLocaleString()}</p><p className="text-xs text-green-800">imported</p></div><div className="rounded-lg bg-blue-50 p-3"><p className="text-lg font-semibold text-blue-700">{result.skippedDuplicates.toLocaleString()}</p><p className="text-xs text-blue-800">duplicates skipped</p></div><div className="rounded-lg bg-red-50 p-3"><p className="text-lg font-semibold text-red-700">{result.rejected.toLocaleString()}</p><p className="text-xs text-red-800">rejected</p></div></div>{result.failed ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Some rows may have been imported before the error: {result.failed}. Correct the file and import it again; rows already imported will be recognized as duplicates.</p> : <p className="text-sm text-gray-600">The imported transactions are pending and ready for review in this balance.</p>}</div>;
}
