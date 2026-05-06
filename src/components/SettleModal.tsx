"use client";

import { useState } from "react";
import { Pair } from "@/types";
import { formatAmount } from "@/utils/currency";
import { useAuth } from "@/contexts/AuthContext";

interface SettleModalProps {
  pair: Pair;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export default function SettleModal({ pair, onConfirm, onClose }: SettleModalProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  const userIdx = pair.users.indexOf(user.uid);
  const userBalance = userIdx === 0 ? pair.balance : -pair.balance;
  const partnerName = pair.userNames[userIdx === 0 ? 1 : 0];

  const absAmount = formatAmount(Math.abs(userBalance), pair.currency);
  const debtLabel =
    userBalance > 0
      ? `${partnerName} pays you ${absAmount}`
      : `You pay ${partnerName} ${absAmount}`;

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Settle Up</h2>
          <p className="text-sm text-gray-500 mt-1">
            Mark the full balance as settled.
          </p>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-gray-900">{absAmount}</p>
          <p className="text-sm text-gray-500 mt-1">{debtLabel}</p>
        </div>

        <p className="text-xs text-gray-400">
          This creates a settlement transaction that zeroes the balance between
          you and {partnerName}. Both parties can see it in the transaction history.
        </p>

        <div className="flex gap-3">
          <button
            onClick={handleConfirm}
            className="btn-primary flex-1"
            disabled={loading}
          >
            {loading ? "Settling…" : "Confirm Settle"}
          </button>
          <button
            onClick={onClose}
            className="btn-secondary flex-1"
            disabled={loading}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
