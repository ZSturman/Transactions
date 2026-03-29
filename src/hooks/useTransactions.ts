import { useEffect, useState } from "react";
import {
  collection,
  query,
  onSnapshot,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Transaction } from "@/types";

export function useTransactions(pairId: string | undefined) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pairId) {
      setTransactions([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "pairs", pairId, "transactions"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Transaction));
      setTransactions(items);
      setLoading(false);
    });

    return unsub;
  }, [pairId]);

  return { transactions, loading };
}
