"use client";

import { BalanceHistoryPoint } from "@/utils/balanceHistory";
import { getCurrencySymbol } from "@/utils/currency";

interface TooltipPayloadEntry {
  payload?: BalanceHistoryPoint;
}

function formatChange(value: number, symbol: string) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${symbol}${Math.abs(value).toFixed(2)}`;
}

function balanceStatus(value: number) {
  if (value === 0) return "(settled)";
  return value > 0 ? "(owed to you)" : "(you owe)";
}

function HistoryContent({
  point,
  currency,
  label,
  testId,
}: {
  point: BalanceHistoryPoint;
  currency: string;
  label: string;
  testId?: string;
}) {
  const symbol = getCurrencySymbol(currency);
  return (
    <div data-testid={testId} className="space-y-1">
      <p className="font-semibold text-gray-700">{point.tooltipDate}</p>
      <p>
        {label}: {symbol}{Math.abs(point.value).toFixed(2)} {balanceStatus(point.value)}
      </p>
      {point.isOpeningBalance ? (
        <p className="text-gray-400">Opening balance for this period</p>
      ) : (
        <>
          <p>Change: {formatChange(point.change, symbol)}</p>
          <p className="text-gray-400">
            {point.transactionCount} approved transaction{point.transactionCount === 1 ? "" : "s"}
          </p>
        </>
      )}
    </div>
  );
}

export function BalanceHistoryTooltip({
  active,
  payload,
  currency,
  label,
  testId,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TooltipPayloadEntry>;
  currency: string;
  label: string;
  testId: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 shadow-lg">
      <HistoryContent point={point} currency={currency} label={label} testId={testId} />
    </div>
  );
}

export function BalanceHistoryDetails({
  point,
  currency,
  label,
  testId,
}: {
  point: BalanceHistoryPoint | undefined;
  currency: string;
  label: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      aria-live="polite"
      className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600"
    >
      {point ? (
        <HistoryContent point={point} currency={currency} label={label} />
      ) : (
        "Hover, click, or tap the chart to inspect a date."
      )}
    </div>
  );
}
