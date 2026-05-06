"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Pair } from "@/types";
import { PairTransaction } from "@/hooks/useAllTransactions";
import { formatAmount } from "@/utils/currency";
import {
  approveTransaction,
  disputeTransaction,
  acceptCounter,
  rejectCounter,
} from "@/utils/transactionActions";
import DisputeWithCounterForm from "@/components/DisputeWithCounterForm";
import toast from "react-hot-toast";

interface PendingTransactionBannerProps {
  pendingTxs: PairTransaction[];
  pairs: Pair[];
}

export default function PendingTransactionBanner({
  pendingTxs,
  pairs,
}: PendingTransactionBannerProps) {
  const { user, profile } = useAuth();
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const userPendingTxs = pendingTxs.filter(
    (tx) => tx.createdBy !== user?.uid
  );

  if (!user || userPendingTxs.length === 0) return null;

  const pairById = Object.fromEntries(pairs.map((p) => [p.id, p]));
  const displayName = profile?.displayName || user.email || "You";

  async function handleApprove(tx: PairTransaction) {
    const pair = pairById[tx.pairId];
    if (!pair) return;
    setLoadingId(tx.id);
    try {
      await approveTransaction(pair, tx, user!.uid, displayName, window.location.origin);
      toast.success("Transaction approved — balance updated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to approve");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDispute(
    tx: PairTransaction,
    reason: string,
    proposedAmount?: number
  ) {
    const pair = pairById[tx.pairId];
    if (!pair) return;
    setLoadingId(tx.id);
    try {
      await disputeTransaction(
        pair,
        tx,
        user!.uid,
        displayName,
        reason,
        proposedAmount,
        window.location.origin
      );
      setDisputingId(null);
      toast.success("Transaction disputed — creator notified");
    } catch (err: any) {
      toast.error(err.message || "Failed to dispute");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleAcceptCounter(tx: PairTransaction) {
    const pair = pairById[tx.pairId];
    if (!pair) return;
    setLoadingId(tx.id);
    try {
      await acceptCounter(pair, tx, user!.uid);
      toast.success("Counter-proposal accepted!");
    } catch (err: any) {
      toast.error(err.message || "Failed to accept counter");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleRejectCounter(tx: PairTransaction) {
    const pair = pairById[tx.pairId];
    if (!pair) return;
    setLoadingId(tx.id);
    try {
      await rejectCounter(pair, tx);
      toast.success("Counter-proposal rejected");
    } catch (err: any) {
      toast.error(err.message || "Failed to reject counter");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4">
      <h2 className="text-sm font-bold text-amber-800 mb-3 flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        {userPendingTxs.length === 1
          ? "1 Transaction Needs Your Attention"
          : `${userPendingTxs.length} Transactions Need Your Attention`}
      </h2>
      <div className="space-y-2">
        {userPendingTxs.map((tx) => {
          const pair = pairById[tx.pairId];
          if (!pair) return null;
          const userIdx = pair.users.indexOf(user.uid);
          const partnerName = pair.userNames[userIdx === 0 ? 1 : 0];
          const isDisputing = disputingId === tx.id;
          const isLoading = loadingId === tx.id;
          const isCounterDisputed =
            tx.status === "disputed" && tx.proposedAmount !== undefined && tx.createdBy === user.uid;

          return (
            <div
              key={tx.id}
              className="bg-white rounded-xl p-3 border border-amber-100"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {/* Direction-aware summary */}
                  {tx.type === "payment" ? (
                    <p className="text-sm font-semibold text-gray-800">
                      <span className="text-green-600">↓ {partnerName} paid you</span>
                      {" "}<span className="font-bold">{formatAmount(tx.amount, pair.currency)}</span>
                    </p>
                  ) : tx.type === "request" ? (
                    <p className="text-sm font-semibold text-gray-800">
                      <span className="text-blue-600">↑ {partnerName} is requesting</span>
                      {" "}<span className="font-bold">{formatAmount(tx.amount, pair.currency)}</span>
                      <span className="text-blue-600"> from you</span>
                    </p>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-gray-800">{partnerName}</p>
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium capitalize">
                        {tx.type}
                      </span>
                    </div>
                  )}
                  {tx.description && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{tx.description}</p>
                  )}
                  {tx.disputeReason && (
                    <p className="text-xs text-red-500 mt-0.5">
                      Disputed: &ldquo;{tx.disputeReason}&rdquo;
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {tx.type !== "payment" && tx.type !== "request" && (
                    <span className="text-sm font-bold text-gray-800">
                      {formatAmount(tx.amount, pair.currency)}
                    </span>
                  )}
                  {!isCounterDisputed && tx.status === "pending" && (
                    <>
                      <button
                        onClick={() => handleApprove(tx)}
                        disabled={isLoading}
                        className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
                      >
                        {isLoading ? "…" : "Approve"}
                      </button>
                      <button
                        onClick={() =>
                          setDisputingId(isDisputing ? null : tx.id)
                        }
                        disabled={isLoading}
                        className="btn-danger text-xs px-3 py-1.5 disabled:opacity-50"
                      >
                        Dispute
                      </button>
                    </>
                  )}
                </div>
              </div>

              {isDisputing && (
                <DisputeWithCounterForm
                  tx={tx}
                  currency={pair.currency}
                  onDispute={(reason, proposed) =>
                    handleDispute(tx, reason, proposed)
                  }
                  onCancel={() => setDisputingId(null)}
                />
              )}

              {isCounterDisputed && (
                <DisputeWithCounterForm
                  tx={tx}
                  currency={pair.currency}
                  onDispute={(reason, proposed) =>
                    handleDispute(tx, reason, proposed)
                  }
                  onCancel={() => setDisputingId(null)}
                  onAcceptCounter={() => handleAcceptCounter(tx)}
                  onRejectCounter={() => handleRejectCounter(tx)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
