import { Pair, Transaction } from "@/types";
import { transactionEventDate, transactionEventDateMillis } from "@/utils/transactionDate";

export interface BalanceHistoryPoint {
  dayKey: string;
  timestamp: number;
  axisLabel: string;
  tooltipDate: string;
  value: number;
  change: number;
  transactionCount: number;
  isOpeningBalance?: boolean;
}

interface UndecoratedPoint {
  dayKey: string;
  timestamp: number;
  value: number;
  change: number;
  transactionCount: number;
  isOpeningBalance?: boolean;
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function localDay(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    timestamp: new Date(year, month, day, 12).getTime(),
  };
}

function decorate(points: UndecoratedPoint[]): BalanceHistoryPoint[] {
  return points.map((point) => {
    const date = new Date(point.timestamp);
    return {
      ...point,
      axisLabel: date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "2-digit",
      }),
      tooltipDate: date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    };
  });
}

function canonicalBalanceDelta(transaction: Transaction, pair: Pair): number | "settled" | null {
  const creatorIndex = pair.users.indexOf(transaction.createdBy);
  if (creatorIndex === -1) return null;

  if (transaction.type === "settlement") return "settled";
  if (transaction.type === "forgiveness") {
    return creatorIndex === 0 ? -transaction.amount : transaction.amount;
  }

  if (transaction.type === "payment") {
    return creatorIndex === 0 ? transaction.amount : -transaction.amount;
  }

  // Requests and adjustments use the same balance direction in the approval
  // flow: the creator's side of the pair owes the other person.
  return creatorIndex === 0 ? -transaction.amount : transaction.amount;
}

/**
 * Reconstruct a pair's user-facing balance from resolved transactions at the
 * date the money event occurred, rather than when it was approved in the app.
 */
export function buildPairBalanceHistory(
  transactions: Transaction[],
  pair: Pair,
  userId: string
): BalanceHistoryPoint[] {
  const viewerIndex = pair.users.indexOf(userId);
  if (viewerIndex === -1) return [];
  const viewerMultiplier = viewerIndex === 0 ? 1 : -1;

  const events = transactions
    .filter((transaction) => transaction.status === "approved")
    .map((transaction) => {
      const date = transactionEventDate(transaction);
      const delta = canonicalBalanceDelta(transaction, pair);
      if (!date || delta === null) return null;
      return {
        transaction,
        delta,
        timestamp: transactionEventDateMillis(transaction),
        createdTimestamp: transaction.createdAt?.toMillis?.() ?? 0,
        day: localDay(date),
      };
    })
    .filter((event): event is NonNullable<typeof event> => event !== null)
    .sort(
      (a, b) =>
        a.timestamp - b.timestamp ||
        a.createdTimestamp - b.createdTimestamp ||
        a.transaction.id.localeCompare(b.transaction.id)
    );

  let canonicalBalance = 0;
  const daily = new Map<string, UndecoratedPoint>();

  for (const event of events) {
    const before = canonicalBalance * viewerMultiplier;
    canonicalBalance = event.delta === "settled"
      ? 0
      : roundCurrency(canonicalBalance + event.delta);
    const after = canonicalBalance * viewerMultiplier;
    const existing = daily.get(event.day.key);

    if (existing) {
      existing.value = after;
      existing.change = roundCurrency(existing.change + (after - before));
      existing.transactionCount += 1;
    } else {
      daily.set(event.day.key, {
        dayKey: event.day.key,
        timestamp: event.day.timestamp,
        value: after,
        change: roundCurrency(after - before),
        transactionCount: 1,
      });
    }
  }

  return decorate(
    Array.from(daily.values()).sort((a, b) => a.timestamp - b.timestamp)
  );
}

/** Combine each pair's reconstructed balance into one net historical series. */
export function buildNetBalanceHistory(
  transactions: Array<Transaction & { pairId: string }>,
  pairs: Pair[],
  userId: string
): BalanceHistoryPoint[] {
  const pairById = new Map(pairs.map((pair) => [pair.id, pair]));
  const updatesByDay = new Map<string, Array<{ pairId: string; point: BalanceHistoryPoint }>>();

  for (const pair of pairs) {
    const pairTransactions = transactions.filter((transaction) => transaction.pairId === pair.id);
    for (const point of buildPairBalanceHistory(pairTransactions, pair, userId)) {
      const updates = updatesByDay.get(point.dayKey) ?? [];
      updates.push({ pairId: pair.id, point });
      updatesByDay.set(point.dayKey, updates);
    }
  }

  const balancesByPair = new Map<string, number>();
  const points: UndecoratedPoint[] = [];
  let previousNet = 0;

  for (const [dayKey, updates] of Array.from(updatesByDay.entries()).sort(
    ([, a], [, b]) => a[0]!.point.timestamp - b[0]!.point.timestamp
  )) {
    for (const update of updates) {
      if (pairById.has(update.pairId)) {
        balancesByPair.set(update.pairId, update.point.value);
      }
    }

    const net = roundCurrency(Array.from(balancesByPair.values()).reduce((total, balance) => total + balance, 0));
    const representative = updates[0]!.point;
    points.push({
      dayKey,
      timestamp: representative.timestamp,
      value: net,
      change: roundCurrency(net - previousNet),
      transactionCount: updates.reduce((count, update) => count + update.point.transactionCount, 0),
    });
    previousNet = net;
  }

  return decorate(points);
}

/** Keep the balance immediately before the selected period as its opening value. */
export function historyForPeriod(
  history: BalanceHistoryPoint[],
  cutoff: number
): BalanceHistoryPoint[] {
  if (cutoff <= 0) return history;

  let opening: BalanceHistoryPoint | undefined;
  const visible: UndecoratedPoint[] = [];
  for (const point of history) {
    if (point.timestamp < cutoff) {
      opening = point;
    } else {
      visible.push(point);
    }
  }

  if (opening) {
    const openingDate = localDay(new Date(cutoff));
    visible.unshift({
      dayKey: openingDate.key,
      timestamp: openingDate.timestamp,
      value: opening.value,
      change: 0,
      transactionCount: 0,
      isOpeningBalance: true,
    });
  }

  return decorate(visible);
}
