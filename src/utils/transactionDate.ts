import { Transaction } from "@/types";

type TimestampLike = {
  toDate?: () => Date;
  toMillis?: () => number;
} | undefined;

function timestampMillis(timestamp: TimestampLike): number | undefined {
  const millis = timestamp?.toMillis?.();
  if (typeof millis === "number") return millis;

  const date = timestamp?.toDate?.();
  return date instanceof Date ? date.getTime() : undefined;
}

/**
 * The date a transaction happened. `createdAt` is only retained as a
 * backwards-compatible fallback for transactions recorded before event dates
 * were collected.
 */
export function transactionEventDateMillis(transaction: Pick<Transaction, "date" | "createdAt">): number {
  return timestampMillis(transaction.date) ?? timestampMillis(transaction.createdAt) ?? 0;
}

export function transactionEventDate(transaction: Pick<Transaction, "date" | "createdAt">): Date | undefined {
  return transaction.date?.toDate?.() ?? transaction.createdAt?.toDate?.();
}

/** Return a new list ordered from the most recent transaction event to the oldest. */
export function sortTransactionsByEventDate<T extends Transaction>(transactions: T[]): T[] {
  return [...transactions].sort((a, b) => {
    const dateDifference = transactionEventDateMillis(b) - transactionEventDateMillis(a);
    return dateDifference || a.id.localeCompare(b.id);
  });
}
