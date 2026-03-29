"use client";

import { formatAmount } from "@/utils/currency";
import { Pair } from "@/types";
import { useAuth } from "@/contexts/AuthContext";

interface BalanceSummaryProps {
  pair: Pair;
}

export default function BalanceSummary({ pair }: BalanceSummaryProps) {
  const { user } = useAuth();
  if (!user) return null;

  const idx = pair.users.indexOf(user.uid);
  const userBalance = idx === 0 ? pair.balance : -pair.balance;
  const partnerName = pair.userNames[idx === 0 ? 1 : 0];

  return (
    <div className="text-center py-6">
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Current Balance</p>
      <p
        className={`text-4xl font-bold ${
          userBalance > 0
            ? "text-green-600"
            : userBalance < 0
            ? "text-red-600"
            : "text-gray-400"
        }`}
      >
        {userBalance > 0 ? "+" : ""}
        {formatAmount(userBalance, pair.currency)}
      </p>
      <p className="text-sm text-gray-500 mt-1">
        {userBalance > 0
          ? `${partnerName} owes you`
          : userBalance < 0
          ? `You owe ${partnerName}`
          : `All settled up with ${partnerName}`}
      </p>
    </div>
  );
}
