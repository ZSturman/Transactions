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
import TransactionEntryFields from "@/components/TransactionEntryFields";
import {
  splitDebtAmount,
  splitDetailsFor,
  TransactionDirection,
  TransactionEntryMode,
} from "@/utils/transactionPresentation";
import toast from "react-hot-toast";

interface TransactionFormProps {
  pair: Pair;
  onClose: () => void;
}

export default function TransactionForm({ pair, onClose }: TransactionFormProps) {
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<TransactionEntryMode>("payment");
  const [direction, setDirection] = useState<TransactionDirection>("i_paid");
  const [creatorSharePercent, setCreatorSharePercent] = useState("50");
  const [txDate, setTxDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  const idx = pair.users.indexOf(user.uid);
  const partnerName = pair.userNames[idx === 0 ? 1 : 0];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const enteredAmount = parseFloat(amount);
    const sharePercent = parseFloat(creatorSharePercent);
    if (!enteredAmount || enteredAmount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (mode === "split" && (!Number.isFinite(sharePercent) || sharePercent < 0 || sharePercent > 100)) {
      toast.error("Enter a split between 0% and 100%");
      return;
    }

    const numAmount = mode === "split"
      ? splitDebtAmount(enteredAmount, sharePercent, direction)
      : enteredAmount;
    if (numAmount <= 0) {
      toast.error("This split leaves no amount for the other person");
      return;
    }

    setLoading(true);
    try {
      // Create transaction (pending approval from partner)
      const transactionRef = await addDoc(collection(db, "pairs", pair.id, "transactions"), {
        pairId: pair.id,
        amount: numAmount,
        type: direction === "i_paid" ? "payment" : "request",
        description: description || (mode === "split" ? "Split expense" : "Payment"),
        createdBy: user!.uid,
        status: "pending",
        date: Timestamp.fromDate(new Date(txDate + "T12:00:00")),
        createdAt: serverTimestamp(),
        ...(mode === "split" && {
          split: splitDetailsFor(enteredAmount, sharePercent, direction),
        }),
      });

      const delivery = await sendTransactionEmail(pair.id, transactionRef.id);
      if (delivery.skipped) toast("Transaction saved, but its email notification could not be delivered.");

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
        <TransactionEntryFields
          partnerName={partnerName}
          currency={pair.currency}
          mode={mode}
          onModeChange={setMode}
          direction={direction}
          onDirectionChange={setDirection}
          amount={amount}
          onAmountChange={setAmount}
          creatorSharePercent={creatorSharePercent}
          onCreatorSharePercentChange={setCreatorSharePercent}
          autoFocus
        />

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
