"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Transaction, Pair } from "@/types";
import { formatAmount } from "@/utils/currency";

interface TransactionItemProps {
  transaction: Transaction;
  pair: Pair;
  onApprove: (tx: Transaction) => void;
  onDispute: (tx: Transaction, reason: string) => void;
}

export default function TransactionItem({ transaction: tx, pair, onApprove, onDispute }: TransactionItemProps) {
  const { user } = useAuth();
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");

  if (!user) return null;

  const isCreator = tx.createdBy === user.uid;
  const idx = pair.users.indexOf(user.uid);
  const creatorName = isCreator ? "You" : pair.userNames[idx === 0 ? 1 : 0];

  const isPending = tx.status === "pending" && !isCreator;
  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700",
    approved: "bg-green-100 text-green-700",
    disputed: "bg-red-100 text-red-700",
  };

  const date = tx.createdAt?.toDate?.()
    ? tx.createdAt.toDate().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Just now";

  // Determine display: "I paid" vs "They paid" from current user's perspective
  let label: string;
  if (tx.type === "payment") {
    label = isCreator ? "You paid" : `${creatorName} paid`;
  } else {
    label = isCreator ? "You requested" : `${creatorName} requested`;
  }

  return (
    <div className={`card ${tx.status === "disputed" ? "border-red-200" : tx.status === "pending" && !isCreator ? "border-blue-200" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[tx.status]}`}>
              {tx.status}
            </span>
            <span className="text-xs text-gray-400">{date}</span>
          </div>
          <p className="text-sm font-medium">{label}</p>
          {tx.description && (
            <p className="text-xs text-gray-500 mt-0.5">{tx.description}</p>
          )}
          {tx.status === "disputed" && tx.disputeReason && (
            <p className="text-xs text-red-500 mt-1 italic">
              Dispute: "{tx.disputeReason}"
            </p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className={`font-bold ${tx.type === "payment" ? "text-green-600" : "text-blue-600"}`}>
            {formatAmount(tx.amount, pair.currency)}
          </p>
        </div>
      </div>

      {/* Actions for pending transactions (only non-creator can approve/dispute) */}
      {isPending && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          {!showDispute ? (
            <div className="flex gap-2">
              <button onClick={() => onApprove(tx)} className="btn-primary text-xs px-3 py-1">
                Approve
              </button>
              <button onClick={() => setShowDispute(true)} className="btn-danger text-xs px-3 py-1">
                Dispute
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                className="input-field text-xs"
                placeholder="Reason for dispute…"
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onDispute(tx, disputeReason);
                    setShowDispute(false);
                    setDisputeReason("");
                  }}
                  className="btn-danger text-xs px-3 py-1"
                  disabled={!disputeReason.trim()}
                >
                  Submit Dispute
                </button>
                <button onClick={() => setShowDispute(false)} className="btn-secondary text-xs px-3 py-1">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
