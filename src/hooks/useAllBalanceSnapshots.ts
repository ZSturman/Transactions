import { useEffect, useState } from "react";
import { collection, query, onSnapshot, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Pair, BalanceSnapshot } from "@/types";

export interface PairBalanceSnapshot extends BalanceSnapshot {
  pairId: string;
}

export function useAllBalanceSnapshots(pairs: Pair[]) {
  const [snapshots, setSnapshots] = useState<PairBalanceSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const activePairs = pairs.filter((p) => p.status === "active");

    if (activePairs.length === 0) {
      setSnapshots([]);
      setLoading(false);
      return;
    }

    const snapshotMap = new Map<string, PairBalanceSnapshot[]>();
    activePairs.forEach((p) => snapshotMap.set(p.id, []));

    let pendingCount = activePairs.length;

    const unsubs = activePairs.map((pair) => {
      const q = query(
        collection(db, "pairs", pair.id, "balanceSnapshots"),
        orderBy("timestamp", "asc")
      );

      return onSnapshot(
        q,
        (snap) => {
          const items = snap.docs.map((d) => ({
            id: d.id,
            pairId: pair.id,
            ...d.data(),
          } as PairBalanceSnapshot));

          snapshotMap.set(pair.id, items);

          if (pendingCount > 0) pendingCount--;

          if (pendingCount === 0) {
            const all = Array.from(snapshotMap.values())
              .flat()
              .sort((a, b) => {
                const ta = a.timestamp?.toMillis?.() ?? 0;
                const tb = b.timestamp?.toMillis?.() ?? 0;
                return ta - tb;
              });
            setSnapshots(all);
            setLoading(false);
          }
        },
        (error) => {
          console.error(`Snapshot listener error for pair ${pair.id}:`, error);
          if (pendingCount > 0) pendingCount--;
          if (pendingCount === 0) setLoading(false);
        }
      );
    });

    return () => unsubs.forEach((unsub) => unsub());
  }, [pairs]);

  return { snapshots, loading };
}
