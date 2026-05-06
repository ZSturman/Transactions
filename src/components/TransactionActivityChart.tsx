"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { PairTransaction } from "@/hooks/useAllTransactions";
import { getCurrencySymbol } from "@/utils/currency";

type Period = "7D" | "30D" | "90D" | "1Y" | "all";

interface TransactionActivityChartProps {
  transactions: PairTransaction[];
  currency: string;
  period: Period;
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

function bucketLabel(date: Date, period: Period): string {
  if (period === "7D") {
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  if (period === "30D" || period === "90D") {
    // Weekly buckets: "May 4"
    const monday = new Date(date);
    monday.setDate(date.getDate() - date.getDay() + 1);
    return monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  // Monthly for 1Y / all
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function bucketKey(date: Date, period: Period): string {
  if (period === "7D") {
    return date.toISOString().slice(0, 10);
  }
  if (period === "30D" || period === "90D") {
    const monday = new Date(date);
    monday.setDate(date.getDate() - date.getDay() + 1);
    return monday.toISOString().slice(0, 10);
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default function TransactionActivityChart({
  transactions,
  currency,
  period,
}: TransactionActivityChartProps) {
  const symbol = getCurrencySymbol(currency);
  const cutoff = periodStartMs(period);

  const chartData = useMemo(() => {
    const approved = transactions.filter(
      (tx) =>
        tx.status === "approved" &&
        tx.type !== "settlement" &&
        tx.type !== "forgiveness"
    );

    const bucketed = new Map<
      string,
      { label: string; received: number; paid: number }
    >();

    for (const tx of approved) {
      const ts = tx.createdAt?.toMillis?.() ?? 0;
      if (ts < cutoff) continue;
      const date = new Date(ts);
      const key = bucketKey(date, period);
      if (!bucketed.has(key)) {
        bucketed.set(key, { label: bucketLabel(date, period), received: 0, paid: 0 });
      }
      const bucket = bucketed.get(key)!;
      if (tx.type === "payment") {
        bucket.received += tx.amount;
      } else {
        bucket.paid += tx.amount;
      }
    }

    return Array.from(bucketed.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({
        ...v,
        received: parseFloat(v.received.toFixed(2)),
        paid: parseFloat(v.paid.toFixed(2)),
      }));
  }, [transactions, cutoff, period]);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[140px] text-sm text-gray-400 bg-gray-50 rounded-xl border border-gray-100">
        No activity in this period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart
        data={chartData}
        margin={{ top: 4, right: 4, left: -12, bottom: 0 }}
        barCategoryGap="30%"
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "#9ca3af" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#9ca3af" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${symbol}${v}`}
          width={45}
        />
        <Tooltip
          formatter={(value, name) => [
            `${symbol}${(value as number).toFixed(2)}`,
            name === "received" ? "Received" : "Paid",
          ]}
          labelStyle={{ fontSize: 11, color: "#6b7280" }}
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          }}
        />
        <Legend
          iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
          formatter={(value) => (value === "received" ? "Received" : "Paid")}
        />
        <Bar dataKey="received" fill="#16a34a" radius={[3, 3, 0, 0]} />
        <Bar dataKey="paid" fill="#ef4444" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
