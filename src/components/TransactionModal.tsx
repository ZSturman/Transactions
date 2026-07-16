"use client";

import { useState } from "react";
import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Pair, CURRENCIES } from "@/types";
import { formatAmount } from "@/utils/currency";
import { sendTransactionEmail, sendInviteEmail } from "@/lib/email";
import TransactionEntryFields from "@/components/TransactionEntryFields";
import {
  splitDebtAmount,
  splitDetailsFor,
  TransactionDirection,
  TransactionEntryMode,
} from "@/utils/transactionPresentation";
import toast from "react-hot-toast";

interface TransactionModalProps {
  pairs: Pair[];
  onClose: () => void;
  initialPair?: Pair;
}

type Step = "pick-person" | "fill-transaction";

export default function TransactionModal({ pairs, onClose, initialPair }: TransactionModalProps) {
  const { user, profile } = useAuth();
  const [step, setStep] = useState<Step>(initialPair ? "fill-transaction" : "pick-person");
  const [selectedPair, setSelectedPair] = useState<Pair | null>(initialPair ?? null);
  const [showNewPersonForm, setShowNewPersonForm] = useState(false);

  // New person / invite state
  const [newEmail, setNewEmail] = useState("");
  const [newCurrency, setNewCurrency] = useState(profile?.currency || "USD");
  const [sendingInvite, setSendingInvite] = useState(false);

  // Transaction form state
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<TransactionEntryMode>("payment");
  const [direction, setDirection] = useState<TransactionDirection>("i_paid");
  const [creatorSharePercent, setCreatorSharePercent] = useState("50");
  const [txDate, setTxDate] = useState(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);

  const activePairs = pairs.filter((p) => p.status === "active");

  if (!user || !profile) return null;

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();
    const normalizedEmail = newEmail.toLowerCase().trim();

    if (normalizedEmail === user!.email?.toLowerCase()) {
      toast.error("You can't invite yourself");
      return;
    }
    if (pairs.some(
      (p) => p.status !== "removed" && p.userEmails.some((em) => em.toLowerCase() === normalizedEmail)
    )) {
      toast.error("You already have a balance with this person");
      return;
    }

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

    const txType = direction === "i_paid" ? "payment" : "request";

    setSendingInvite(true);
    try {
      const pairRef = doc(collection(db, "pairs"));
      const inviteRef = doc(collection(db, "invites"));
      const expiresAt = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      const batch = writeBatch(db);
      batch.set(pairRef, {
        users: [user!.uid, ""],
        userEmails: [user!.email!.toLowerCase(), normalizedEmail],
        userNames: [profile!.displayName || user!.email!, ""],
        balance: 0,
        currency: newCurrency,
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(inviteRef, {
        fromUid: user!.uid,
        fromEmail: user!.email!.toLowerCase(),
        fromName: profile!.displayName || user!.email!,
        toEmail: normalizedEmail,
        pairId: pairRef.id,
        status: "pending",
        pendingTransaction: {
          amount: numAmount,
          type: txType,
          description: description || (mode === "split" ? "Split expense" : "Payment"),
          date: txDate,
          ...(mode === "split" && {
            split: splitDetailsFor(enteredAmount, sharePercent, direction),
          }),
        },
        createdAt: serverTimestamp(),
        expiresAt,
      });
      await batch.commit();

      const delivery = await sendInviteEmail(inviteRef.id);
      toast.success("Invite saved! Transaction will be recorded when they accept.");
      if (delivery.skipped) toast("The email could not be delivered. You can copy the invitation link from Pending Connections.");
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to send invite");
    } finally {
      setSendingInvite(false);
    }
  }

  async function handleSubmitTransaction(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPair) return;

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
      const eventDate = Timestamp.fromDate(new Date(txDate + "T12:00:00"));

      const transactionRef = await addDoc(collection(db, "pairs", selectedPair.id, "transactions"), {
        pairId: selectedPair.id,
        amount: numAmount,
        type: direction === "i_paid" ? "payment" : "request",
        description: description || (mode === "split" ? "Split expense" : "Payment"),
        createdBy: user!.uid,
        status: "pending",
        date: eventDate,
        createdAt: serverTimestamp(),
        ...(mode === "split" && {
          split: splitDetailsFor(enteredAmount, sharePercent, direction),
        }),
      });

      // Only send email notification for active pairs (pending pairs — partner hasn't signed up yet)
      if (selectedPair.status === "active") {
        const delivery = await sendTransactionEmail(selectedPair.id, transactionRef.id);
        if (delivery.skipped) toast("Transaction saved, but its email notification could not be delivered.");
      }

      toast.success(
        selectedPair.status === "active"
          ? "Transaction recorded — waiting for approval"
          : "Request queued — will be sent when they accept your invite"
      );
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to record transaction");
    } finally {
      setLoading(false);
    }
  }

  const partnerIdx = selectedPair ? selectedPair.users.indexOf(user.uid) : -1;
  const partnerName =
    selectedPair && partnerIdx !== -1
      ? selectedPair.userNames[partnerIdx === 0 ? 1 : 0] ||
        selectedPair.userEmails[partnerIdx === 0 ? 1 : 0]
      : "";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {step === "fill-transaction" && !initialPair && (
              <button
                onClick={() => {
                  setStep("pick-person");
                  setSelectedPair(null);
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Back"
              >
                ←
              </button>
            )}
            <h2 className="text-lg font-bold text-gray-900">
              {step === "pick-person" ? "New Transaction" : `Transaction with ${partnerName}`}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Step 1: Pick person */}
        {step === "pick-person" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Select who this transaction is with:</p>

            {activePairs.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {activePairs.map((pair) => {
                  const idx = pair.users.indexOf(user.uid);
                  const name = pair.userNames[idx === 0 ? 1 : 0];
                  const email = pair.userEmails[idx === 0 ? 1 : 0];
                  const userBalance = idx === 0 ? pair.balance : -pair.balance;
                  const isDeleted =
                    pair.deletedUsers &&
                    pair.users.some((uid) => uid in (pair.deletedUsers ?? {}));

                  return (
                    <button
                      key={pair.id}
                      onClick={() => {
                        setSelectedPair(pair);
                        setStep("fill-transaction");
                      }}
                      className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
                    >
                      <div>
                        <p className="font-medium text-sm">
                          {isDeleted ? (
                            <span className="text-gray-400 italic">[Deleted Account]</span>
                          ) : (
                            name
                          )}
                        </p>
                        <p className="text-xs text-gray-400">{email}</p>
                      </div>
                      <span
                        className={`text-sm font-semibold ${
                          userBalance > 0
                            ? "text-green-600"
                            : userBalance < 0
                            ? "text-red-600"
                            : "text-gray-400"
                        }`}
                      >
                        {userBalance > 0 ? "+" : ""}
                        {formatAmount(userBalance, pair.currency)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Connect with someone new */}
            <div>
              <button
                onClick={() => setShowNewPersonForm((v) => !v)}
                className={`w-full p-3 rounded-xl border-2 border-dashed text-sm font-medium transition-colors ${
                  showNewPersonForm
                    ? "border-blue-400 text-blue-600 bg-blue-50"
                    : "border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-500"
                }`}
              >
                + Connect with someone new
              </button>

              {showNewPersonForm && (
                <form onSubmit={handleSendInvite} className="mt-3 space-y-3">
                  <input
                    type="email"
                    className="input-field text-sm"
                    placeholder="Their email address"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    required
                    autoFocus
                  />
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Currency</label>
                    <select
                      className="input-field text-sm"
                      value={newCurrency}
                      onChange={(e) => setNewCurrency(e.target.value)}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.symbol} {c.code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <TransactionEntryFields
                    partnerName={newEmail.split("@")[0] || "your partner"}
                    currency={newCurrency}
                    mode={mode}
                    onModeChange={setMode}
                    direction={direction}
                    onDirectionChange={setDirection}
                    amount={amount}
                    onAmountChange={setAmount}
                    creatorSharePercent={creatorSharePercent}
                    onCreatorSharePercentChange={setCreatorSharePercent}
                  />
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      What&apos;s it for? (optional)
                    </label>
                    <input
                      type="text"
                      className="input-field text-sm"
                      placeholder="e.g. Dinner, Rent, Groceries"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      maxLength={200}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Date</label>
                    <input
                      type="date"
                      className="input-field text-sm"
                      value={txDate}
                      onChange={(e) => setTxDate(e.target.value)}
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn-primary text-sm w-full"
                    disabled={sendingInvite}
                  >
                    {sendingInvite ? "Sending invite…" : "Send Invite & Record Transaction"}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Fill transaction */}
        {step === "fill-transaction" && selectedPair && (
          <form onSubmit={handleSubmitTransaction} className="space-y-4">
            <TransactionEntryFields
              partnerName={partnerName}
              currency={selectedPair.currency}
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
              <label className="block text-xs text-gray-500 mb-1">
                What&apos;s it for? (optional)
              </label>
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
                required
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                className="btn-primary flex-1"
                disabled={loading}
              >
                {loading ? "Recording…" : "Record Transaction"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary flex-1"
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
