"use client";

import { useState } from "react";
import { collection, addDoc, serverTimestamp, doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { usePairs } from "@/hooks/usePairs";
import { useInvites } from "@/hooks/useInvites";
import { CURRENCIES } from "@/types";
import { formatAmount } from "@/utils/currency";
import { sendInviteEmail } from "@/lib/emailjs";
import PairCard from "@/components/PairCard";
import toast from "react-hot-toast";

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const { pairs, loading: pairsLoading } = usePairs();
  const { pendingInvites, acceptInvite, loading: invitesLoading } = useInvites();

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteCurrency, setInviteCurrency] = useState(profile?.currency || "USD");
  const [sending, setSending] = useState(false);

  const activePairs = pairs.filter((p) => p.status === "active");
  const pendingPairs = pairs.filter((p) => p.status !== "active");

  const netBalance = activePairs.reduce((sum, pair) => {
    const idx = pair.users.indexOf(user!.uid);
    const bal = idx === 0 ? pair.balance : -pair.balance;
    return sum + bal;
  }, 0);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !profile) return;

    const normalizedEmail = inviteEmail.toLowerCase().trim();
    if (normalizedEmail === user.email?.toLowerCase()) {
      toast.error("You can't invite yourself");
      return;
    }

    const existingPair = pairs.find((p) =>
      p.userEmails.some((e) => e.toLowerCase() === normalizedEmail)
    );
    if (existingPair) {
      toast.error("You already have a balance with this person");
      return;
    }

    setSending(true);
    try {
      const pairRef = doc(collection(db, "pairs"));
      await setDoc(pairRef, {
        users: [user.uid, ""],
        userEmails: [user.email!.toLowerCase(), normalizedEmail],
        userNames: [profile.displayName || user.email!, ""],
        balance: 0,
        currency: inviteCurrency,
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

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
        subject: `${profile.displayName} invited you to track a shared balance`,
        message: `${profile.displayName} wants to track a shared balance with you on PeerConnect. Sign up or log in to accept the invite.`,
        action_url: window.location.origin,
      });

      toast.success("Invite sent!");
      setInviteEmail("");
      setShowInvite(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to send invite");
    } finally {
      setSending(false);
    }
  }

  async function handleAcceptInvite(invite: typeof pendingInvites[0]) {
    try {
      await acceptInvite(invite);
      toast.success(`Connected with ${invite.fromName}!`);
    } catch (err: any) {
      toast.error(err.message || "Failed to accept invite");
    }
  }

  if (pairsLoading || invitesLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header summary */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">
            Welcome, {profile?.displayName || "there"}
          </h1>
          {activePairs.length > 0 && (
            <p className="text-sm text-gray-500 mt-1">
              Net balance:{" "}
              <span className={netBalance >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                {netBalance >= 0 ? "+" : ""}
                {formatAmount(netBalance, profile?.currency || "USD")}
              </span>
            </p>
          )}
        </div>
        <button onClick={() => setShowInvite(!showInvite)} className="btn-primary text-sm">
          + New Balance
        </button>
      </div>

      {/* Pending invites for this user */}
      {pendingInvites.length > 0 && (
        <div className="card border-blue-200 bg-blue-50">
          <h2 className="text-sm font-semibold text-blue-800 mb-3">Pending Invites</h2>
          <div className="space-y-2">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between bg-white rounded-lg p-3 border border-blue-100">
                <div>
                  <p className="font-medium text-sm">{invite.fromName}</p>
                  <p className="text-xs text-gray-500">{invite.fromEmail}</p>
                </div>
                <button
                  onClick={() => handleAcceptInvite(invite)}
                  className="btn-primary text-xs px-3 py-1"
                >
                  Accept
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite form */}
      {showInvite && (
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Invite someone to track a balance</h2>
          <form onSubmit={handleInvite} className="space-y-3">
            <input
              type="email"
              className="input-field text-sm"
              placeholder="Their email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
            />
            <div>
              <label className="block text-xs text-gray-500 mb-1">Currency for this balance</label>
              <select
                className="input-field text-sm"
                value={inviteCurrency}
                onChange={(e) => setInviteCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.symbol} {c.code}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary text-sm" disabled={sending}>
                {sending ? "Sending…" : "Send Invite"}
              </button>
              <button type="button" onClick={() => setShowInvite(false)} className="btn-secondary text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Active pairs */}
      {activePairs.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Active Balances
          </h2>
          {activePairs.map((pair) => (
            <PairCard key={pair.id} pair={pair} />
          ))}
        </div>
      ) : pendingPairs.length === 0 && pendingInvites.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🤝</div>
          <p className="text-lg font-medium">No balances yet</p>
          <p className="text-sm mt-1">
            Invite someone to start tracking a shared balance
          </p>
        </div>
      ) : null}

      {/* Pending pairs (invite sent but not accepted) */}
      {pendingPairs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Pending Connections
          </h2>
          {pendingPairs.map((pair) => (
            <div key={pair.id} className="card opacity-60">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">
                    {pair.userEmails.find((e) => e !== user?.email?.toLowerCase())}
                  </p>
                  <p className="text-xs text-gray-400">Waiting for them to accept…</p>
                </div>
                <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                  Pending
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
