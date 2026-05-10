"use client";

import { useMemo, useState } from "react";
import Papa from "papaparse";
import {
  collection,
  doc,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Pair, TransactionType } from "@/types";
import { formatAmount } from "@/utils/currency";
import toast from "react-hot-toast";

interface CsvImportModalProps {
  pair: Pair;
  userId: string;
  onClose: () => void;
}

type FieldKey =
  | "ignore"
  | "amount"
  | "direction"
  | "description"
  | "date"
  | "type";

interface FieldOption {
  value: FieldKey;
  label: string;
  required?: boolean;
}

const FIELD_OPTIONS: FieldOption[] = [
  { value: "ignore", label: "— Ignore —" },
  { value: "amount", label: "Amount", required: true },
  { value: "direction", label: "Direction (I paid / They paid)", required: true },
  { value: "description", label: "Description" },
  { value: "date", label: "Date" },
  { value: "type", label: "Type (advanced)" },
];

const HEADER_HEURISTICS: { regex: RegExp; field: FieldKey }[] = [
  { regex: /^(amount|amt|total|sum|value|price|cost)$/i, field: "amount" },
  { regex: /^(direction|paid by|payer|who paid|side)$/i, field: "direction" },
  { regex: /^(description|desc|note|notes|memo|details|reason|for)$/i, field: "description" },
  { regex: /^(date|when|event date|tx date|transaction date)$/i, field: "date" },
  { regex: /^(type|kind|category)$/i, field: "type" },
];

const DIRECTION_I_PAID = /^(i\s*paid|me|self|outgoing|payment|paid|out)$/i;
const DIRECTION_THEY_PAID = /^(they\s*paid|partner|other|incoming|request|received|in|owed)$/i;

const VALID_TYPES: TransactionType[] = [
  "payment",
  "request",
  "adjustment",
];

interface ParsedRow {
  raw: Record<string, string>;
  amount: number | null;
  direction: "i_paid" | "they_paid" | null;
  description: string;
  date: Date | null;
  type: TransactionType | null;
  errors: string[];
}

function autoMap(headers: string[]): Record<string, FieldKey> {
  const mapping: Record<string, FieldKey> = {};
  const used = new Set<FieldKey>();
  for (const h of headers) {
    const trimmed = h.trim();
    let matched: FieldKey = "ignore";
    for (const { regex, field } of HEADER_HEURISTICS) {
      if (regex.test(trimmed) && !used.has(field)) {
        matched = field;
        used.add(field);
        break;
      }
    }
    mapping[h] = matched;
  }
  return mapping;
}

function parseAmount(raw: string): number | null {
  if (!raw) return null;
  // strip currency symbols, commas, parentheses
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (!isFinite(n)) return null;
  return Math.abs(n);
}

function parseDirection(raw: string): "i_paid" | "they_paid" | null {
  if (!raw) return null;
  const t = raw.trim();
  if (DIRECTION_I_PAID.test(t)) return "i_paid";
  if (DIRECTION_THEY_PAID.test(t)) return "they_paid";
  return null;
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d;
}

function parseType(raw: string): TransactionType | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (VALID_TYPES.includes(t as TransactionType)) return t as TransactionType;
  return null;
}

export default function CsvImportModal({ pair, userId, onClose }: CsvImportModalProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, FieldKey>>({});
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const idx = pair.users.indexOf(userId);
  const partnerName = pair.userNames[idx === 0 ? 1 : 0];

  function handleFile(file: File) {
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data.filter(
          (r) => r && Object.values(r).some((v) => v && String(v).trim() !== "")
        );
        const fields = (results.meta.fields ?? []).filter((f) => f && f.trim() !== "");
        if (fields.length === 0) {
          toast.error("No headers detected in CSV");
          return;
        }
        setHeaders(fields);
        setRows(data);
        setMapping(autoMap(fields));
        setStep(2);
      },
      error: (err) => {
        toast.error(`Failed to parse CSV: ${err.message}`);
      },
    });
  }

  const reverseMap = useMemo(() => {
    const m: Partial<Record<FieldKey, string>> = {};
    for (const [header, field] of Object.entries(mapping)) {
      if (field !== "ignore" && !m[field]) m[field] = header;
    }
    return m;
  }, [mapping]);

  const requiredMapped = !!reverseMap.amount && !!reverseMap.direction;

  const parsedRows = useMemo<ParsedRow[]>(() => {
    if (step < 3) return [];
    return rows.map((raw) => {
      const errors: string[] = [];
      const amountRaw = reverseMap.amount ? raw[reverseMap.amount] : "";
      const directionRaw = reverseMap.direction ? raw[reverseMap.direction] : "";
      const descRaw = reverseMap.description ? raw[reverseMap.description] : "";
      const dateRaw = reverseMap.date ? raw[reverseMap.date] : "";
      const typeRaw = reverseMap.type ? raw[reverseMap.type] : "";

      const amount = parseAmount(amountRaw ?? "");
      const direction = parseDirection(directionRaw ?? "");
      const date = dateRaw ? parseDate(dateRaw) : null;
      const type = typeRaw ? parseType(typeRaw) : null;

      if (amount === null || amount <= 0) errors.push("invalid amount");
      if (!direction) errors.push("invalid direction");
      if (dateRaw && !date) errors.push("invalid date");
      if (typeRaw && !type) errors.push("unknown type");

      return {
        raw,
        amount,
        direction,
        description: (descRaw ?? "").slice(0, 200),
        date,
        type,
        errors,
      };
    });
  }, [rows, reverseMap, step]);

  const validCount = parsedRows.filter((r) => r.errors.length === 0).length;
  const invalidCount = parsedRows.length - validCount;

  async function handleImport() {
    const toImport = parsedRows.filter((r) => r.errors.length === 0);
    if (toImport.length === 0) {
      toast.error("No valid rows to import");
      return;
    }
    setImporting(true);
    setProgress({ done: 0, total: toImport.length });

    try {
      const CHUNK = 450;
      for (let i = 0; i < toImport.length; i += CHUNK) {
        const slice = toImport.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        for (const r of slice) {
          const txRef = doc(collection(db, "pairs", pair.id, "transactions"));
          const derivedType: TransactionType =
            r.type ?? (r.direction === "i_paid" ? "payment" : "request");
          const fallbackDesc = r.direction === "i_paid" ? "Payment" : "Request";
          const data: Record<string, unknown> = {
            pairId: pair.id,
            amount: r.amount!,
            type: derivedType,
            description: r.description || fallbackDesc,
            createdBy: userId,
            status: "pending",
            createdAt: serverTimestamp(),
          };
          if (r.date) data.date = Timestamp.fromDate(r.date);
          batch.set(txRef, data);
        }
        await batch.commit();
        setProgress({ done: Math.min(i + slice.length, toImport.length), total: toImport.length });
      }
      toast.success(`Imported ${toImport.length} transaction${toImport.length === 1 ? "" : "s"}`);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Import transactions from CSV</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Step {step} of 4 · with {partnerName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 1 && <Step1Upload onFile={handleFile} />}

          {step === 2 && (
            <Step2Map
              headers={headers}
              mapping={mapping}
              setMapping={setMapping}
              fileName={fileName}
              rowCount={rows.length}
              previewRow={rows[0]}
            />
          )}

          {step === 3 && (
            <Step3Preview
              rows={parsedRows}
              validCount={validCount}
              invalidCount={invalidCount}
              skipInvalid={skipInvalid}
              setSkipInvalid={setSkipInvalid}
              currency={pair.currency}
            />
          )}

          {step === 4 && (
            <Step4Confirm
              importing={importing}
              progress={progress}
              total={validCount}
              partnerName={partnerName}
            />
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between">
          <button
            onClick={() => {
              if (step === 1) onClose();
              else setStep((s) => (s - 1) as 1 | 2 | 3 | 4);
            }}
            disabled={importing}
            className="text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50"
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>

          <div className="flex gap-2">
            {step === 2 && (
              <button
                onClick={() => setStep(3)}
                disabled={!requiredMapped}
                className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50"
                title={!requiredMapped ? "Map both Amount and Direction to continue" : ""}
              >
                Preview →
              </button>
            )}
            {step === 3 && (
              <button
                onClick={() => setStep(4)}
                disabled={validCount === 0 || (invalidCount > 0 && !skipInvalid)}
                className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50"
              >
                Continue →
              </button>
            )}
            {step === 4 && !importing && (
              <button
                onClick={handleImport}
                className="btn-primary text-sm px-4 py-1.5"
              >
                Import {validCount} transaction{validCount === 1 ? "" : "s"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Upload ─────────────────────────────────────
function Step1Upload({ onFile }: { onFile: (file: File) => void }) {
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Upload a CSV file to bulk-add transactions. Each row will be created as a{" "}
        <span className="font-medium">pending</span> transaction that your partner can approve or dispute.
      </p>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`block border-2 border-dashed rounded-xl px-6 py-12 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-blue-400 bg-blue-50"
            : "border-gray-300 hover:border-gray-400 bg-gray-50"
        }`}
      >
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
        />
        <p className="text-sm font-medium text-gray-700">
          Drop a CSV file here, or click to browse
        </p>
        <p className="text-xs text-gray-500 mt-1">
          First row should contain column headers (e.g. Amount, Description, Date, Direction)
        </p>
      </label>

      <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1">
        <p className="font-semibold text-gray-700">Tips:</p>
        <p>• Required columns: Amount, Direction</p>
        <p>• Direction values: &ldquo;I paid&rdquo;, &ldquo;They paid&rdquo;, or &ldquo;payment&rdquo;/&ldquo;request&rdquo;</p>
        <p>• Optional: Description, Date, Type</p>
        <p>• Column names are auto-detected; you can adjust the mapping in the next step.</p>
      </div>
    </div>
  );
}

// ─── Step 2: Map columns ────────────────────────────────
function Step2Map({
  headers,
  mapping,
  setMapping,
  fileName,
  rowCount,
  previewRow,
}: {
  headers: string[];
  mapping: Record<string, FieldKey>;
  setMapping: (m: Record<string, FieldKey>) => void;
  fileName: string;
  rowCount: number;
  previewRow?: Record<string, string>;
}) {
  // Each non-ignore field can only be assigned once
  const usedFields = new Set(Object.values(mapping).filter((f) => f !== "ignore"));

  function update(header: string, field: FieldKey) {
    const next = { ...mapping };
    if (field !== "ignore") {
      // unset any other header pointing to this field
      for (const [h, f] of Object.entries(next)) {
        if (h !== header && f === field) next[h] = "ignore";
      }
    }
    next[header] = field;
    setMapping(next);
  }

  return (
    <div className="space-y-4">
      <div className="text-sm">
        <p className="text-gray-700">
          <span className="font-medium">{fileName}</span>
          <span className="text-gray-500"> · {rowCount} row{rowCount === 1 ? "" : "s"}</span>
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Match each CSV column to a transaction field. Required fields are marked.
        </p>
      </div>

      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
        {headers.map((h) => (
          <div key={h} className="grid grid-cols-3 gap-3 px-3 py-2.5 items-center">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{h}</p>
              {previewRow && previewRow[h] && (
                <p className="text-xs text-gray-400 truncate">e.g. {previewRow[h]}</p>
              )}
            </div>
            <div className="text-gray-400 text-xs text-center">→</div>
            <select
              value={mapping[h] ?? "ignore"}
              onChange={(e) => update(h, e.target.value as FieldKey)}
              className="text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white"
            >
              {FIELD_OPTIONS.map((opt) => (
                <option
                  key={opt.value}
                  value={opt.value}
                  disabled={
                    opt.value !== "ignore" &&
                    usedFields.has(opt.value) &&
                    mapping[h] !== opt.value
                  }
                >
                  {opt.label}
                  {opt.required ? " *" : ""}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="text-xs text-gray-500">
        <p>* Required: Amount and Direction must be mapped to continue.</p>
      </div>
    </div>
  );
}

// ─── Step 3: Preview ────────────────────────────────────
function Step3Preview({
  rows,
  validCount,
  invalidCount,
  skipInvalid,
  setSkipInvalid,
  currency,
}: {
  rows: ParsedRow[];
  validCount: number;
  invalidCount: number;
  skipInvalid: boolean;
  setSkipInvalid: (v: boolean) => void;
  currency: string;
}) {
  const preview = rows.slice(0, 20);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">
          {validCount} valid
        </span>
        {invalidCount > 0 && (
          <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full">
            {invalidCount} invalid
          </span>
        )}
        <span className="text-xs text-gray-500 ml-auto">
          Showing first {preview.length} of {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-2 py-2 text-left">#</th>
              <th className="px-2 py-2 text-left">Amount</th>
              <th className="px-2 py-2 text-left">Direction</th>
              <th className="px-2 py-2 text-left">Description</th>
              <th className="px-2 py-2 text-left">Date</th>
              <th className="px-2 py-2 text-left">Issues</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {preview.map((r, i) => (
              <tr
                key={i}
                className={r.errors.length > 0 ? "bg-red-50" : "bg-white"}
              >
                <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                <td className="px-2 py-1.5">
                  {r.amount !== null ? formatAmount(r.amount, currency) : <span className="text-red-500">—</span>}
                </td>
                <td className="px-2 py-1.5">
                  {r.direction === "i_paid"
                    ? "You paid"
                    : r.direction === "they_paid"
                    ? "They paid"
                    : <span className="text-red-500">—</span>}
                </td>
                <td className="px-2 py-1.5 max-w-[200px] truncate text-gray-600">
                  {r.description || <span className="text-gray-300">—</span>}
                </td>
                <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">
                  {r.date ? r.date.toLocaleDateString() : <span className="text-gray-300">today</span>}
                </td>
                <td className="px-2 py-1.5 text-red-600">
                  {r.errors.join(", ") || ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invalidCount > 0 && (
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={skipInvalid}
            onChange={(e) => setSkipInvalid(e.target.checked)}
            className="rounded border-gray-300"
          />
          Skip {invalidCount} invalid row{invalidCount === 1 ? "" : "s"} and import the rest
        </label>
      )}
    </div>
  );
}

// ─── Step 4: Confirm + import ───────────────────────────
function Step4Confirm({
  importing,
  progress,
  total,
  partnerName,
}: {
  importing: boolean;
  progress: { done: number; total: number };
  total: number;
  partnerName: string;
}) {
  if (importing) {
    const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="space-y-3 py-4">
        <p className="text-sm text-gray-700">
          Importing… {progress.done} of {progress.total}
        </p>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 py-2">
      <p className="text-sm text-gray-700">
        Ready to import <span className="font-semibold">{total}</span> transaction{total === 1 ? "" : "s"}.
      </p>
      <p className="text-sm text-gray-600">
        Each will be created as <span className="font-medium">pending</span>, and{" "}
        <span className="font-medium">{partnerName}</span> will need to approve them before the balance updates.
      </p>
    </div>
  );
}
