"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
} from "recharts";
import { Pair } from "@/types";
import { PairTransaction } from "@/hooks/useAllTransactions";
import {
  BalanceHistoryPoint,
  buildNetBalanceHistory,
  historyForPeriod,
} from "@/utils/balanceHistory";
import { getCurrencySymbol } from "@/utils/currency";
import { useAuth } from "@/contexts/AuthContext";
import { BalanceHistoryDetails, BalanceHistoryTooltip } from "@/components/BalanceChartDetails";

type Period = "7D" | "30D" | "90D" | "1Y" | "all";

interface NetBalanceTrendChartProps {
  transactions: PairTransaction[];
  pairs: Pair[];
  currency: string;
  period: Period;
  onPeriodChange: (p: Period) => void;
}

const PERIODS: Period[] = ["7D", "30D", "90D", "1Y", "all"];
const PERIOD_LABELS: Record<Period, string> = {
  "7D": "7D",
  "30D": "30D",
  "90D": "90D",
  "1Y": "1Y",
  all: "All",
};

function periodStartMs(period: Period): number {
  if (period === "all") return 0;
  const days: Record<Exclude<Period, "all">, number> = {
    "7D": 7,
    "30D": 30,
    "90D": 90,
    "1Y": 365,
  };
  return Date.now() - days[period] * 24 * 60 * 60 * 1000;
}

function selectedChartIndex(
  activeTooltipIndex: number | string | null | undefined,
  dataLength: number
): number | null {
  if (activeTooltipIndex === null || activeTooltipIndex === undefined) return null;
  const index = Number(activeTooltipIndex);
  return Number.isInteger(index) && index >= 0 && index < dataLength ? index : null;
}

export default function NetBalanceTrendChart({
  transactions,
  pairs,
  currency,
  period,
  onPeriodChange,
}: NetBalanceTrendChartProps) {
  const { user } = useAuth();
  const symbol = getCurrencySymbol(currency);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const history = useMemo<BalanceHistoryPoint[]>(
    () => (user ? buildNetBalanceHistory(transactions, pairs, user.uid) : []),
    [transactions, pairs, user]
  );
  const chartData = useMemo(
    () => historyForPeriod(history, periodStartMs(period)),
    [history, period]
  );

  if (chartData.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <PeriodTabs period={period} onChange={onPeriodChange} />
        <div className="flex items-center justify-center h-[200px] text-sm text-gray-400 bg-gray-50 rounded-xl border border-gray-100">
          No balance history yet
        </div>
      </div>
    );
  }

  const latestValue = chartData[chartData.length - 1].value;
  const isSettled = latestValue === 0;
  const allPositive = chartData.every((point) => point.value >= 0);
  const allNegative = chartData.every((point) => point.value <= 0);
  const strokeColor = isSettled
    ? "#9ca3af"
    : allNegative
    ? "#ef4444"
    : allPositive
    ? "#16a34a"
    : "#3b82f6";
  const hasZeroCrossing = !allPositive && !allNegative;
  const selectedPoint = selectedDayKey
    ? chartData.find((point) => point.dayKey === selectedDayKey)
    : undefined;

  return (
    <div className="space-y-3">
      <PeriodTabs period={period} onChange={onPeriodChange} />
      <div data-testid="net-balance-chart">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
            onClick={({ activeTooltipIndex }) => {
              const index = selectedChartIndex(activeTooltipIndex, chartData.length);
              if (index !== null) setSelectedDayKey(chartData[index]!.dayKey);
            }}
          >
            <defs>
              <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.18} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="axisLabel"
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => `${symbol}${Math.abs(value).toFixed(0)}`}
            />
            {hasZeroCrossing && (
              <ReferenceLine y={0} stroke="#d1d5db" strokeDasharray="4 4" />
            )}
            <Tooltip
              cursor={{ stroke: "#d1d5db", strokeDasharray: "4 4" }}
              content={(props) => (
                <BalanceHistoryTooltip
                  active={props.active}
                  payload={props.payload as unknown as ReadonlyArray<{ payload?: BalanceHistoryPoint }>}
                  currency={currency}
                  label="Net balance"
                  testId="net-balance-tooltip"
                />
              )}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={strokeColor}
              fill="url(#netGrad)"
              strokeWidth={2}
              dot={false}
              activeDot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        <BalanceHistoryDetails
          point={selectedPoint}
          currency={currency}
          label="Net balance"
          testId="net-balance-details"
        />
      </div>
    </div>
  );
}

function PeriodTabs({
  period,
  onChange,
}: {
  period: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div className="flex gap-1">
      {PERIODS.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
            period === p
              ? "bg-gray-800 text-white"
              : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          }`}
        >
          {PERIOD_LABELS[p]}
        </button>
      ))}
    </div>
  );
}
