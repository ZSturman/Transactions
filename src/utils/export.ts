import { Pair, Transaction } from "@/types";
import { getCurrencySymbol } from "@/utils/currency";

function formatDate(ts: { toDate?: () => Date } | undefined): string {
  if (!ts?.toDate) return "";
  return ts.toDate().toISOString().split("T")[0];
}

function formatDateTime(ts: { toDate?: () => Date } | undefined): string {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleString("en-US");
}

function escapeCsv(val: string | number | undefined): string {
  if (val === undefined || val === null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildRows(
  transactions: Transaction[],
  pair: Pair,
  partnerName: string
): string[] {
  return transactions.map((tx) => {
    const eventDate = tx.date?.toDate
      ? formatDate(tx.date)
      : formatDate(tx.createdAt);
    const createdDate = formatDateTime(tx.createdAt);
    const symbol = getCurrencySymbol(pair.currency);
    return [
      escapeCsv(createdDate),
      escapeCsv(eventDate),
      escapeCsv(partnerName),
      escapeCsv(tx.description),
      escapeCsv(tx.type),
      escapeCsv(`${symbol}${Math.abs(tx.amount).toFixed(2)}`),
      escapeCsv(pair.currency),
      escapeCsv(tx.status),
      escapeCsv(tx.disputeReason ?? ""),
    ].join(",");
  });
}

const CSV_HEADER =
  "Created At,Event Date,Person,Description,Type,Amount,Currency,Status,Dispute Reason";

function downloadCsv(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportPairToCsv(
  transactions: Transaction[],
  pair: Pair,
  currentUserUid: string
) {
  const userIdx = pair.users.indexOf(currentUserUid);
  const partnerName = pair.userNames[userIdx === 0 ? 1 : 0];
  const visible = transactions.filter((t) => t.archived !== true);
  const rows = buildRows(visible, pair, partnerName);
  const csv = [CSV_HEADER, ...rows].join("\n");
  const safeName = partnerName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  downloadCsv(`transactions_${safeName}.csv`, csv);
}

export function exportAllToCsv(
  pairs: Pair[],
  transactionsByPairId: Record<string, Transaction[]>,
  currentUserUid: string
) {
  const allRows: string[] = [];

  for (const pair of pairs) {
    const userIdx = pair.users.indexOf(currentUserUid);
    const partnerName = pair.userNames[userIdx === 0 ? 1 : 0];
    const txs = (transactionsByPairId[pair.id] ?? []).filter(
      (t) => t.archived !== true
    );
    allRows.push(...buildRows(txs, pair, partnerName));
  }

  const csv = [CSV_HEADER, ...allRows].join("\n");
  downloadCsv("transactions_all.csv", csv);
}
