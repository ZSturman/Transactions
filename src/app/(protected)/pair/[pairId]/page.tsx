"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  doc,
  runTransaction,
  serverTimestamp,
  addDoc,
  collection,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { usePairs } from "@/hooks/usePairs";
import { useTransactions } from "@/hooks/useTransactions";
import { useBalanceSnapshots } from "@/hooks/useBalanceSnapshots";
import { Transaction } from "@/types";
import { formatAmount } from "@/utils/currency";
import { exportPairToCsv } from "@/utils/export";
import {
  approveTransaction,
  disputeTransaction,
  acceptCounter,
  rejectCounter,
} from "@/utils/transactionActions";
import BalanceSummary from "@/components/BalanceSummary";
import TransactionForm from "@/components/TransactionForm";
import TransactionList from "@/components/TransactionList";
import TransactionTable from "@/components/TransactionTable";
import BalanceTrendChart from "@/components/BalanceTrendChart";
import SettleModal from "@/components/SettleModal";
import ForgiveModal from "@/components/ForgiveModal";
import PairOptionsMenu from "@/components/PairOptionsMenu";
import toast from "react-hot-toast";

type ViewMode = "cards" | "table";

export default function PairDetailPage() {
  const params = useParams<{ pairId: string }>();
  const pairId = params.pairId;
  const { user, profile } = useAuth();
  const { pairs, loading: pairsLoading } = usePairs();
  const { transactions, loading: txLoading } = useTransactions(pairId);
  const { snapshots } = useBalanceSnapshots(pairId);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "disputed">("all");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [showForgiveModal, setShowForgiveModal] = useState(false);

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
  const userBalance = idx === 0 ? pair.balance : -pair.balance;
  const isDeleted = pair.deletedUsers && Object.keys(pair.deletedUsers).some((uid) => uid !== user.uid);

  const pendingCount = transactions.filter((t) => t.status === "pending" && t.createdBy !== user.uid).length;
  const filteredTransactions = filter === "all" ? transactions : transactions.filter((t) => t.status === filter);

  const displayName = profile?.displayName || user.email || "";

  async function handleApprove(tx: Transaction) {
    try {
      await approveTransaction(pair!, tx, user!.uid, displayName, window.location.origin);
      toast.success("Transaction approved — balance updated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to approve");
    }
  }

  async function handleDispute(tx: Transaction, reason: string, proposedAmount?: number) {
    try {
      await disputeTransaction(pair!, tx, user!.uid, displayName, reason, proposedAmount, window.location.origin);
      toast.success("Transaction disputed — creator notified");
    } catch (err: any) {
      toast.error(err.message || "Failed to dispute");
    }
  }

  async function handleAcceptCounter(tx: Transaction) {
    try {
      await acceptCounter(pair!, tx, user!.uid);
      toast.success("Counter-proposal accepted!");
    } catch (err: any) {
      toast.error(err.message || "Failed to accept counter");
    }
  }

  async function handleRejectCounter(tx: Transaction) {
    try {
      await rejectCounter(pair!, tx);
      toast.success("Counter-proposal rejected");
    } catch (err: any) {
      toast.error(err.message || "Failed to reject counter");
    }
  }

  async function handleSettle() {
    try {
      const absBalance = Math.abs(pair!.balance);
      await runTransaction(db, async (transaction) => {
        const pairRef = doc(db, "pairs", pair!.id);
        const pairSnap = await transaction.get(pairRef);
        if (!pairSnap.exists()) throw new Error("Pair not found");

        const txRef = doc(collection(db, "pairs", pair!.id, "transactions"));
        transaction.set(txRef, {
          amount: absBalance,
          type: "settlement",
          description: "Settled balance",
          createdBy: user!.uid,
          status: "approved",
          createdAt: serverTimestamp(),
          resolvedAt: serverTimestamp(),
        });

        transaction.update(pairRef, { balance: 0, updatedAt: serverTimestamp() });
      });

      await addDoc(collection(db, "pairs", pair!.id, "balanceSnapshots"), {
        balance: 0,
        timestamp: serverTimestamp(),
        triggeredBy: user!.uid,
        reason: "settled",
      });
      setShowSettleModal(false);
      toast.success("Balance settled!");
    } catch (err: any) {
      toast.error(err.message || "Failed to settle");
    }
  }

  async function handleForgive(amount: number, reason: string) {
    try {
      const newPairBalance = idx === 0 ? pair!.balance - amount : pair!.balance + amount;

      await runTransaction(db, async (transaction) => {
        const pairRef = doc(db, "pairs", pair!.id);
        const txRef = doc(collection(db, "pairs", pair!.id, "transactions"));

        transaction.set(txRef, {
          amount,
          type: "forgiveness",
          description: reason || "Debt forgiven",
          createdBy: user!.uid,
          status: "approved",
          createdAt: serverTimestamp(),
          resolvedAt: serverTimestamp(),
        });

        transaction.update(pairRef, { balance: newPairBalance, updatedAt: serverTimestamp() });
      });

      await addDoc(collection(db, "pairs", pair!.id, "balanceSnapshots"), {
        balance: newPairBalance,
        timestamp: serverTimestamp(),
        triggeredBy: user!.uid,
        reason: `forgiven: ${reason || "no reason"}`,
      });
      setShowForgiveModal(false);
      toast.success("Debt forgiven!");
    } catch (err: any) {
      toast.error(err.message || "Failed to forgive");
    }
  }

  function handleExport() {
    exportPairToCsv(transactions, pair!, user!.uid);
    toast.success("CSV downloaded");
  }

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-gray-500 hover:text-blue-600 transition-colors">
        ← Back to Dashboard
      </Link>

      {/* Partner header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">
            {isDeleted ? "[Deleted Account]" : partnerName}
          </h1>
          <p className="text-xs text-gray-400">{partnerEmail}</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2.5 py-1 rounded-full">
              {pendingCount} pending
            </span>
          )}
          <PairOptionsMenu
            pair={pair}
            onExport={handleExport}
            onForgive={() => setShowForgiveModal(true)}
          />
        </div>
      </div>

      {/* Balance summary */}
      <div className="card">
        <BalanceSummary pair={pair} />
        {snapshots.length > 1 && (
          <div className="mt-4">
            <BalanceTrendChart snapshots={snapshots} pair={pair} />
          </div>
        )}
      </div>

      {/* Settle button */}
      {pair.balance !== 0 && (
        <button
          onClick={() => setShowSettleModal(true)}
          className="btn-secondary w-full text-sm"
        >
          Settle Balance
        </button>
      )}

      {/* Add transaction */}
      {showForm ? (
        <TransactionForm pair={pair} onClose={() => setShowForm(false)} />
      ) : (
        <button onClick={() => setShowForm(true)} className="btn-primary w-full text-sm">
          + Transaction
        </button>
      )}

      {/* Filter tabs + view toggle */}
      <div className="space-y-2">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(["all", "pending", "approved", "disputed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors capitalize ${
                filter === f ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
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

        <div className="flex justify-end">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode("cards")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === "cards" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              List
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === "table" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Transaction history */}
      {viewMode === "cards" ? (
        <TransactionList
          transactions={filteredTransactions}
          pair={pair}
          onApprove={handleApprove}
          onDispute={handleDispute}
          onAcceptCounter={handleAcceptCounter}
          onRejectCounter={handleRejectCounter}
        />
      ) : (
        <TransactionTable
          transactions={filteredTransactions.map((t) => ({ ...t, pairId: pair.id }))}
          pairs={[pair]}
          onApprove={handleApprove}
          onDispute={handleDispute}
        />
      )}

      {showSettleModal && (
        <SettleModal
          pair={pair}
          onConfirm={handleSettle}
          onClose={() => setShowSettleModal(false)}
        />
      )}

      {showForgiveModal && (
        <ForgiveModal
          pair={pair}
          onConfirm={handleForgive}
          onClose={() => setShowForgiveModal(false)}
        />
      )}
    </div>
  );
}
