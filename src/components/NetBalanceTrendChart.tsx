"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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

export default function NetBalanceTrendChart({
  snapshots,
  pairs,
  currency,
  period,
  onPeriodChange,
}: NetBalanceTrendChartProps) {
  const { user } = useAuth();
  const symbol = getCurrencySymbol(currency);

  const chartData = useMemo(() => {
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
    const points: { ts: number; net: number }[] = [];

    for (const snap of sorted) {
      const mult = pairMultiplier.get(snap.pairId) ?? 1;
      const userBalance = snap.balance * mult;
      latestByPair.set(snap.pairId, userBalance);

      const net = Array.from(latestByPair.values()).reduce((s, v) => s + v, 0);
      points.push({ ts: snap.timestamp?.toMillis?.() ?? 0, net });
    }

    if (points.length === 0) return [];

    // Find the last point before cutoff to anchor the start
    const periodPoints: { ts: number; net: number }[] = [];
    let anchor: { ts: number; net: number } | null = null;
    for (const p of points) {
      if (p.ts < cutoff) {
        anchor = p;
      } else {
        periodPoints.push(p);
      }
    }

    const displayPoints = anchor
      ? [{ ts: cutoff, net: anchor.net }, ...periodPoints]
      : periodPoints;

    if (displayPoints.length === 0 && anchor) {
      displayPoints.push({ ts: cutoff, net: anchor.net });
    }

    return displayPoints.map((p) => ({
      date: new Date(p.ts).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        ...(period === "1Y" || period === "all" ? { year: "2-digit" } : {}),
      }),
      value: p.net,
    }));
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

  const allPositive = chartData.every((d) => d.value >= 0);
  const allNegative = chartData.every((d) => d.value <= 0);
  const strokeColor = allNegative ? "#ef4444" : allPositive ? "#16a34a" : "#3b82f6";
  const fillColor = allNegative ? "#fee2e2" : allPositive ? "#dcfce7" : "#dbeafe";
  const hasZeroCrossing = !allPositive && !allNegative;

  return (
    <div className="space-y-3">
      <PeriodTabs period={period} onChange={onPeriodChange} />
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
          <Tooltip
            formatter={(value) => {
              const num = typeof value === "number" ? value : 0;
              return [
                `${symbol}${Math.abs(num).toFixed(2)} ${
                  num >= 0 ? "(owed to you)" : "(you owe)"
                }`,
                "Net Balance",
              ];
            }}
            labelStyle={{ fontSize: 11, color: "#6b7280" }}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={strokeColor}
            fill="url(#netGrad)"
            strokeWidth={2}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
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
