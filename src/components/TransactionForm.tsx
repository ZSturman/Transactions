"use client";

import { useState } from "react";
import {
  collection,
  addDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Pair } from "@/types";
import { sendTransactionEmail } from "@/lib/email";
import { formatAmount } from "@/utils/currency";
import toast from "react-hot-toast";

interface TransactionFormProps {
  pair: Pair;
  onClose: () => void;
}

export default function TransactionForm({ pair, onClose }: TransactionFormProps) {
  const { user, profile } = useAuth();
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [direction, setDirection] = useState<"i_paid" | "they_paid">("i_paid");
  const [txDate, setTxDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  const idx = pair.users.indexOf(user.uid);
  const partnerName = pair.userNames[idx === 0 ? 1 : 0];
  const partnerEmail = pair.userEmails[idx === 0 ? 1 : 0];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    setLoading(true);
    try {
      // Create transaction (pending approval from partner)
      await addDoc(collection(db, "pairs", pair.id, "transactions"), {
        pairId: pair.id,
        amount: numAmount,
        type: direction === "i_paid" ? "payment" : "request",
        description: description || (direction === "i_paid" ? "Payment" : "Request"),
        createdBy: user!.uid,
        status: "pending",
        date: Timestamp.fromDate(new Date(txDate + "T12:00:00")),
        createdAt: serverTimestamp(),
      });

      // Send email to partner
      const actionWord = direction === "i_paid" ? "recorded a payment of" : "requested";
      await sendTransactionEmail({
        to_email: partnerEmail,
        to_name: partnerName,
        from_name: profile?.displayName || user!.email!,
        subject: `${profile?.displayName} ${actionWord} ${formatAmount(numAmount, pair.currency)}`,
        message: `${profile?.displayName} ${actionWord} ${formatAmount(numAmount, pair.currency)}${
          description ? ` for "${description}"` : ""
        }. Log in to approve or dispute this transaction.`,
        action_url: `${window.location.origin}/pair/${pair.id}`,
      });

      toast.success("Transaction recorded — waiting for approval");
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to record transaction");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card border-blue-200">
      <h3 className="font-semibold text-sm mb-3">New Transaction</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Direction toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDirection("i_paid")}
            className={`py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
              direction === "i_paid"
                ? "bg-green-50 border-green-300 text-green-700"
                : "border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}
          >
            ↑ I paid {partnerName.split(" ")[0]}
          </button>
          <button
            type="button"
            onClick={() => setDirection("they_paid")}
            className={`py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
              direction === "they_paid"
                ? "bg-blue-50 border-blue-300 text-blue-700"
                : "border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}
          >
            ↓ {partnerName.split(" ")[0]} paid me
          </button>
        </div>

        {/* Amount */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Amount ({pair.currency})</label>
          <input
            type="number"
            step="0.01"
            className="input-field text-lg font-semibold"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">What&apos;s it for? (optional)</label>
          <input
            type="text"
            className="input-field text-sm"
            placeholder="e.g. Dinner, Rent, Groceries"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
          />
        </div>

        {/* Date */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Date</label>
          <input
            type="date"
            className="input-field text-sm"
            value={txDate}
            onChange={(e) => setTxDate(e.target.value)}
            max={new Date().toISOString().split("T")[0]}
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button type="submit" className="btn-primary text-sm" disabled={loading}>
            {loading ? "Recording…" : "Record Transaction"}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary text-sm">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
