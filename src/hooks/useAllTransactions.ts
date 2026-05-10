import { useEffect, useState } from "react";
import { collection, query, onSnapshot, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Pair, Transaction } from "@/types";

export interface PairTransaction extends Transaction {
  pairId: string;
}

export function useAllTransactions(
  pairs: Pair[],
  options: { includeArchived?: boolean } = {}
) {
  const { includeArchived = false } = options;
  const [transactions, setTransactions] = useState<PairTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const activePairs = pairs.filter((p) => p.status === "active");

    if (activePairs.length === 0) {
      setTransactions([]);
      setLoading(false);
      return;
    }

    // Map from pairId → array of transactions
    const txMap = new Map<string, PairTransaction[]>();
    activePairs.forEach((p) => txMap.set(p.id, []));

    let pendingCount = activePairs.length;

    const unsubs = activePairs.map((pair) => {
      const q = query(
        collection(db, "pairs", pair.id, "transactions"),
        orderBy("createdAt", "desc")
      );

      return onSnapshot(q, (snap) => {
        const items = snap.docs
          .map((d) => ({
            id: d.id,
            pairId: pair.id,
            ...d.data(),
          } as PairTransaction))
          .filter((t) => includeArchived || t.archived !== true);

        txMap.set(pair.id, items);

        if (pendingCount > 0) pendingCount--;

        if (pendingCount === 0) {
          const all = Array.from(txMap.values())
            .flat()
            .sort((a, b) => {
              const ta = a.createdAt?.toMillis?.() ?? 0;
              const tb = b.createdAt?.toMillis?.() ?? 0;
              return tb - ta;
            });
          setTransactions(all);
          setLoading(false);
        }
      }, (error) => {
        console.error(`Transactions listener error for pair ${pair.id}:`, error);
        if (pendingCount > 0) pendingCount--;
        if (pendingCount === 0) setLoading(false);
      });
    });

    return () => unsubs.forEach((unsub) => unsub());
  }, [pairs, includeArchived]);

  return { transactions, loading };
}
