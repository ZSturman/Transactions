"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Pair } from "@/types";
import { formatAmount } from "@/utils/currency";

interface PairCardProps {
  pair: Pair;
}

export default function PairCard({ pair }: PairCardProps) {
  const { user } = useAuth();
  if (!user) return null;

  const idx = pair.users.indexOf(user.uid);
  const partnerName = pair.userNames[idx === 0 ? 1 : 0];
  const partnerEmail = pair.userEmails[idx === 0 ? 1 : 0];

  // Positive means current user is owed; negative means current user owes
  const userBalance = idx === 0 ? pair.balance : -pair.balance;

  return (
    <Link href={`/pair/${pair.id}`} className="card block hover:border-blue-300 transition-colors">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{partnerName}</p>
          <p className="text-xs text-gray-400 truncate">{partnerEmail}</p>
        </div>
        <div className="text-right flex-shrink-0 ml-4">
          <p
            className={`font-bold text-lg ${
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
          <p className="text-xs text-gray-400">
            {userBalance > 0
              ? "they owe you"
              : userBalance < 0
              ? "you owe them"
              : "settled up"}
          </p>
        </div>
      </div>
    </Link>
  );
}
