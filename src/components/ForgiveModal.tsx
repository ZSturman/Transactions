"use client";

import { useState } from "react";
import { Pair } from "@/types";
import { formatAmount } from "@/utils/currency";
import { useAuth } from "@/contexts/AuthContext";

interface ForgiveModalProps {
  pair: Pair;
  onConfirm: (amount: number, reason: string) => Promise<void>;
  onClose: () => void;
}

export default function ForgiveModal({ pair, onConfirm, onClose }: ForgiveModalProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [amountStr, setAmountStr] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  const userIdx = pair.users.indexOf(user.uid);
  const userBalance = userIdx === 0 ? pair.balance : -pair.balance;
  const partnerName = pair.userNames[userIdx === 0 ? 1 : 0];
  const maxAmount = Math.abs(userBalance);

  function handleNext(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amountStr);
    if (!amt || amt <= 0 || amt > maxAmount) return;
    setStep(2);
  }

  async function handleConfirm() {
    const amt = parseFloat(amountStr);
    setLoading(true);
    try {
      await onConfirm(amt, reason.trim() || "Debt forgiven");
      onClose();
    } finally {
      setLoading(false);
    }
  }

  const selectedAmount = parseFloat(amountStr) || 0;
  const isPartial = selectedAmount < maxAmount && selectedAmount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-5">
        {step === 1 ? (
          <>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Forgive Debt</h2>
              <p className="text-sm text-gray-500 mt-1">
                How much of {partnerName}&apos;s debt do you want to forgive?
              </p>
            </div>

            <form onSubmit={handleNext} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Amount to forgive (max {formatAmount(maxAmount, pair.currency)})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={maxAmount}
                  className="input-field text-lg font-semibold"
                  placeholder={maxAmount.toFixed(2)}
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  required
                  autoFocus
                />
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAmountStr(maxAmount.toFixed(2))}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Forgive all ({formatAmount(maxAmount, pair.currency)})
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Reason (optional)
                </label>
                <input
                  type="text"
                  className="input-field text-sm"
                  placeholder="e.g. Birthday gift, no longer needed"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={200}
                />
              </div>

              <div className="flex gap-3">
                <button type="submit" className="btn-primary flex-1">
                  Continue
                </button>
                <button type="button" onClick={onClose} className="btn-secondary flex-1">
                  Cancel
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Confirm Forgiveness</h2>
              <p className="text-sm text-gray-500 mt-1">
                Please review before continuing.
              </p>
            </div>

            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Forgiving</span>
                <span className="font-semibold text-purple-700">
                  {formatAmount(selectedAmount, pair.currency)}
                  {isPartial && " (partial)"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">With</span>
                <span className="font-medium">{partnerName}</span>
              </div>
              {reason && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Reason</span>
                  <span className="font-medium text-right max-w-[180px] truncate">{reason}</span>
                </div>
              )}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <p className="text-xs text-amber-700 font-medium">
                This cannot be undone. The forgiven amount will be deducted from the outstanding balance.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleConfirm}
                className="flex-1 py-2.5 text-sm font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition-colors"
                disabled={loading}
              >
                {loading ? "Forgiving…" : "Confirm Forgiveness"}
              </button>
              <button
                onClick={() => setStep(1)}
                className="btn-secondary flex-1"
                disabled={loading}
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
