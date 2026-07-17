"use client";

import { Transaction, Pair } from "@/types";
import TransactionItem from "@/components/TransactionItem";
import { sortTransactionsByEventDate } from "@/utils/transactionDate";

interface TransactionListProps {
  transactions: Transaction[];
  pair: Pair;
  onApprove?: (tx: Transaction) => void;
  onDispute?: (tx: Transaction, reason: string, proposedAmount?: number) => void;
  onDenySettlement?: (tx: Transaction) => void;
  onAcceptCounter?: (tx: Transaction) => void;
  onRejectCounter?: (tx: Transaction) => void;
  onArchive?: (tx: Transaction) => void;
  onUnarchive?: (tx: Transaction) => void;
  onCancel?: (tx: Transaction) => void;
}

export default function TransactionList({ transactions, pair, onApprove, onDispute, onDenySettlement, onAcceptCounter, onRejectCounter, onArchive, onUnarchive, onCancel }: TransactionListProps) {
  if (transactions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        No transactions yet. Record one above.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sortTransactionsByEventDate(transactions).map((tx) => (
        <TransactionItem
          key={tx.id}
          transaction={tx}
          pair={pair}
          onApprove={onApprove}
          onDispute={onDispute}
          onDenySettlement={onDenySettlement}
          onAcceptCounter={onAcceptCounter}
          onRejectCounter={onRejectCounter}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onCancel={onCancel}
        />
      ))}
    </div>
  );
}
