"use client";

import { Transaction, Pair } from "@/types";
import TransactionItem from "@/components/TransactionItem";

interface TransactionListProps {
  transactions: Transaction[];
  pair: Pair;
  onApprove: (tx: Transaction) => void;
  onDispute: (tx: Transaction, reason: string) => void;
}

export default function TransactionList({ transactions, pair, onApprove, onDispute }: TransactionListProps) {
  if (transactions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        No transactions yet. Record one above.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {transactions.map((tx) => (
        <TransactionItem
          key={tx.id}
          transaction={tx}
          pair={pair}
          onApprove={onApprove}
          onDispute={onDispute}
        />
      ))}
    </div>
  );
}
