import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  getDoc,
  getDocs,
  addDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Invite } from "@/types";

export function useInvites() {
  const { user } = useAuth();
  const [pendingInvites, setPendingInvites] = useState<Invite[]>([]);
  const [sentInvites, setSentInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.email) {
      setPendingInvites([]);
      setSentInvites([]);
      setLoading(false);
      return;
    }

    let receivedLoaded = false;
    let sentLoaded = false;

    const receivedQ = query(
      collection(db, "invites"),
      where("toEmail", "==", user.email.toLowerCase()),
      where("status", "==", "pending")
    );

    const sentQ = query(
      collection(db, "invites"),
      where("fromUid", "==", user.uid),
      where("status", "==", "pending")
    );

    const unsubReceived = onSnapshot(receivedQ, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Invite));
      setPendingInvites(items);
      receivedLoaded = true;
      if (sentLoaded) setLoading(false);
    });

    const unsubSent = onSnapshot(sentQ, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Invite));
      setSentInvites(items);
      sentLoaded = true;
      if (receivedLoaded) setLoading(false);
    });

    return () => {
      unsubReceived();
      unsubSent();
    };
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

    // Create the pending transaction so the invitee can approve or dispute it
    if (invite.pendingTransaction) {
      const { amount, type, description, date } = invite.pendingTransaction;
      await addDoc(collection(db, "pairs", invite.pairId, "transactions"), {
        pairId: invite.pairId,
        amount,
        type,
        description,
        createdBy: invite.fromUid,
        status: "pending",
        date: Timestamp.fromDate(new Date(date + "T12:00:00")),
        createdAt: serverTimestamp(),
      });
    }
  }

  async function cancelInvite(invite: Invite) {
    if (!user) return;

    // Delete all queued transactions in the pending pair's subcollection
    const txSnap = await getDocs(collection(db, "pairs", invite.pairId, "transactions"));
    await Promise.all(txSnap.docs.map((d) => deleteDoc(d.ref)));

    // Delete the pair document
    await deleteDoc(doc(db, "pairs", invite.pairId));

    // Delete the invite document
    await deleteDoc(doc(db, "invites", invite.id));
  }

  return { pendingInvites, sentInvites, loading, acceptInvite, cancelInvite };
}
