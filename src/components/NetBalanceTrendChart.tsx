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
} from "recharts";
import { Pair } from "@/types";
import { PairBalanceSnapshot } from "@/hooks/useAllBalanceSnapshots";
import { getCurrencySymbol } from "@/utils/currency";
import { useAuth } from "@/contexts/AuthContext";

type Period = "7D" | "30D" | "90D" | "1Y" | "all";

interface NetBalanceTrendChartProps {
  snapshots: PairBalanceSnapshot[];
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

interface NetBalanceChartPoint {
  date: string;
  tooltipDate: string;
  value: number;
  change?: number;
  reason?: string;
  isOpeningBalance?: boolean;
}

function periodStartMs(period: Period): number {
  if (period === "all") return 0;
  const now = Date.now();
  const days: Record<Exclude<Period, "all">, number> = {
    "7D": 7,
    "30D": 30,
    "90D": 90,
    "1Y": 365,
  };
  return now - days[period] * 24 * 60 * 60 * 1000;
}

function formatChange(value: number, symbol: string) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${symbol}${Math.abs(value).toFixed(2)}`;
}

function formatReason(reason: string) {
  return reason
    .replace(/[-_]/g, " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export default function NetBalanceTrendChart({
  snapshots,
  pairs,
  currency,
  period,
  onPeriodChange,
}: NetBalanceTrendChartProps) {
  const { user } = useAuth();
  const symbol = getCurrencySymbol(currency);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const chartData = useMemo<NetBalanceChartPoint[]>(() => {
    if (!user || snapshots.length === 0) return [];

    // Map pairId → user-perspective multiplier (1 if users[0], -1 if users[1])
    const pairMultiplier = new Map<string, number>();
    for (const p of pairs) {
      const idx = p.users.indexOf(user.uid);
      pairMultiplier.set(p.id, idx === 0 ? 1 : -1);
    }

    // Sort all snapshots by timestamp ascending
    const sorted = [...snapshots].sort(
      (a, b) => (a.timestamp?.toMillis?.() ?? 0) - (b.timestamp?.toMillis?.() ?? 0)
    );

    const cutoff = periodStartMs(period);

    // Build step-function: track latest balance per pair, emit net at each event
    const latestByPair = new Map<string, number>(); // pairId → user-perspective balance
    const points: { ts: number; net: number; reason: string }[] = [];

    for (const snap of sorted) {
      const mult = pairMultiplier.get(snap.pairId) ?? 1;
      const userBalance = snap.balance * mult;
      latestByPair.set(snap.pairId, userBalance);

      const net = Array.from(latestByPair.values()).reduce((s, v) => s + v, 0);
      points.push({
        ts: snap.timestamp?.toMillis?.() ?? 0,
        net,
        reason: snap.reason,
      });
    }

    if (points.length === 0) return [];

    // Find the last point before cutoff to anchor the start
    const periodPoints: { ts: number; net: number; reason: string }[] = [];
    let anchor: { ts: number; net: number; reason: string } | null = null;
    for (const p of points) {
      if (p.ts < cutoff) {
        anchor = p;
      } else {
        periodPoints.push(p);
      }
    }

    const displayPoints: Array<{
      ts: number;
      net: number;
      reason: string;
      isOpeningBalance?: boolean;
    }> = anchor
      ? [{ ts: cutoff, net: anchor.net, reason: "Opening balance", isOpeningBalance: true }, ...periodPoints]
      : periodPoints;

    if (displayPoints.length === 0 && anchor) {
      displayPoints.push({
        ts: cutoff,
        net: anchor.net,
        reason: "Opening balance",
        isOpeningBalance: true,
      });
    }

    return displayPoints.map((p, index) => {
      const date = new Date(p.ts);
      return {
        date: date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          ...(period === "1Y" || period === "all" ? { year: "2-digit" } : {}),
        }),
        tooltipDate: date.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
        value: p.net,
        change:
          p.isOpeningBalance || index === 0 ? undefined : p.net - displayPoints[index - 1].net,
        reason: p.reason,
        isOpeningBalance: p.isOpeningBalance,
      };
    });
  }, [snapshots, pairs, user, period]);

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
  const allPositive = chartData.every((d) => d.value >= 0);
  const allNegative = chartData.every((d) => d.value <= 0);
  const strokeColor = isSettled
    ? "#9ca3af"
    : allNegative
    ? "#ef4444"
    : allPositive
    ? "#16a34a"
    : "#3b82f6";
  const hasZeroCrossing = !allPositive && !allNegative;
  const selectedPoint = selectedIndex === null ? undefined : chartData[selectedIndex];

  return (
    <div className="space-y-3">
      <PeriodTabs period={period} onChange={onPeriodChange} />
      <div data-testid="net-balance-chart">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.18} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${symbol}${Math.abs(v).toFixed(0)}`}
            />
            {hasZeroCrossing && (
              <ReferenceLine y={0} stroke="#d1d5db" strokeDasharray="4 4" />
            )}
            <Area
              type="monotone"
              dataKey="value"
              stroke={strokeColor}
              fill="url(#netGrad)"
              strokeWidth={2}
              dot={(props) => {
                const { cx, cy, index } = props;
                if (typeof cx !== "number" || typeof cy !== "number" || typeof index !== "number") {
                  return null;
                }

                const isSelected = index === selectedIndex;
                return (
                  <g
                    data-testid={`net-balance-point-${index}`}
                    className="cursor-pointer"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedIndex(index);
                    }}
                  >
                    <circle cx={cx} cy={cy} r={14} fill="transparent" />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isSelected ? 5 : 3}
                      fill="white"
                      stroke={strokeColor}
                      strokeWidth={isSelected ? 3 : 2}
                      pointerEvents="none"
                    />
                  </g>
                );
              }}
              activeDot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        <div
          data-testid="net-balance-details"
          aria-live="polite"
          className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600"
        >
          {selectedPoint ? (
            <div className="space-y-1">
              <p className="font-semibold text-gray-700">{selectedPoint.tooltipDate}</p>
              <p>
                Net balance: {symbol}{Math.abs(selectedPoint.value).toFixed(2)}{" "}
                {selectedPoint.value === 0
                  ? "(settled)"
                  : selectedPoint.value > 0
                  ? "(owed to you)"
                  : "(you owe)"}
              </p>
              {selectedPoint.change !== undefined && (
                <p>Change: {formatChange(selectedPoint.change, symbol)}</p>
              )}
              {selectedPoint.isOpeningBalance ? (
                <p className="text-gray-400">Opening balance for this period</p>
              ) : selectedPoint.reason ? (
                <p className="text-gray-400">{formatReason(selectedPoint.reason)}</p>
              ) : null}
            </div>
          ) : (
            "Tap or click a point to see the net balance and change on that date."
          )}
        </div>
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
