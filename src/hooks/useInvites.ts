import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Invite } from "@/types";

export function useInvites() {
  const { user } = useAuth();
  const [pendingInvites, setPendingInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.email) {
      setPendingInvites([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "invites"),
      where("toEmail", "==", user.email.toLowerCase()),
      where("status", "==", "pending")
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Invite));
      setPendingInvites(items);
      setLoading(false);
    });

    return unsub;
  }, [user]);

  async function acceptInvite(invite: Invite) {
    if (!user) return;

    // Update invite status
    await updateDoc(doc(db, "invites", invite.id), { status: "accepted" });

    // Update the pair to include this user
    const pairRef = doc(db, "pairs", invite.pairId);
    const pairSnap = await getDoc(pairRef);
    if (!pairSnap.exists()) return;

    const pairData = pairSnap.data();
    const users = [...pairData.users] as [string, string];
    const userEmails = [...pairData.userEmails] as [string, string];
    const userNames = [...pairData.userNames] as [string, string];

    // Fill in the placeholder slot (index 1)
    users[1] = user.uid;
    userEmails[1] = user.email!;
    userNames[1] = user.displayName || user.email!;

    await updateDoc(pairRef, {
      users,
      userEmails,
      userNames,
      status: "active",
      updatedAt: serverTimestamp(),
    });
  }

  return { pendingInvites, loading, acceptInvite };
}
