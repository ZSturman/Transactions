import { useEffect, useState } from "react";
import { collection, query, onSnapshot, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { BalanceSnapshot } from "@/types";

export function useBalanceSnapshots(pairId: string | undefined) {
  const [snapshots, setSnapshots] = useState<BalanceSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pairId) {
      setSnapshots([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "pairs", pairId, "balanceSnapshots"),
      orderBy("timestamp", "asc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BalanceSnapshot));
      setSnapshots(items);
      setLoading(false);
    });

    return unsub;
  }, [pairId]);

  return { snapshots, loading };
}
