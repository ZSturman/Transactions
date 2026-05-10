"use client";

import { Transaction, Pair } from "@/types";
import TransactionItem from "@/components/TransactionItem";

interface TransactionListProps {
  transactions: Transaction[];
  pair: Pair;
  onApprove: (tx: Transaction) => void;
  onDispute: (tx: Transaction, reason: string, proposedAmount?: number) => void;
  onAcceptCounter?: (tx: Transaction) => void;
  onRejectCounter?: (tx: Transaction) => void;
  onArchive?: (tx: Transaction) => void;
  onUnarchive?: (tx: Transaction) => void;
}

export default function TransactionList({ transactions, pair, onApprove, onDispute, onAcceptCounter, onRejectCounter, onArchive, onUnarchive }: TransactionListProps) {
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
          onAcceptCounter={onAcceptCounter}
          onRejectCounter={onRejectCounter}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
        />
      ))}
    </div>
  );
}
