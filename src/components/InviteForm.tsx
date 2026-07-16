"use client";

import { useState } from "react";
import { collection, doc, serverTimestamp, Timestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { usePairs } from "@/hooks/usePairs";
import { CURRENCIES } from "@/types";
import { sendInviteEmail } from "@/lib/email";
import toast from "react-hot-toast";

/** A small, standalone invite form retained for surfaces that only need a connection. */
export default function InviteForm({ onClose }: { onClose: () => void }) {
  const { user, profile } = useAuth();
  const { pairs } = usePairs();
  const [email, setEmail] = useState("");
  const [currency, setCurrency] = useState(profile?.currency || "USD");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!user || !profile || !user.email) return;
    const toEmail = email.toLowerCase().trim();
    if (toEmail === user.email.toLowerCase()) {
      toast.error("You can't invite yourself");
      return;
    }
    if (pairs.some(
      (pair) => pair.status !== "removed" && pair.userEmails.some((address) => address.toLowerCase() === toEmail)
    )) {
      toast.error("You already have a balance or pending invitation for this person");
      return;
    }
    setLoading(true);
    try {
      const pairRef = doc(collection(db, "pairs"));
      const inviteRef = doc(collection(db, "invites"));
      const batch = writeBatch(db);
      batch.set(pairRef, {
        users: [user.uid, ""],
        userEmails: [user.email.toLowerCase(), toEmail],
        userNames: [profile.displayName || user.email, ""],
        balance: 0,
        currency,
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(inviteRef, {
        fromUid: user.uid,
        fromEmail: user.email.toLowerCase(),
        fromName: profile.displayName || user.email,
        toEmail,
        pairId: pairRef.id,
        status: "pending",
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
      });
      await batch.commit();
      const delivery = await sendInviteEmail(inviteRef.id);
      toast.success("Invite saved!");
      if (delivery.skipped) toast("The email could not be delivered. Copy the invitation link from Pending Connections.");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send invite");
    } finally {
      setLoading(false);
    }
  }

  return <form onSubmit={handleSubmit} className="space-y-3">
    <input type="email" className="input-field text-sm" placeholder="Partner's email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
    <select className="input-field text-sm" value={currency} onChange={(event) => setCurrency(event.target.value)}>
      {CURRENCIES.map((item) => <option key={item.code} value={item.code}>{item.symbol} {item.code}</option>)}
    </select>
    <div className="flex gap-2"><button type="submit" className="btn-primary text-sm" disabled={loading}>{loading ? "Sending…" : "Send Invite"}</button><button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button></div>
  </form>;
}
