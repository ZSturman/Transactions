"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePairs } from "@/hooks/usePairs";
import { useInvites } from "@/hooks/useInvites";
import { useAllTransactions } from "@/hooks/useAllTransactions";
import { useAllBalanceSnapshots } from "@/hooks/useAllBalanceSnapshots";
import { formatAmount } from "@/utils/currency";
import PairCard from "@/components/PairCard";
import TransactionModal from "@/components/TransactionModal";
import TransactionTable from "@/components/TransactionTable";
import PendingTransactionBanner from "@/components/PendingTransactionBanner";
import NetBalanceTrendChart from "@/components/NetBalanceTrendChart";
import TransactionActivityChart from "@/components/TransactionActivityChart";
import DashboardFilterBar, { DashboardFilters } from "@/components/DashboardFilterBar";
import { unhidePair } from "@/utils/transactionActions";
import toast from "react-hot-toast";

type ViewMode = "cards" | "table";
type Period = "7D" | "30D" | "90D" | "1Y" | "all";

const DEFAULT_FILTERS: DashboardFilters = {
  searchText: "",
  statusFilter: "all",
  typeFilter: "all",
  pairFilter: "all",
};

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const { pairs, loading: pairsLoading } = usePairs();
  const { pendingInvites, acceptInvite, loading: invitesLoading } = useInvites();

  const activePairs = useMemo(
    () => pairs.filter((p) => p.status === "active"),
    [pairs]
  );
  const pendingPairs = useMemo(
    () => pairs.filter((p) => p.status === "pending"),
    [pairs]
  );

  // Pairs hidden after bulk-archive — excluded from charts/balances by default
  const hiddenPairs = useMemo(
    () => activePairs.filter((p) => p.hidden === true),
    [activePairs]
  );
  const visiblePairs = useMemo(
    () => activePairs.filter((p) => !p.hidden),
    [activePairs]
  );

  const [showModal, setShowModal] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [period, setPeriod] = useState<Period>("30D");
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [showArchived, setShowArchived] = useState(false);

  // Always subscribe to ALL active pairs so the Show Archived toggle can
  // include hidden pairs' data in charts without remounting listeners.
  const { transactions: rawTransactions } = useAllTransactions(activePairs, { includeArchived: showArchived });
  const { snapshots: rawSnapshots } = useAllBalanceSnapshots(activePairs);

  // displayPairs = the pairs whose data feeds the charts & balance numbers
  const displayPairs = useMemo(
    () => (showArchived ? activePairs : visiblePairs),
    [showArchived, activePairs, visiblePairs]
  );
  const displayPairIds = useMemo(
    () => new Set(displayPairs.map((p) => p.id)),
    [displayPairs]
  );
  const transactions = useMemo(
    () => rawTransactions.filter((tx) => displayPairIds.has(tx.pairId)),
    [rawTransactions, displayPairIds]
  );
  const snapshots = useMemo(
    () => rawSnapshots.filter((s) => displayPairIds.has(s.pairId)),
    [rawSnapshots, displayPairIds]
  );

  // ── Pending transactions that need the current user's action ──
  const pendingActionTxs = useMemo(
    () => transactions.filter((tx) => tx.status === "pending" && tx.createdBy !== user?.uid),
    [transactions, user]
  );

  const { owedToMe, iOwe } = displayPairs.reduce(
    (acc, pair) => {
      const idx = pair.users.indexOf(user!.uid);
      const bal = idx === 0 ? pair.balance : -pair.balance;
      if (bal > 0) acc.owedToMe += bal;
      else if (bal < 0) acc.iOwe += Math.abs(bal);
      return acc;
    },
    { owedToMe: 0, iOwe: 0 }
  );
  const netBalance = owedToMe - iOwe;
  const currency = profile?.currency || "USD";

  // ── Filtered transactions (for cards + table views) ──
  const filteredTransactions = useMemo(() => {
    const { searchText, statusFilter, typeFilter, pairFilter } = filters;
    let result = transactions;

    if (pairFilter !== "all") {
      result = result.filter((tx) => tx.pairId === pairFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((tx) => tx.status === statusFilter);
    }
    if (typeFilter !== "all") {
      result = result.filter((tx) => tx.type === typeFilter);
    }
    if (searchText.trim()) {
      const q = searchText.toLowerCase().trim();
      const pairById = Object.fromEntries(displayPairs.map((p) => [p.id, p]));
      result = result.filter((tx) => {
        if (tx.description?.toLowerCase().includes(q)) return true;
        if (tx.type.toLowerCase().includes(q)) return true;
        if (tx.amount.toString().includes(q)) return true;
        const pair = pairById[tx.pairId];
        if (pair) {
          const idx = user ? pair.users.indexOf(user.uid) : -1;
          const partnerName = idx !== -1 ? pair.userNames[idx === 0 ? 1 : 0] : "";
          const partnerEmail = idx !== -1 ? pair.userEmails[idx === 0 ? 1 : 0] : "";
          if (partnerName.toLowerCase().includes(q)) return true;
          if (partnerEmail.toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }
    return result;
  }, [transactions, filters, displayPairs, user]);

  // ── Filtered pairs for card view ──
  const filteredPairs = useMemo(() => {
    const { searchText, pairFilter } = filters;
    const isAnyFilterActive =
      filters.statusFilter !== "all" ||
      filters.typeFilter !== "all" ||
      pairFilter !== "all" ||
      searchText.trim() !== "";

    if (!isAnyFilterActive) return displayPairs;

    const matchedPairIds = new Set(filteredTransactions.map((tx) => tx.pairId));

    if (searchText.trim()) {
      const q = searchText.toLowerCase().trim();
      displayPairs.forEach((pair) => {
        const idx = user ? pair.users.indexOf(user.uid) : -1;
        const partnerName = idx !== -1 ? pair.userNames[idx === 0 ? 1 : 0] : "";
        const partnerEmail = idx !== -1 ? pair.userEmails[idx === 0 ? 1 : 0] : "";
        if (
          partnerName.toLowerCase().includes(q) ||
          partnerEmail.toLowerCase().includes(q)
        ) {
          matchedPairIds.add(pair.id);
        }
      });
    }

    return displayPairs.filter((p) => matchedPairIds.has(p.id));
  }, [displayPairs, filteredTransactions, filters, user]);

  async function handleAcceptInvite(invite: (typeof pendingInvites)[0]) {
    try {
      await acceptInvite(invite);
      toast.success(`Connected with ${invite.fromName}!`);
    } catch (err: any) {
      toast.error(err.message || "Failed to accept invite");
    }
  }

  async function handleRestorePair(pairId: string) {
    try {
      await unhidePair(pairId);
      toast.success("Balance restored to dashboard");
    } catch (err: any) {
      toast.error(err.message || "Failed to restore");
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
      {/* ── Pending Invites Banner ── */}
      {pendingInvites.length > 0 && (
        <div className="rounded-2xl border-2 border-blue-400 bg-blue-50 p-4">
          <h2 className="text-sm font-bold text-blue-800 mb-3 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            {pendingInvites.length === 1
              ? "1 Pending Invite"
              : `${pendingInvites.length} Pending Invites`}
          </h2>
          <div className="space-y-2">
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between bg-white rounded-xl p-3 border border-blue-100"
              >
                <div>
                  <p className="font-semibold text-sm">{invite.fromName}</p>
                  <p className="text-xs text-gray-500">{invite.fromEmail}</p>
                </div>
                <button
                  onClick={() => handleAcceptInvite(invite)}
                  className="btn-primary text-xs px-4 py-1.5"
                >
                  Accept
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Pending Transactions Banner ── */}
      {pendingActionTxs.length > 0 && (
        <PendingTransactionBanner
          pendingTxs={pendingActionTxs}
          pairs={activePairs}
        />
      )}

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {profile?.displayName
              ? `Hi, ${profile.displayName.split(" ")[0]}`
              : "Dashboard"}
          </h1>
          {activePairs.length > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">
              Here&apos;s your money overview
            </p>
          )}
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary text-sm flex-shrink-0"
        >
          + Transaction
        </button>
      </div>

      {activePairs.length > 0 && (
        <>
          {/* ── "All resolved" state: all pairs are archived ── */}
          {!showArchived && visiblePairs.length === 0 && hiddenPairs.length > 0 && (
            <div className="text-center py-10 space-y-3">
              <p className="text-gray-500 font-medium">All your balances are resolved.</p>
              <button
                onClick={() => setShowArchived(true)}
                className="text-sm text-blue-600 hover:underline"
              >
                Show {hiddenPairs.length} archived balance{hiddenPairs.length === 1 ? "" : "s"}
              </button>
            </div>
          )}
          {/* ── Hero Chart ── */}
          {displayPairs.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Net Balance
                </p>
                <p
                  className={`text-2xl font-bold mt-0.5 ${
                    netBalance > 0
                      ? "text-green-600"
                      : netBalance < 0
                      ? "text-red-600"
                      : "text-gray-400"
                  }`}
                >
                  {netBalance >= 0 ? "+" : ""}
                  {formatAmount(Math.abs(netBalance), currency)}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {netBalance > 0
                    ? "Overall, you are owed money"
                    : netBalance < 0
                    ? "Overall, you owe money"
                    : "You're all settled up"}
                </p>
              </div>
            </div>
            <NetBalanceTrendChart
              snapshots={snapshots}
              pairs={displayPairs}
              currency={currency}
              period={period}
              onPeriodChange={setPeriod}
            />
          </div>
          )}

          {/* ── Stats + Activity Row ── */}
          {displayPairs.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
                <p className="text-xs text-green-600 font-semibold uppercase tracking-wide mb-1">
                  Owed to you
                </p>
                <p className="text-xl font-bold text-green-700">
                  {formatAmount(owedToMe, currency)}
                </p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
                <p className="text-xs text-red-600 font-semibold uppercase tracking-wide mb-1">
                  You owe
                </p>
                <p className="text-xl font-bold text-red-700">
                  {formatAmount(iOwe, currency)}
                </p>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Activity
              </p>
              <TransactionActivityChart
                transactions={transactions}
                currency={currency}
                period={period}
              />
            </div>
          </div>
          )}

          {/* ── Active Balances ── */}
          {displayPairs.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                {showArchived ? "All Balances" : "Active Balances"}
              </h2>
              <div className="flex items-center gap-2">
                {hiddenPairs.length > 0 && (
                  <button
                    onClick={() => setShowArchived((v) => !v)}
                    className="text-xs text-gray-500 hover:text-gray-800 underline underline-offset-2"
                  >
                    {showArchived
                      ? "Hide archived"
                      : `Show archived (${hiddenPairs.length})`}
                  </button>
                )}
                <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode("cards")}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    viewMode === "cards"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Cards
                </button>
                <button
                  onClick={() => setViewMode("table")}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    viewMode === "table"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Table
                </button>
              </div>
              </div>
            </div>

            <DashboardFilterBar
              filters={filters}
              onChange={setFilters}
              pairs={displayPairs}
              totalCount={transactions.length}
              filteredCount={filteredTransactions.length}
            />

            {viewMode === "cards" ? (
              filteredPairs.length > 0 ? (
                <div className="space-y-2">
                  {filteredPairs.map((pair) => (
                    <div key={pair.id} className="relative">
                      <PairCard pair={pair} />
                      {pair.hidden && (
                        <div className="absolute top-2 right-12 flex items-center gap-1.5 pointer-events-none">
                          <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full font-medium">
                            archived
                          </span>
                        </div>
                      )}
                      {pair.hidden && (
                        <button
                          onClick={() => handleRestorePair(pair.id)}
                          className="absolute top-2 right-2 text-[10px] text-blue-600 hover:underline font-medium z-10"
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400 text-sm">
                  No matches found.{" "}
                  <button
                    onClick={() => setFilters(DEFAULT_FILTERS)}
                    className="text-blue-600 hover:underline"
                  >
                    Clear filters
                  </button>
                </div>
              )
            ) : (
              <TransactionTable
                transactions={filteredTransactions}
                pairs={displayPairs}
                hideStatusFilter
              />
            )}
          </div>
          )}

          {/* ── Archived Pairs (shown inline above when showArchived=true) ── */}
        </>
      )}

      {/* ── Empty State ── */}
      {activePairs.length === 0 &&
        pendingPairs.length === 0 &&
        pendingInvites.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-5xl mb-4">💸</div>
            <p className="text-lg font-semibold text-gray-600">
              No transactions yet
            </p>
            <p className="text-sm mt-1 mb-6">
              Start by recording a transaction with someone.
            </p>
            <button onClick={() => setShowModal(true)} className="btn-primary">
              + Transaction
            </button>
          </div>
        )}

      {/* ── Pending Connections ── */}
      {pendingPairs.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Pending Connections
          </h2>
          {pendingPairs.map((pair) => (
            <div key={pair.id} className="card opacity-60">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">
                    {pair.userEmails.find(
                      (e) => e !== user?.email?.toLowerCase()
                    )}
                  </p>
                  <p className="text-xs text-gray-400">
                    Waiting for them to accept…
                  </p>
                </div>
                <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                  Pending
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <TransactionModal pairs={pairs} onClose={() => setShowModal(false)} />
      )}
    </div>
  );
}
