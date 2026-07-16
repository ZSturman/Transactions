import { Pair, SplitDetails, Transaction } from "@/types";

export type TransactionDirection = "i_paid" | "they_paid";
export type TransactionEntryMode = "payment" | "split";

/** Round a calculated split to the smallest unit represented by the app. */
export function roundAmount(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Returns the amount that changes the balance for a split expense. `direction`
 * represents who paid the entire bill: "i_paid" means the creator paid it.
 */
export function splitDebtAmount(
  totalAmount: number,
  creatorSharePercent: number,
  direction: TransactionDirection
): number {
  const sharePercent = direction === "i_paid"
    ? 100 - creatorSharePercent
    : creatorSharePercent;
  return roundAmount(totalAmount * (sharePercent / 100));
}

export function splitDetailsFor(
  totalAmount: number,
  creatorSharePercent: number,
  direction: TransactionDirection
): SplitDetails {
  return {
    totalAmount: roundAmount(totalAmount),
    creatorSharePercent,
    paidBy: direction === "i_paid" ? "creator" : "partner",
  };
}

export function partnerNameFor(pair: Pair, userId: string): string {
  const userIndex = pair.users.indexOf(userId);
  const partnerIndex = userIndex === 0 ? 1 : 0;
  return pair.userNames[partnerIndex] || pair.userEmails[partnerIndex] || "your partner";
}

/** Whether the current user is the person owed by this transaction. */
export function userIsOwedByTransaction(tx: Transaction, userId: string): boolean | null {
  if (tx.type === "payment") return tx.createdBy === userId;
  if (tx.type === "request") return tx.createdBy !== userId;
  return null;
}

/** A direct, viewer-specific balance effect such as "You owe Jordan". */
export function obligationText(tx: Transaction, pair: Pair, userId: string): string | null {
  const userIsOwed = userIsOwedByTransaction(tx, userId);
  if (userIsOwed === null) return null;
  const partnerName = partnerNameFor(pair, userId);
  return userIsOwed ? `${partnerName} owes you` : `You owe ${partnerName}`;
}

export function transactionTypeLabel(tx: Transaction): string {
  if (tx.split) return "Split expense";
  const labels: Partial<Record<Transaction["type"], string>> = {
    payment: "Payment",
    request: "Payment",
    adjustment: "Adjustment",
    settlement: "Settlement",
    forgiveness: "Forgiven",
  };
  return labels[tx.type] ?? tx.type;
}
