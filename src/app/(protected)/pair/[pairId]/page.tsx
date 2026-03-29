"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  doc,
  updateDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { usePairs } from "@/hooks/usePairs";
import { useTransactions } from "@/hooks/useTransactions";
import { Transaction } from "@/types";
import { formatAmount } from "@/utils/currency";
import { sendResolvedEmail } from "@/lib/emailjs";
import BalanceSummary from "@/components/BalanceSummary";
import TransactionForm from "@/components/TransactionForm";
import TransactionList from "@/components/TransactionList";
import toast from "react-hot-toast";

export default function PairDetailPage() {
  const params = useParams<{ pairId: string }>();
  const pairId = params.pairId;
  const { user, profile } = useAuth();
  const { pairs, loading: pairsLoading } = usePairs();
  const { transactions, loading: txLoading } = useTransactions(pairId);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "disputed">("all");

  const pair = pairs.find((p) => p.id === pairId);

  if (pairsLoading || txLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!pair || !user) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400">Balance not found</p>
        <Link href="/" className="text-blue-600 text-sm hover:underline mt-2 inline-block">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const idx = pair.users.indexOf(user.uid);
  const partnerName = pair.userNames[idx === 0 ? 1 : 0];
  const partnerEmail = pair.userEmails[idx === 0 ? 1 : 0];

  const pendingCount = transactions.filter((t) => t.status === "pending" && t.createdBy !== user.uid).length;

  const filteredTransactions = filter === "all"
    ? transactions
    : transactions.filter((t) => t.status === filter);

  async function handleApprove(tx: Transaction) {
    try {
      await runTransaction(db, async (transaction) => {
        const pairRef = doc(db, "pairs", pair!.id);
        const pairSnap = await transaction.get(pairRef);
        if (!pairSnap.exists()) throw new Error("Pair not found");

        const pairData = pairSnap.data();
        let balanceDelta = tx.amount;

        const creatorIdx = pairData.users.indexOf(tx.createdBy);
        if (tx.type === "payment") {
          balanceDelta = creatorIdx === 0 ? tx.amount : -tx.amount;
        } else {
          balanceDelta = creatorIdx === 0 ? -tx.amount : tx.amount;
        }

        const newBalance = (pairData.balance || 0) + balanceDelta;

        transaction.update(pairRef, {
          balance: newBalance,
          updatedAt: serverTimestamp(),
        });

        const txRef = doc(db, "pairs", pair!.id, "transactions", tx.id);
        transaction.update(txRef, {
          status: "approved",
          resolvedAt: serverTimestamp(),
        });
      });

      const senderName = profile?.displayName || user!.email!;
      await sendResolvedEmail({
        to_email: partnerEmail,
        to_name: partnerName,
        from_name: senderName,
        subject: `Transaction approved: ${formatAmount(tx.amount, pair!.currency)}`,
        message: `${senderName} approved the transaction of ${formatAmount(tx.amount, pair!.currency)}${
          tx.description ? ` for "${tx.description}"` : ""
        }. The balance has been updated.`,
        action_url: `${window.location.origin}/pair/${pair!.id}`,
      });

      toast.success("Transaction approved — balance updated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to approve");
    }
  }

  async function handleDispute(tx: Transaction, reason: string) {
    try {
      await updateDoc(doc(db, "pairs", pair!.id, "transactions", tx.id), {
        status: "disputed",
        disputeReason: reason,
        resolvedAt: serverTimestamp(),
      });

      const creatorIdx = pair!.users.indexOf(tx.createdBy);
      const creatorEmail = pair!.userEmails[creatorIdx];
      const creatorName = pair!.userNames[creatorIdx];

      await sendResolvedEmail({
        to_email: creatorEmail,
        to_name: creatorName,
        from_name: profile?.displayName || user!.email!,
        subject: `Transaction disputed: ${formatAmount(tx.amount, pair!.currency)}`,
        message: `Your transaction of ${formatAmount(tx.amount, pair!.currency)}${
          tx.description ? ` for "${tx.description}"` : ""
        } was disputed. Reason: "${reason}"`,
        action_url: `${window.location.origin}/pair/${pair!.id}`,
      });

      toast.success("Transaction disputed — creator notified");
    } catch (err: any) {
      toast.error(err.message || "Failed to dispute");
    }
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link href="/" className="text-sm text-gray-500 hover:text-blue-600 transition-colors">
        ← Back to Dashboard
      </Link>

      {/* Partner header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">{partnerName}</h1>
          <p className="text-xs text-gray-400">{partnerEmail}</p>
        </div>
        {pendingCount > 0 && (
          <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2.5 py-1 rounded-full">
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Balance summary */}
      <div className="card">
        <BalanceSummary pair={pair} />
      </div>

      {/* Add transaction */}
      {showForm ? (
        <TransactionForm pair={pair} onClose={() => setShowForm(false)} />
      ) : (
        <button onClick={() => setShowForm(true)} className="btn-primary w-full text-sm">
          + Record Transaction
        </button>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {(["all", "pending", "approved", "disputed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors capitalize ${
              filter === f
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {f}
            {f === "pending" && pendingCount > 0 && (
              <span className="ml-1 bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Transaction history */}
      <TransactionList
        transactions={filteredTransactions}
        pair={pair}
        onApprove={handleApprove}
        onDispute={handleDispute}
      />
    </div>
  );
}
