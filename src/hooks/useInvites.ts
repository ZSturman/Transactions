import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDocs,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  runTransaction,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Invite } from "@/types";

export function isInviteExpired(invite: Pick<Invite, "expiresAt">): boolean {
  return Boolean(invite.expiresAt?.toMillis && invite.expiresAt.toMillis() <= Date.now());
}

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
      setPendingInvites(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Invite)
          .filter((invite) => !isInviteExpired(invite))
      );
      receivedLoaded = true;
      if (sentLoaded) setLoading(false);
    });
    const unsubSent = onSnapshot(sentQ, (snap) => {
      setSentInvites(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Invite)
          .filter((invite) => !isInviteExpired(invite))
      );
      sentLoaded = true;
      if (receivedLoaded) setLoading(false);
    });

    return () => {
      unsubReceived();
      unsubSent();
    };
  }, [user]);

  async function acceptInvite(invite: Invite) {
    if (!user?.email) throw new Error("Sign in to accept this invitation");
    const email = user.email.toLowerCase();
    if (invite.toEmail.toLowerCase() !== email) {
      throw new Error("This invitation was sent to a different email address");
    }

    await runTransaction(db, async (transaction) => {
      const inviteRef = doc(db, "invites", invite.id);
      const pairRef = doc(db, "pairs", invite.pairId);
      const [inviteSnap, pairSnap] = await Promise.all([
        transaction.get(inviteRef),
        transaction.get(pairRef),
      ]);
      if (!inviteSnap.exists() || !pairSnap.exists()) throw new Error("This invitation is no longer available");

      const currentInvite = inviteSnap.data() as Omit<Invite, "id">;
      if (currentInvite.status !== "pending") throw new Error("This invitation has already been used");
      if (isInviteExpired(currentInvite)) throw new Error("This invitation has expired. Ask the sender for a new one.");
      if (currentInvite.toEmail.toLowerCase() !== email) throw new Error("This invitation was sent to a different email address");

      const pair = pairSnap.data();
      if (pair.status !== "pending" || pair.users[1]) throw new Error("This invitation is no longer available");
      const users = [...pair.users] as [string, string];
      const userEmails = [...pair.userEmails] as [string, string];
      const userNames = [...pair.userNames] as [string, string];
      users[1] = user.uid;
      userEmails[1] = email;
      userNames[1] = user.displayName || email;

      transaction.update(pairRef, {
        users,
        userEmails,
        userNames,
        status: "active",
        updatedAt: serverTimestamp(),
      });
      transaction.update(inviteRef, {
        status: "accepted",
        acceptedBy: user.uid,
        acceptedAt: serverTimestamp(),
      });

      if (currentInvite.pendingTransaction) {
        const txRef = doc(collection(db, "pairs", invite.pairId, "transactions"));
        const { amount, type, description, date } = currentInvite.pendingTransaction;
        transaction.set(txRef, {
          pairId: invite.pairId,
          amount,
          type,
          description,
          createdBy: currentInvite.fromUid,
          status: "pending",
          date: Timestamp.fromDate(new Date(`${date}T12:00:00`)),
          createdAt: serverTimestamp(),
        });
      }
    });
  }

  async function cancelInvite(invite: Invite) {
    if (!user || invite.fromUid !== user.uid) throw new Error("Only the sender can cancel this invitation");
    const txSnap = await getDocs(collection(db, "pairs", invite.pairId, "transactions"));
    await Promise.all(txSnap.docs.map((d) => deleteDoc(d.ref)));
    await Promise.all([
      deleteDoc(doc(db, "pairs", invite.pairId)),
      deleteDoc(doc(db, "invites", invite.id)),
    ]);
  }

  return { pendingInvites, sentInvites, loading, acceptInvite, cancelInvite };
}
