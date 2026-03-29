"use client";

import { useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { CURRENCIES } from "@/types";
import { sendInviteEmail } from "@/lib/emailjs";
import toast from "react-hot-toast";

interface InviteFormProps {
  onClose: () => void;
}

export default function InviteForm({ onClose }: InviteFormProps) {
  const { user, profile } = useAuth();
  const [email, setEmail] = useState("");
  const [currency, setCurrency] = useState(profile?.currency || "USD");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !profile) return;

    const normalizedEmail = email.toLowerCase().trim();
    setLoading(true);

    try {
      // Create pair placeholder
      const pairRef = await addDoc(collection(db, "pairs"), {
        users: [user.uid, ""],
        userEmails: [user.email!.toLowerCase(), normalizedEmail],
        userNames: [profile.displayName || user.email!, ""],
        balance: 0,
        currency,
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Create invite doc
      await addDoc(collection(db, "invites"), {
        fromUid: user.uid,
        fromEmail: user.email!.toLowerCase(),
        fromName: profile.displayName || user.email!,
        toEmail: normalizedEmail,
        pairId: pairRef.id,
        status: "pending",
        createdAt: serverTimestamp(),
      });

      await sendInviteEmail({
        to_email: normalizedEmail,
        to_name: normalizedEmail.split("@")[0],
        from_name: profile.displayName || user.email!,
        subject: `${profile.displayName} invited you to PeerConnect`,
        message: `Track a shared balance together on PeerConnect.`,
        action_url: window.location.origin,
      });

      toast.success("Invite sent!");
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to send invite");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="email"
        className="input-field text-sm"
        placeholder="Partner's email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoFocus
      />
      <select className="input-field text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.symbol} {c.code}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary text-sm" disabled={loading}>
          {loading ? "Sending…" : "Send Invite"}
        </button>
        <button type="button" onClick={onClose} className="btn-secondary text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
