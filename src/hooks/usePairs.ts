import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Pair } from "@/types";

export function usePairs() {
  const { user } = useAuth();
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setPairs([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "pairs"),
      where("users", "array-contains", user.uid),
      orderBy("updatedAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      // A pending local pair creation is visible to this listener before
      // Firestore has committed the parent document. Starting its nested
      // transaction listener in that window makes the rules correctly reject
      // the query because the parent does not exist yet. Conversely, remove a
      // locally deleted pair straight away so nested listeners unsubscribe
      // before its parent document is removed on the server.
      if (snap.metadata.hasPendingWrites) {
        const removedPairIds = snap.docChanges()
          .filter((change) => change.type === "removed")
          .map((change) => change.doc.id);

        if (removedPairIds.length > 0) {
          setPairs((current) => current.filter((pair) => !removedPairIds.includes(pair.id)));
        }
        setLoading(false);
        return;
      }

      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Pair));
      setPairs(items);
      setLoading(false);
    });

    return unsub;
  }, [user]);

  return { pairs, loading };
}
