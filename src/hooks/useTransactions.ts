import { useEffect, useState } from "react";
import {
  collection,
  query,
  onSnapshot,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Transaction } from "@/types";
import { sortTransactionsByEventDate } from "@/utils/transactionDate";

export function useTransactions(
  pairId: string | undefined,
  options: { includeArchived?: boolean } = {}
) {
  const { includeArchived = false } = options;
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

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Transaction));
        const filtered = includeArchived
          ? items
          : items.filter((t) => t.archived !== true);
        setTransactions(sortTransactionsByEventDate(filtered));
        setLoading(false);
      },
      (error) => {
        // A direct link can be opened by someone who is not a member of the
        // pair. Treat the rules rejection as an unavailable balance rather
        // than leaving the detail page in its loading state or logging a noisy
        // browser error. Other listener failures still remain visible.
        if (error.code !== "permission-denied") {
          console.error(`Transactions listener error for pair ${pairId}:`, error);
        }
        setTransactions([]);
        setLoading(false);
      }
    );

    return unsub;
  }, [pairId, includeArchived]);

  return { transactions, loading };
}
