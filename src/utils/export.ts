import { Pair, Transaction } from "@/types";

type TimestampLike = { toDate?: () => Date } | undefined;

function asIso(timestamp: TimestampLike): string {
  return timestamp?.toDate ? timestamp.toDate().toISOString() : "";
}

function asDate(timestamp: TimestampLike): string {
  return asIso(timestamp).slice(0, 10);
}

function escapeCsv(value: unknown): string {
  if (value === undefined || value === null) return "";
  const string = String(value);
  return /[",\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function partnerFor(pair: Pair, currentUserUid: string) {
  const index = pair.users.indexOf(currentUserUid);
  const partnerIndex = index === 0 ? 1 : 0;
  return {
    id: pair.users[partnerIndex] || "",
    name: pair.userNames[partnerIndex] || "",
    email: pair.userEmails[partnerIndex] || "",
  };
}

const CSV_HEADER = [
  "Transaction ID",
  "Pair ID",
  "Partner ID",
  "Partner Name",
  "Partner Email",
  "Pair Status",
  "Event Date",
  "Created At",
  "Created By",
  "Type",
  "Amount",
  "Currency",
  "Description",
  "Status",
  "Dispute Reason",
  "Proposed Amount",
  "Archived",
  "Import Batch ID",
  "Import Fingerprint",
].join(",");

function rowsForPair(transactions: Transaction[], pair: Pair, currentUserUid: string) {
  const partner = partnerFor(pair, currentUserUid);
  return transactions.map((transaction) => [
    transaction.id,
    pair.id,
    partner.id,
    partner.name,
    partner.email,
    pair.status,
    asDate(transaction.date ?? transaction.createdAt),
    asIso(transaction.createdAt),
    transaction.createdBy,
    transaction.type,
    transaction.amount,
    pair.currency,
    transaction.description,
    transaction.status,
    transaction.disputeReason,
    transaction.proposedAmount,
    transaction.archived === true ? "true" : "false",
    transaction.importBatchId,
    transaction.importFingerprint,
  ].map(escapeCsv).join(","));
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toLowerCase() || "export";
}

export function exportPairToCsv(transactions: Transaction[], pair: Pair, currentUserUid: string) {
  const partner = partnerFor(pair, currentUserUid);
  download(
    `transactions_${safeName(partner.name || partner.email)}.csv`,
    [CSV_HEADER, ...rowsForPair(transactions, pair, currentUserUid)].join("\n"),
    "text/csv;charset=utf-8"
  );
}

export function exportAllToCsv(
  pairs: Pair[],
  transactionsByPairId: Record<string, Transaction[]>,
  currentUserUid: string
) {
  const rows = pairs.flatMap((pair) => rowsForPair(transactionsByPairId[pair.id] ?? [], pair, currentUserUid));
  download("transactions_export.csv", [CSV_HEADER, ...rows].join("\n"), "text/csv;charset=utf-8");
}

function serialiseTransaction(transaction: Transaction) {
  return {
    ...transaction,
    date: asIso(transaction.date),
    createdAt: asIso(transaction.createdAt),
    resolvedAt: asIso(transaction.resolvedAt),
    archivedAt: asIso(transaction.archivedAt),
  };
}

function serialisePair(pair: Pair) {
  return {
    ...pair,
    createdAt: asIso(pair.createdAt),
    updatedAt: asIso(pair.updatedAt),
  };
}

export function exportPairToJson(transactions: Transaction[], pair: Pair) {
  const content = JSON.stringify({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    pairs: [serialisePair(pair)],
    transactions: transactions.map(serialiseTransaction),
  }, null, 2);
  download(`transactions_${safeName(pair.id)}.json`, content, "application/json;charset=utf-8");
}

export function exportAllToJson(pairs: Pair[], transactionsByPairId: Record<string, Transaction[]>) {
  const content = JSON.stringify({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    pairs: pairs.map(serialisePair),
    transactions: pairs.flatMap((pair) => (transactionsByPairId[pair.id] ?? []).map(serialiseTransaction)),
  }, null, 2);
  download("transactions_export.json", content, "application/json;charset=utf-8");
}
