"use client";

import { formatAmount } from "@/utils/currency";
import {
  splitDebtAmount,
  TransactionDirection,
  TransactionEntryMode,
} from "@/utils/transactionPresentation";

interface TransactionEntryFieldsProps {
  partnerName: string;
  currency: string;
  mode: TransactionEntryMode;
  onModeChange: (mode: TransactionEntryMode) => void;
  direction: TransactionDirection;
  onDirectionChange: (direction: TransactionDirection) => void;
  amount: string;
  onAmountChange: (amount: string) => void;
  creatorSharePercent: string;
  onCreatorSharePercentChange: (percent: string) => void;
  autoFocus?: boolean;
}

/** Shared transaction controls used on the pair page and dashboard modal. */
export default function TransactionEntryFields({
  partnerName,
  currency,
  mode,
  onModeChange,
  direction,
  onDirectionChange,
  amount,
  onAmountChange,
  creatorSharePercent,
  onCreatorSharePercentChange,
  autoFocus = false,
}: TransactionEntryFieldsProps) {
  const total = Number(amount);
  const creatorShare = Number(creatorSharePercent);
  const partnerShare = Number.isFinite(creatorShare) ? 100 - creatorShare : 0;
  const debtAmount =
    Number.isFinite(total) && total > 0 && Number.isFinite(creatorShare)
      ? splitDebtAmount(total, creatorShare, direction)
      : 0;
  const obligation = direction === "i_paid"
    ? `${partnerName} owes you`
    : `You owe ${partnerName}`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onModeChange("payment")}
          className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
            mode === "payment"
              ? "border-blue-300 bg-blue-50 text-blue-700"
              : "border-gray-200 text-gray-500 hover:bg-gray-50"
          }`}
        >
          Record a balance
        </button>
        <button
          type="button"
          onClick={() => onModeChange("split")}
          className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
            mode === "split"
              ? "border-blue-300 bg-blue-50 text-blue-700"
              : "border-gray-200 text-gray-500 hover:bg-gray-50"
          }`}
        >
          Split an expense
        </button>
      </div>

      {mode === "payment" ? (
        <>
          <div>
            <p className="mb-1 text-xs text-gray-500">Who owes whom?</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onDirectionChange("i_paid")}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  direction === "i_paid"
                    ? "border-green-300 bg-green-50 text-green-700"
                    : "border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}
              >
                {partnerName.split(" ")[0]} owes you
              </button>
              <button
                type="button"
                onClick={() => onDirectionChange("they_paid")}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  direction === "they_paid"
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}
              >
                You owe {partnerName.split(" ")[0]}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">Amount owed ({currency})</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="input-field text-lg font-semibold"
              placeholder="0.00"
              aria-label="Amount owed"
              value={amount}
              onChange={(event) => onAmountChange(event.target.value)}
              autoFocus={autoFocus}
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="mb-1 block text-xs text-gray-500">We spent ({currency})</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="input-field text-lg font-semibold"
              placeholder="0.00"
              aria-label="Total shared expense"
              value={amount}
              onChange={(event) => onAmountChange(event.target.value)}
              autoFocus={autoFocus}
            />
          </div>

          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Your share</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  className="input-field pr-7 text-sm"
                  aria-label="Your share percentage"
                  value={creatorSharePercent}
                  onChange={(event) => onCreatorSharePercentChange(event.target.value)}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
              </div>
            </div>
            <p className="pb-2 text-xs text-gray-500">
              {partnerName.split(" ")[0]}: {Number.isFinite(partnerShare) ? partnerShare : "—"}%
            </p>
          </div>

          <div>
            <p className="mb-1 text-xs text-gray-500">Who paid the full bill?</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onDirectionChange("i_paid")}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  direction === "i_paid"
                    ? "border-green-300 bg-green-50 text-green-700"
                    : "border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}
              >
                You paid
              </button>
              <button
                type="button"
                onClick={() => onDirectionChange("they_paid")}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  direction === "they_paid"
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}
              >
                {partnerName.split(" ")[0]} paid
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm" aria-live="polite">
            <p className="font-medium text-blue-800">{obligation} {formatAmount(debtAmount, currency)}</p>
            <p className="mt-0.5 text-xs text-blue-700">
              {Number.isFinite(total) && total > 0
                ? `Total ${formatAmount(total, currency)} · ${creatorSharePercent || "0"}% / ${Number.isFinite(partnerShare) ? partnerShare : "—"}% split`
                : "Enter the total to calculate the split"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
