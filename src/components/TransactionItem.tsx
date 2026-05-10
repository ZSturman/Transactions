"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Transaction, Pair } from "@/types";
import { formatAmount } from "@/utils/currency";
import DisputeWithCounterForm from "@/components/DisputeWithCounterForm";

interface TransactionItemProps {
  transaction: Transaction;
  pair: Pair;
  onApprove: (tx: Transaction) => void;
  onDispute: (tx: Transaction, reason: string, proposedAmount?: number) => void;
  onAcceptCounter?: (tx: Transaction) => void;
  onRejectCounter?: (tx: Transaction) => void;
  onArchive?: (tx: Transaction) => void;
  onUnarchive?: (tx: Transaction) => void;
  onCancel?: (tx: Transaction) => void;
}

export default function TransactionItem({
  transaction: tx,
  pair,
  onApprove,
  onDispute,
  onAcceptCounter,
  onRejectCounter,
  onArchive,
  onUnarchive,
  onCancel,
}: TransactionItemProps) {
  const { user } = useAuth();
  const [showDispute, setShowDispute] = useState(false);

  if (!user) return null;

  const isCreator = tx.createdBy === user.uid;
  const idx = pair.users.indexOf(user.uid);
  const creatorName = isCreator ? "You" : pair.userNames[idx === 0 ? 1 : 0];
  const isDeleted = pair.deletedUsers && pair.deletedUsers[tx.createdBy];

  const isPending = tx.status === "pending" && !isCreator;
  const isDisputedWithCounter =
    tx.status === "disputed" && tx.proposedAmount !== undefined && isCreator;

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700",
    approved: "bg-green-100 text-green-700",
    disputed: "bg-red-100 text-red-700",
    settlement: "bg-teal-100 text-teal-700",
    forgiveness: "bg-purple-100 text-purple-700",
  };

  const displayDate = (tx.date ?? tx.createdAt)?.toDate?.();
  const date = displayDate
    ? displayDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Just now";

  let label: string;
  if (tx.type === "settlement") {
    label = isCreator ? "You settled" : `${isDeleted ? "[Deleted Account]" : creatorName} settled`;
  } else if (tx.type === "forgiveness") {
    label = isCreator
      ? "You forgave"
      : `${isDeleted ? "[Deleted Account]" : creatorName} forgave`;
  } else if (tx.type === "payment") {
    label = isCreator ? "You paid" : `${isDeleted ? "[Deleted Account]" : creatorName} paid`;
  } else {
    label = isCreator
      ? "You requested"
      : `${isDeleted ? "[Deleted Account]" : creatorName} requested`;
  }

  const statusLabel = tx.type === "settlement" ? "settled" : tx.type === "forgiveness" ? "forgiven" : tx.status;

  return (
    <div
      className={`card ${tx.status === "disputed" ? "border-red-200" : tx.status === "pending" && !isCreator ? "border-blue-200 bg-blue-50/30" : ""} ${tx.archived ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                statusColors[statusLabel] || statusColors[tx.status] || "bg-gray-100 text-gray-600"
              }`}
            >
              {statusLabel}
            </span>
            {tx.archived && (
              <span className="inline-block text-xs px-2 py-0.5 rounded-full font-medium bg-gray-200 text-gray-600">
                archived
              </span>
            )}
            <span className="text-xs text-gray-400">{date}</span>
          </div>
          <p className="text-sm font-medium">{label}</p>
          {tx.description && (
            <p className="text-xs text-gray-500 mt-0.5">{tx.description}</p>
          )}
          {tx.status === "disputed" && tx.disputeReason && (
            <p className="text-xs text-red-500 mt-1 italic">
              Dispute: &ldquo;{tx.disputeReason}&rdquo;
            </p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p
            className={`font-bold ${
              tx.type === "settlement" || tx.type === "forgiveness"
                ? "text-gray-500"
                : tx.type === "payment"
                ? "text-green-600"
                : "text-blue-600"
            }`}
          >
            {formatAmount(tx.amount, pair.currency)}
          </p>
        </div>
      </div>

      {/* Pending: approve or dispute */}
      {isPending && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          {!showDispute ? (
            <div className="flex gap-2">
              <button onClick={() => onApprove(tx)} className="btn-primary text-xs px-3 py-1">
                Approve
              </button>
              <button
                onClick={() => setShowDispute(true)}
                className="btn-danger text-xs px-3 py-1"
              >
                Dispute
              </button>
            </div>
          ) : (
            <DisputeWithCounterForm
              tx={tx}
              currency={pair.currency}
              onDispute={(reason, proposedAmount) => {
                onDispute(tx, reason, proposedAmount);
                setShowDispute(false);
              }}
              onCancel={() => setShowDispute(false)}
            />
          )}
        </div>
      )}

      {/* Creator sees counter-proposal */}
      {isDisputedWithCounter && onAcceptCounter && onRejectCounter && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <DisputeWithCounterForm
            tx={tx}
            currency={pair.currency}
            onDispute={() => {}}
            onCancel={() => {}}
            onAcceptCounter={() => onAcceptCounter(tx)}
            onRejectCounter={() => onRejectCounter(tx)}
          />
        </div>
      )}

      {/* Archive controls (only for resolved approved transactions) */}
      {tx.status === "approved" && (onArchive || onUnarchive) && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
          {tx.archived
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
              )}
        </div>
      )}

      {/* Creator can cancel their own pending transaction */}
      {tx.status === "pending" && isCreator && onCancel && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
          <button
            onClick={() => onCancel(tx)}
            className="text-xs text-red-500 hover:text-red-700 hover:underline"
          >
            Cancel request
          </button>
        </div>
      )}
    </div>
  );
}
