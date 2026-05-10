"use client";

import { useState, useMemo } from "react";
import { Pair, Transaction } from "@/types";
import { formatAmount } from "@/utils/currency";
import { useAuth } from "@/contexts/AuthContext";

type SortKey = "date" | "person" | "amount" | "type" | "status";
type SortDir = "asc" | "desc";

interface TransactionTableProps {
  transactions: (Transaction & { pairId?: string })[];
  pairs: Pair[];
  onApprove?: (tx: Transaction) => void;
  onDispute?: (tx: Transaction, reason: string, proposedAmount?: number) => void;
  onArchive?: (tx: Transaction & { pairId?: string }) => void;
  onUnarchive?: (tx: Transaction & { pairId?: string }) => void;
  /** When true, hides the internal status filter pills (e.g. when parent manages filtering) */
  hideStatusFilter?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  disputed: "bg-red-100 text-red-700",
};

const TYPE_LABELS: Record<string, string> = {
  payment: "Payment",
  request: "Request",
  adjustment: "Adjustment",
  settlement: "Settlement",
  forgiveness: "Forgiven",
};

export default function TransactionTable({
  transactions,
  pairs,
  onApprove,
  onDispute,
  onArchive,
  onUnarchive,
  hideStatusFilter = false,
}: TransactionTableProps) {
  void onDispute;
  const { user } = useAuth();
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const pairById = useMemo(
    () => Object.fromEntries(pairs.map((p) => [p.id, p])),
    [pairs]
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const filtered = useMemo(() => {
    let rows = transactions;

    if (statusFilter !== "all") {
      rows = rows.filter((tx) => tx.status === statusFilter);
    }

    if (startDate) {
      const start = new Date(startDate).getTime();
      rows = rows.filter((tx) => {
        const d = tx.createdAt?.toDate?.()?.getTime() ?? 0;
        return d >= start;
      });
    }

    if (endDate) {
      const end = new Date(endDate).getTime() + 86400000;
      rows = rows.filter((tx) => {
        const d = tx.createdAt?.toDate?.()?.getTime() ?? 0;
        return d <= end;
      });
    }

    return [...rows].sort((a, b) => {
      const pair = pairById[a.pairId ?? ""];
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "date": {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return (ta - tb) * dir;
        }
        case "amount":
          return (a.amount - b.amount) * dir;
        case "type":
          return a.type.localeCompare(b.type) * dir;
        case "status":
          return a.status.localeCompare(b.status) * dir;
        case "person": {
          const pairA = pairById[a.pairId ?? ""];
          const pairB = pairById[b.pairId ?? ""];
          const nameA = user ? pairA?.userNames[pairA.users.indexOf(user.uid) === 0 ? 1 : 0] ?? "" : "";
          const nameB = user ? pairB?.userNames[pairB.users.indexOf(user.uid) === 0 ? 1 : 0] ?? "" : "";
          return nameA.localeCompare(nameB) * dir;
        }
        default:
          return 0;
      }
    });
  }, [transactions, statusFilter, startDate, endDate, sortKey, sortDir, pairById, user]);

  function SortHeader({ label, colKey }: { label: string; colKey: SortKey }) {
    const active = sortKey === colKey;
    return (
      <th
        className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-800"
        onClick={() => toggleSort(colKey)}
      >
        {label}
        {active && <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </th>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="text-center py-10 text-gray-400 text-sm">
        No transactions yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {!hideStatusFilter && (
          <div className="flex gap-1">
            {(["all", "pending", "approved", "disputed"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize font-medium ${
                  statusFilter === s
                    ? "bg-gray-800 text-white border-gray-800"
                    : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 ml-auto items-center">
          <input
            type="date"
            className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              <SortHeader label="Date" colKey="date" />
              <SortHeader label="Person" colKey="person" />
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Description
              </th>
              <SortHeader label="Type" colKey="type" />
              <SortHeader label="Amount" colKey="amount" />
              <SortHeader label="Status" colKey="status" />
              {(onArchive || onUnarchive) && (
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((tx) => {
              const pair = pairById[tx.pairId ?? ""];
              const userIdx = user && pair ? pair.users.indexOf(user.uid) : -1;
              const partnerName =
                pair && userIdx !== -1
                  ? pair.userNames[userIdx === 0 ? 1 : 0]
                  : "—";
              const isCreator = tx.createdBy === user?.uid;
              const isPending = tx.status === "pending" && !isCreator;

              const displayDate = tx.date?.toDate?.() ?? tx.createdAt?.toDate?.();
              const dateStr = displayDate
                ? displayDate.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "—";

              const isDeleted =
                pair?.deletedUsers &&
                pair.users.some((uid) => uid in (pair.deletedUsers ?? {}));

              return (
                <tr
                  key={tx.id}
                  className={`transition-colors ${
                    isPending
                      ? "bg-amber-50 hover:bg-amber-100"
                      : "hover:bg-gray-50"
                  } ${tx.archived ? "opacity-60" : ""}`}
                >
                  <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                    {dateStr}
                  </td>
                  <td className="px-3 py-2.5 text-sm font-medium text-gray-800 whitespace-nowrap">
                    {isDeleted ? (
                      <span className="text-gray-400 italic">[Deleted Account]</span>
                    ) : (
                      partnerName
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-gray-600 max-w-[200px] truncate">
                    {tx.description || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap capitalize">
                    {TYPE_LABELS[tx.type] ?? tx.type}
                  </td>
                  <td className="px-3 py-2.5 text-sm font-semibold whitespace-nowrap">
                    <span
                      className={
                        tx.type === "payment" || tx.type === "settlement"
                          ? "text-green-600"
                          : tx.type === "forgiveness"
                          ? "text-purple-600"
                          : "text-blue-600"
                      }
                    >
                      {pair ? formatAmount(tx.amount, pair.currency) : tx.amount.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                        STATUS_COLORS[tx.status] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {tx.status}
                    </span>
                    {isPending && onApprove && (
                      <button
                        onClick={() => onApprove(tx)}
                        className="ml-2 text-xs text-blue-600 hover:underline"
                      >
                        Approve
                      </button>
                    )}
                    {tx.archived && (
                      <span className="ml-2 inline-block text-xs px-2 py-0.5 rounded-full font-medium bg-gray-200 text-gray-600">
                        archived
                      </span>
                    )}
                  </td>
                  {(onArchive || onUnarchive) && (
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {tx.status === "approved" && (
                        tx.archived
                          ? onUnarchive && (
                              <button
                                onClick={() => onUnarchive(tx)}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Unarchive
                              </button>
                            )
                          : onArchive && (
                              <button
                                onClick={() => onArchive(tx)}
                                className="text-xs text-gray-500 hover:text-gray-800 hover:underline"
                              >
                                Archive
                              </button>
                            )
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 text-right">{filtered.length} transactions</p>
    </div>
  );
}
