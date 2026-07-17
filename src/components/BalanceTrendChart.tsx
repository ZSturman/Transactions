"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { BalanceSnapshot, Pair } from "@/types";
import { getCurrencySymbol } from "@/utils/currency";
import { useAuth } from "@/contexts/AuthContext";

interface BalanceTrendChartProps {
  snapshots: BalanceSnapshot[];
  pair: Pair;
  mini?: boolean;
}

interface BalanceChartPoint {
  date: string;
  value: number;
}

export default function BalanceTrendChart({ snapshots, pair, mini = false }: BalanceTrendChartProps) {
  const { user } = useAuth();

  const data = useMemo<BalanceChartPoint[]>(() => {
    if (!user) return [];
    const userIdx = pair.users.indexOf(user.uid);

    return [...snapshots]
      .sort((a, b) => (a.timestamp?.toMillis?.() ?? 0) - (b.timestamp?.toMillis?.() ?? 0))
      .map((snapshot) => {
        const date = snapshot.timestamp?.toDate?.();
        return {
          date: date
            ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "",
          value: userIdx === 0 ? snapshot.balance : -snapshot.balance,
        };
      });
  }, [snapshots, pair, user]);

  const symbol = getCurrencySymbol(pair.currency);

  if (data.length === 0) {
    if (mini) return null;
    return (
      <div className="flex items-center justify-center h-24 text-xs text-gray-400">
        No balance history yet
      </div>
    );
  }

  const height = mini ? 48 : 180;
  const latestValue = data[data.length - 1].value;
  const isSettled = latestValue === 0;
  const positive = data.every((point) => point.value >= 0);
  const negative = data.every((point) => point.value <= 0);
  const strokeColor = isSettled
    ? "#9ca3af"
    : negative
    ? "#ef4444"
    : positive
    ? "#16a34a"
    : "#3b82f6";
  const fillColor = isSettled
    ? "#f3f4f6"
    : negative
    ? "#fee2e2"
    : positive
    ? "#dcfce7"
    : "#dbeafe";

  return (
    <div data-testid={mini ? undefined : "balance-history-chart"}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: mini ? -32 : -12, bottom: 0 }}>
          {!mini && <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />}
          {!mini && (
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
          )}
          {!mini && (
            <YAxis
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => `${symbol}${Math.abs(value).toFixed(0)}`}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke={strokeColor}
            fill={fillColor}
            strokeWidth={mini ? 1.5 : 2}
            dot={false}
            activeDot={false}
            isAnimationActive={!mini}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
