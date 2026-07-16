"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Pair } from "@/types";
import { PairTransaction } from "@/hooks/useAllTransactions";
import { formatAmount } from "@/utils/currency";
import {
  approveTransaction,
  declineTransaction,
  disputeTransaction,
  denySettlement,
  acceptCounter,
  rejectCounter,
} from "@/utils/transactionActions";
import { obligationText, partnerNameFor } from "@/utils/transactionPresentation";
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
  const { user } = useAuth();
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState<"approve" | "decline" | null>(null);

  const userPendingTxs = pendingTxs.filter(
    (tx) => tx.createdBy !== user?.uid
  );

  if (!user || userPendingTxs.length === 0) return null;

  const userId = user.uid;
  const pairById = Object.fromEntries(pairs.map((p) => [p.id, p]));
  async function handleApprove(tx: PairTransaction) {
    const pair = pairById[tx.pairId];
    if (!pair) return;
    setLoadingId(tx.id);
    try {
      await approveTransaction(pair, tx, userId);
      toast.success(
        tx.type === "settlement"
          ? "Settlement approved — balance updated!"
          : "Transaction approved — balance updated!"
      );
    } catch (err: any) {
      toast.error(err.message || "Failed to approve");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDenySettlement(tx: PairTransaction) {
    const pair = pairById[tx.pairId];
    if (!pair) return;
    setLoadingId(tx.id);
    try {
      await denySettlement(pair, tx, userId);
      toast.success("Settlement request denied");
    } catch (err: any) {
      toast.error(err.message || "Failed to deny settlement request");
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
        userId,
        reason,
        proposedAmount
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
      await acceptCounter(pair, tx, userId);
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

  async function handleBulkResolution(action: "approve" | "decline") {
    if (action === "decline" && !confirm(`Decline all ${userPendingTxs.length} pending transaction${userPendingTxs.length === 1 ? "" : "s"}? This cannot be undone.`)) {
      return;
    }

    setBulkAction(action);
    let resolved = 0;
    let failed = 0;
    // Settlements must be processed before ordinary transactions so their
    // balance snapshot is validated before any newly approved debt changes it.
    const ordered = [...userPendingTxs].sort(
      (a, b) => Number(b.type === "settlement") - Number(a.type === "settlement")
    );
    for (const tx of ordered) {
      const pair = pairById[tx.pairId];
      if (!pair) {
        failed += 1;
        continue;
      }
      try {
        if (action === "approve") await approveTransaction(pair, tx, userId);
        else await declineTransaction(pair, tx, userId);
        resolved += 1;
      } catch (err) {
        console.error(`Unable to ${action} transaction ${tx.id}:`, err);
        failed += 1;
      }
    }
    setBulkAction(null);
    if (failed === 0) {
      toast.success(`${action === "approve" ? "Approved" : "Declined"} all ${resolved} pending transaction${resolved === 1 ? "" : "s"}`);
    } else {
      toast.error(`${action === "approve" ? "Approved" : "Declined"} ${resolved} of ${userPendingTxs.length}; ${failed} could not be resolved`);
    }
  }

  return (
    <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-amber-800">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          {userPendingTxs.length === 1
            ? "1 Transaction Needs Your Attention"
            : `${userPendingTxs.length} Transactions Need Your Attention`}
        </h2>
        {userPendingTxs.length > 1 && (
          <div className="flex gap-2">
            <button
              onClick={() => handleBulkResolution("approve")}
              disabled={bulkAction !== null}
              className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {bulkAction === "approve" ? "Approving…" : "Approve all"}
            </button>
            <button
              onClick={() => handleBulkResolution("decline")}
              disabled={bulkAction !== null}
              className="btn-danger px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {bulkAction === "decline" ? "Declining…" : "Decline all"}
            </button>
          </div>
        )}
      </div>
      <div className="space-y-2">
        {userPendingTxs.map((tx) => {
          const pair = pairById[tx.pairId];
          if (!pair) return null;
          const partnerName = partnerNameFor(pair, userId);
          const obligation = obligationText(tx, pair, userId);
          const isDisputing = disputingId === tx.id;
          const isLoading = loadingId === tx.id;
          const isCounterDisputed =
            tx.status === "disputed" && tx.proposedAmount !== undefined && tx.createdBy === userId;

          return (
            <div
              key={tx.id}
              className="bg-white rounded-xl p-3 border border-amber-100"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {tx.type === "payment" || tx.type === "request" ? (
                    <p className="text-sm font-semibold text-gray-800">
                      <span className={obligation?.startsWith("You owe") ? "text-red-600" : "text-green-600"}>
                        {tx.split ? `Split expense · ${obligation}` : obligation}
                      </span>
                      {" "}<span className="font-bold">{formatAmount(tx.amount, pair.currency)}</span>
                    </p>
                  ) : tx.type === "settlement" ? (
                    <p className="text-sm font-semibold text-gray-800">
                      <span className="text-teal-700">{partnerName} requested to settle</span>
                      {" "}<span className="font-bold">{formatAmount(tx.amount, pair.currency)}</span>
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
                  {tx.split && (
                    <p className="mt-0.5 text-xs text-blue-700">
                      We spent {formatAmount(tx.split.totalAmount, pair.currency)} · you {tx.createdBy === userId ? tx.split.creatorSharePercent : 100 - tx.split.creatorSharePercent}% / {partnerName} {tx.createdBy === userId ? 100 - tx.split.creatorSharePercent : tx.split.creatorSharePercent}%
                    </p>
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
                  {tx.type === "settlement" && tx.status === "pending" && (
                    <>
                      <button
                        onClick={() => handleApprove(tx)}
                        disabled={isLoading}
                        className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
                      >
                        {isLoading ? "…" : "Approve"}
                      </button>
                      <button
                        onClick={() => handleDenySettlement(tx)}
                        disabled={isLoading}
                        className="btn-danger text-xs px-3 py-1.5 disabled:opacity-50"
                      >
                        Deny
                      </button>
                    </>
                  )}
                  {tx.type !== "settlement" && !isCounterDisputed && tx.status === "pending" && (
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
