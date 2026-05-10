import {
  doc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  addDoc,
  collection,
  writeBatch,
  deleteField,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Pair, Transaction, UserProfile } from "@/types";
import { formatAmount } from "@/utils/currency";
import { sendResolvedEmail } from "@/lib/email";

async function writeBalanceSnapshot(
  pairId: string,
  newBalance: number,
  reason: string,
  triggeredBy: string
) {
  await addDoc(collection(db, "pairs", pairId, "balanceSnapshots"), {
    balance: newBalance,
    timestamp: serverTimestamp(),
    triggeredBy,
    reason,
  });
}

function getPartnerInfo(pair: Pair, userId: string) {
  const idx = pair.users.indexOf(userId);
  const partnerIdx = idx === 0 ? 1 : 0;
  return {
    partnerEmail: pair.userEmails[partnerIdx],
    partnerName: pair.userNames[partnerIdx],
    userIdx: idx,
  };
}

export async function approveTransaction(
  pair: Pair,
  tx: Transaction,
  userId: string,
  userDisplayName: string,
  origin: string
): Promise<void> {
  const { partnerEmail, partnerName } = getPartnerInfo(pair, userId);
  let newBalance = 0;

  await runTransaction(db, async (firestoreTransaction) => {
    const pairRef = doc(db, "pairs", pair.id);
    const pairSnap = await firestoreTransaction.get(pairRef);
    if (!pairSnap.exists()) throw new Error("Pair not found");

    const pairData = pairSnap.data();
    const creatorIdx = pairData.users.indexOf(tx.createdBy);
    let balanceDelta = 0;
    if (tx.type === "payment") {
      balanceDelta = creatorIdx === 0 ? tx.amount : -tx.amount;
    } else {
      balanceDelta = creatorIdx === 0 ? -tx.amount : tx.amount;
    }
    newBalance = (pairData.balance || 0) + balanceDelta;

    firestoreTransaction.update(pairRef, {
      balance: newBalance,
      updatedAt: serverTimestamp(),
    });
    firestoreTransaction.update(
      doc(db, "pairs", pair.id, "transactions", tx.id),
      { status: "approved", resolvedAt: serverTimestamp() }
    );
  });

  await writeBalanceSnapshot(pair.id, newBalance, "transaction approved", userId);

  await sendResolvedEmail({
    to_email: partnerEmail,
    to_name: partnerName,
    from_name: userDisplayName,
    subject: `Transaction approved: ${formatAmount(tx.amount, pair.currency)}`,
    message: `${userDisplayName} approved the transaction of ${formatAmount(
      tx.amount,
      pair.currency
    )}${tx.description ? ` for "${tx.description}"` : ""}. The balance has been updated.`,
    action_url: `${origin}/pair/${pair.id}`,
  });
}

export async function disputeTransaction(
  pair: Pair,
  tx: Transaction,
  userId: string,
  userDisplayName: string,
  reason: string,
  proposedAmount: number | undefined,
  origin: string
): Promise<void> {
  const update: Record<string, unknown> = {
    status: "disputed",
    disputeReason: reason,
    resolvedAt: serverTimestamp(),
  };
  if (proposedAmount !== undefined) update.proposedAmount = proposedAmount;

  await updateDoc(doc(db, "pairs", pair.id, "transactions", tx.id), update);

  const creatorIdx = pair.users.indexOf(tx.createdBy);
  await sendResolvedEmail({
    to_email: pair.userEmails[creatorIdx],
    to_name: pair.userNames[creatorIdx],
    from_name: userDisplayName,
    subject: `Transaction disputed: ${formatAmount(tx.amount, pair.currency)}`,
    message: `Your transaction of ${formatAmount(tx.amount, pair.currency)}${
      tx.description ? ` for "${tx.description}"` : ""
    } was disputed. Reason: "${reason}"${
      proposedAmount !== undefined
        ? `. Counter-proposed amount: ${formatAmount(proposedAmount, pair.currency)}`
        : ""
    }`,
    action_url: `${origin}/pair/${pair.id}`,
  });
}

export async function acceptCounter(
  pair: Pair,
  tx: Transaction,
  userId: string
): Promise<void> {
  if (tx.proposedAmount === undefined) return;
  let newBalance = 0;

  await runTransaction(db, async (firestoreTransaction) => {
    const pairRef = doc(db, "pairs", pair.id);
    const pairSnap = await firestoreTransaction.get(pairRef);
    if (!pairSnap.exists()) throw new Error("Pair not found");

    const pairData = pairSnap.data();
    const creatorIdx = pairData.users.indexOf(tx.createdBy);
    let balanceDelta = 0;
    if (tx.type === "payment") {
      balanceDelta = creatorIdx === 0 ? tx.proposedAmount! : -tx.proposedAmount!;
    } else {
      balanceDelta = creatorIdx === 0 ? -tx.proposedAmount! : tx.proposedAmount!;
    }
    newBalance = (pairData.balance || 0) + balanceDelta;

    firestoreTransaction.update(pairRef, {
      balance: newBalance,
      updatedAt: serverTimestamp(),
    });
    firestoreTransaction.update(
      doc(db, "pairs", pair.id, "transactions", tx.id),
      {
        amount: tx.proposedAmount,
        status: "approved",
        resolvedAt: serverTimestamp(),
      }
    );
  });

  await writeBalanceSnapshot(pair.id, newBalance, "counter-proposal accepted", userId);
}

export async function rejectCounter(pair: Pair, tx: Transaction): Promise<void> {
  await updateDoc(doc(db, "pairs", pair.id, "transactions", tx.id), {
    proposedAmount: null,
    status: "disputed",
  });
}

// ─── Archive helpers ─────────────────────────────────────
// Archiving is purely a display flag: it does not change the pair balance,
// and no balance snapshot is written. Archived transactions are hidden from
// default lists, dashboards, charts, and exports but can be restored.

export async function archiveTransaction(
  pairId: string,
  txId: string
): Promise<void> {
  await updateDoc(doc(db, "pairs", pairId, "transactions", txId), {
    archived: true,
    archivedAt: serverTimestamp(),
  });
}

export async function unarchiveTransaction(
  pairId: string,
  txId: string
): Promise<void> {
  await updateDoc(doc(db, "pairs", pairId, "transactions", txId), {
    archived: false,
    archivedAt: deleteField(),
  });
}

/**
 * Bulk-archive every approved (non-archived) transaction for a pair.
 * Intended for use after a debt is settled/forgiven and the pair balance is 0.
 * Writes are split into batches to stay under Firestore's 500-op limit.
 * Also marks the pair as hidden so it disappears from the dashboard.
 */
export async function archiveResolvedForPair(
  pairId: string,
  transactions: Transaction[]
): Promise<number> {
  const candidates = transactions.filter(
    (t) => t.status === "approved" && t.archived !== true
  );
  if (candidates.length === 0) return 0;

  const CHUNK = 450;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const slice = candidates.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const tx of slice) {
      batch.update(doc(db, "pairs", pairId, "transactions", tx.id), {
        archived: true,
        archivedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }

  // Mark the pair as hidden so it disappears from the dashboard
  await updateDoc(doc(db, "pairs", pairId), {
    hidden: true,
    hiddenAt: serverTimestamp(),
  });

  return candidates.length;
}

/**
 * Restore a pair to the dashboard (undo the hidden flag).
 * Individual archived transactions remain archived; use the pair page's
 * "Show archived" toggle + Unarchive to restore them.
 */
export async function unhidePair(pairId: string): Promise<void> {
  await updateDoc(doc(db, "pairs", pairId), {
    hidden: false,
    hiddenAt: deleteField(),
  });
}

/**
 * Mark a pair as hidden from the dashboard without archiving any transactions.
 * Use when all transactions have already been individually archived and the
 * bulk "Archive resolved" button is no longer shown.
 */
export async function hidePair(pairId: string): Promise<void> {
  await updateDoc(doc(db, "pairs", pairId), {
    hidden: true,
    hiddenAt: serverTimestamp(),
  });
}
