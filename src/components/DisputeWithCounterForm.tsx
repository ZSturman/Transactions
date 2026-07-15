"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Transaction } from "@/types";
import { formatAmount } from "@/utils/currency";

interface DisputeWithCounterFormProps {
  tx: Transaction;
  currency: string;
  onDispute: (reason: string, proposedAmount?: number) => void;
  onCancel: () => void;
  onAcceptCounter?: () => void;
  onRejectCounter?: () => void;
}

export default function DisputeWithCounterForm({
  tx,
  currency,
  onDispute,
  onCancel,
  onAcceptCounter,
  onRejectCounter,
}: DisputeWithCounterFormProps) {
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const [proposedStr, setProposedStr] = useState("");

  const isCreator = tx.createdBy === user?.uid;

  // Creator sees counter-proposal from the other party
  if (isCreator && tx.status === "disputed" && tx.proposedAmount) {
    return (
      <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
        <p className="text-xs text-gray-500">
          Counter-proposal:{" "}
          <span className="font-semibold text-gray-800">
            {formatAmount(tx.proposedAmount, currency)}
          </span>
        </p>
        <div className="flex gap-2">
          {onAcceptCounter && (
            <button
              onClick={onAcceptCounter}
              className="btn-primary text-xs px-3 py-1"
            >
              Accept {formatAmount(tx.proposedAmount, currency)}
            </button>
          )}
          {onRejectCounter && (
            <button
              onClick={onRejectCounter}
              className="btn-danger text-xs px-3 py-1"
            >
              Reject
            </button>
          )}
        </div>
      </div>
    );
  }

  // Non-creator files a dispute (with optional counter-proposal)
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
      <textarea
        className="input-field text-xs resize-none"
        rows={2}
        placeholder="Reason for dispute…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        autoFocus
      />
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Propose a different amount (optional)
        </label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          className="input-field text-sm"
          placeholder={`e.g. ${formatAmount(tx.amount / 2, currency)}`}
          value={proposedStr}
          onChange={(e) => setProposedStr(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => {
            const proposed = proposedStr ? parseFloat(proposedStr) : undefined;
            onDispute(reason, proposed && proposed > 0 ? proposed : undefined);
          }}
          className="btn-danger text-xs px-3 py-1"
          disabled={!reason.trim()}
        >
          Submit Dispute
        </button>
        <button
          onClick={onCancel}
          className="btn-secondary text-xs px-3 py-1"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
