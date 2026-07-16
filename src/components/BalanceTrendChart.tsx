"use client";

import { useMemo, useState } from "react";
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
  tooltipDate: string;
  value: number;
  change?: number;
  reason: string;
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

export default function BalanceTrendChart({ snapshots, pair, mini = false }: BalanceTrendChartProps) {
  const { user } = useAuth();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const data = useMemo<BalanceChartPoint[]>(() => {
    if (!user) return [];
    const userIdx = pair.users.indexOf(user.uid);

    return [...snapshots]
      .sort((a, b) => (a.timestamp?.toMillis?.() ?? 0) - (b.timestamp?.toMillis?.() ?? 0))
      .map((s, index, orderedSnapshots) => {
      // Positive = user is owed money; negative = user owes money
      const value = userIdx === 0 ? s.balance : -s.balance;
      const date = s.timestamp?.toDate?.();
      const previousSnapshot = orderedSnapshots[index - 1];
      const previousValue = previousSnapshot
        ? userIdx === 0
          ? previousSnapshot.balance
          : -previousSnapshot.balance
        : undefined;

      return {
        date: date
          ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : "",
        tooltipDate: date
          ? date.toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
          : "Unknown date",
        value,
        change: previousValue === undefined ? undefined : value - previousValue,
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

  const latestValue = data[data.length - 1].value;
  const isSettled = latestValue === 0;
  const positive = data.every((d) => d.value >= 0);
  const negative = data.every((d) => d.value <= 0);
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
  const selectedPoint = selectedIndex === null ? undefined : data[selectedIndex];

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
              tickFormatter={(v) => `${symbol}${Math.abs(v).toFixed(0)}`}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke={strokeColor}
            fill={fillColor}
            strokeWidth={mini ? 1.5 : 2}
            dot={
              mini
                ? false
                : (props) => {
                    const { cx, cy, index } = props;
                    if (typeof cx !== "number" || typeof cy !== "number" || typeof index !== "number") {
                      return null;
                    }

                    const isSelected = index === selectedIndex;
                    return (
                      <g
                        data-testid={`balance-history-point-${index}`}
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
                  }
            }
            isAnimationActive={!mini}
          />
        </AreaChart>
      </ResponsiveContainer>
      {!mini && (
        <div
          data-testid="balance-history-details"
          aria-live="polite"
          className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600"
        >
          {selectedPoint ? (
            <div className="space-y-1">
              <p className="font-semibold text-gray-700">{selectedPoint.tooltipDate}</p>
              <p>
                Balance: {symbol}{Math.abs(selectedPoint.value).toFixed(2)}{" "}
                {selectedPoint.value === 0
                  ? "(settled)"
                  : selectedPoint.value > 0
                  ? "(owed to you)"
                  : "(you owe)"}
              </p>
              {selectedPoint.change !== undefined && (
                <p>Change: {formatChange(selectedPoint.change, symbol)}</p>
              )}
              {selectedPoint.reason && <p className="text-gray-400">{formatReason(selectedPoint.reason)}</p>}
            </div>
          ) : (
            "Tap or click a point to see the balance and change on that date."
          )}
        </div>
      )}
    </div>
  );
}
