"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Pair, Transaction } from "@/types";
import { buildPairBalanceHistory, BalanceHistoryPoint } from "@/utils/balanceHistory";
import { getCurrencySymbol } from "@/utils/currency";
import { useAuth } from "@/contexts/AuthContext";
import { BalanceHistoryDetails, BalanceHistoryTooltip } from "@/components/BalanceChartDetails";

interface BalanceTrendChartProps {
  transactions: Transaction[];
  pair: Pair;
  mini?: boolean;
}

function selectedChartIndex(
  activeTooltipIndex: number | string | null | undefined,
  dataLength: number
): number | null {
  if (activeTooltipIndex === null || activeTooltipIndex === undefined) return null;
  const index = Number(activeTooltipIndex);
  return Number.isInteger(index) && index >= 0 && index < dataLength ? index : null;
}

export default function BalanceTrendChart({ transactions, pair, mini = false }: BalanceTrendChartProps) {
  const { user } = useAuth();
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const data = useMemo<BalanceHistoryPoint[]>(
    () => (user ? buildPairBalanceHistory(transactions, pair, user.uid) : []),
    [transactions, pair, user]
  );

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
  const selectedPoint = selectedDayKey
    ? data.find((point) => point.dayKey === selectedDayKey)
    : undefined;

  return (
    <div data-testid={mini ? undefined : "balance-history-chart"}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={data}
          margin={{ top: 4, right: 4, left: mini ? -32 : -12, bottom: 0 }}
          onClick={({ activeTooltipIndex }) => {
            const index = selectedChartIndex(activeTooltipIndex, data.length);
            if (index !== null) setSelectedDayKey(data[index]!.dayKey);
          }}
        >
          {!mini && <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />}
          {!mini && (
            <XAxis
              dataKey="axisLabel"
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
          {!mini && (
            <Tooltip
              cursor={{ stroke: "#d1d5db", strokeDasharray: "4 4" }}
              content={(props) => (
                <BalanceHistoryTooltip
                  active={props.active}
                  payload={props.payload as unknown as ReadonlyArray<{ payload?: BalanceHistoryPoint }>}
                  currency={pair.currency}
                  label="Balance"
                  testId="balance-history-tooltip"
                />
              )}
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
      {!mini && (
        <BalanceHistoryDetails
          point={selectedPoint}
          currency={pair.currency}
          label="Balance"
          testId="balance-history-details"
        />
      )}
    </div>
  );
}
