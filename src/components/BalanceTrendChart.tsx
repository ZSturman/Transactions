"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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

export default function BalanceTrendChart({ snapshots, pair, mini = false }: BalanceTrendChartProps) {
  const { user } = useAuth();

  const data = useMemo(() => {
    if (!user) return [];
    const userIdx = pair.users.indexOf(user.uid);

    return snapshots.map((s) => {
      // Positive = user is owed money; negative = user owes money
      const value = userIdx === 0 ? s.balance : -s.balance;
      const date = s.timestamp?.toDate?.();
      return {
        date: date
          ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : "",
        value,
        reason: s.reason,
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

  const positive = data.every((d) => d.value >= 0);
  const negative = data.every((d) => d.value <= 0);
  const strokeColor = negative ? "#ef4444" : positive ? "#16a34a" : "#3b82f6";
  const fillColor = negative ? "#fee2e2" : positive ? "#dcfce7" : "#dbeafe";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: mini ? -32 : -12, bottom: 0 }}>
        {!mini && <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />}
        {!mini && (
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            axisLine={false}
            tickLine={false}
          />
        )}
        {!mini && (
          <YAxis
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${symbol}${Math.abs(v).toFixed(0)}`}
          />
        )}
        {!mini && (
          <Tooltip
            formatter={(value) => {
              const num = typeof value === "number" ? value : 0;
              return [
                `${symbol}${Math.abs(num).toFixed(2)} ${num >= 0 ? "(owed to you)" : "(you owe)"}`,
                "Balance",
              ];
            }}
            labelStyle={{ fontSize: 11 }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
          />
        )}
        <Area
          type="monotone"
          dataKey="value"
          stroke={strokeColor}
          fill={fillColor}
          strokeWidth={mini ? 1.5 : 2}
          dot={false}
          isAnimationActive={!mini}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
