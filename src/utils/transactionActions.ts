import {
  doc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  addDoc,
  collection,
  writeBatch,
  deleteField,
  deleteDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Pair, Transaction } from "@/types";
import { sendResolvedEmail, sendTransactionEmail } from "@/lib/email";

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

export async function approveTransaction(
  pair: Pair,
  tx: Transaction,
  userId: string
): Promise<void> {
  let newBalance = 0;

  await runTransaction(db, async (firestoreTransaction) => {
    const pairRef = doc(db, "pairs", pair.id);
    const txRef = doc(db, "pairs", pair.id, "transactions", tx.id);
    const [pairSnap, txSnap] = await Promise.all([
      firestoreTransaction.get(pairRef),
      firestoreTransaction.get(txRef),
    ]);
    if (!pairSnap.exists() || !txSnap.exists()) throw new Error("Transaction not found");
    const currentTx = txSnap.data() as Transaction;
    if (currentTx.status !== "pending") throw new Error("This transaction has already been resolved");
    if (currentTx.createdBy === userId) throw new Error("Only your partner can approve this transaction");

    const pairData = pairSnap.data();
    if (currentTx.type === "settlement") {
      const requestedBalance = currentTx.balanceAtRequest;
      if (
        typeof requestedBalance !== "number" ||
        !Number.isFinite(requestedBalance) ||
        requestedBalance === 0 ||
        Math.abs(requestedBalance) !== currentTx.amount
      ) {
        throw new Error("This settlement request is invalid");
      }
      if ((pairData.balance || 0) !== requestedBalance) {
        throw new Error("The balance changed after this settlement was requested. Send a new request.");
      }
      newBalance = 0;
    } else {
      const creatorIdx = pairData.users.indexOf(currentTx.createdBy);
      let balanceDelta = 0;
      if (currentTx.type === "payment") {
        balanceDelta = creatorIdx === 0 ? currentTx.amount : -currentTx.amount;
      } else {
        balanceDelta = creatorIdx === 0 ? -currentTx.amount : currentTx.amount;
      }
      newBalance = (pairData.balance || 0) + balanceDelta;
    }

    firestoreTransaction.update(pairRef, {
      balance: newBalance,
      updatedAt: serverTimestamp(),
    });
    firestoreTransaction.update(
      txRef,
      { status: "approved", resolvedAt: serverTimestamp() }
    );
  });

  await writeBalanceSnapshot(
    pair.id,
    newBalance,
    tx.type === "settlement" ? "settlement approved" : "transaction approved",
    userId
  );

  await sendResolvedEmail(pair.id, tx.id);
}

/**
 * Create a settlement request without changing the current balance. The
 * partner must approve it before the balance is zeroed.
 */
export async function requestSettlement(pair: Pair, userId: string): Promise<void> {
  let transactionId = "";

  await runTransaction(db, async (firestoreTransaction) => {
    const pairRef = doc(db, "pairs", pair.id);
    const pairSnap = await firestoreTransaction.get(pairRef);
    if (!pairSnap.exists()) throw new Error("Pair not found");

    const pairData = pairSnap.data();
    if (pairData.status !== "active") throw new Error("This connection is no longer active");
    if (!pairData.users.includes(userId)) throw new Error("You are not part of this connection");
    const balance = pairData.balance || 0;
    if (balance === 0) throw new Error("There is no balance to settle");

    const txRef = doc(collection(db, "pairs", pair.id, "transactions"));
    transactionId = txRef.id;
    firestoreTransaction.set(txRef, {
      pairId: pair.id,
      amount: Math.abs(balance),
      type: "settlement",
      description: "Settlement requested",
      createdBy: userId,
      status: "pending",
      balanceAtRequest: balance,
      createdAt: serverTimestamp(),
    });
  });

  await sendTransactionEmail(pair.id, transactionId);
}

/** Deny a settlement request without changing the pair balance. */
export async function denySettlement(
  pair: Pair,
  tx: Transaction,
  userId: string
): Promise<void> {
  await runTransaction(db, async (firestoreTransaction) => {
    const txRef = doc(db, "pairs", pair.id, "transactions", tx.id);
    const txSnap = await firestoreTransaction.get(txRef);
    if (!txSnap.exists()) throw new Error("Transaction not found");
    const currentTx = txSnap.data() as Transaction;
    if (currentTx.type !== "settlement" || currentTx.status !== "pending") {
      throw new Error("This settlement request has already been resolved");
    }
    if (currentTx.createdBy === userId) {
      throw new Error("Only your partner can deny this settlement request");
    }

    firestoreTransaction.update(txRef, {
      status: "disputed",
      resolvedAt: serverTimestamp(),
    });
  });

  await sendResolvedEmail(pair.id, tx.id);
}

export async function disputeTransaction(
  pair: Pair,
  tx: Transaction,
  userId: string,
  reason: string,
  proposedAmount: number | undefined
): Promise<void> {
  if (!reason.trim()) throw new Error("Provide a reason for the dispute");
  if (proposedAmount !== undefined && (!Number.isFinite(proposedAmount) || proposedAmount <= 0)) {
    throw new Error("Enter a valid counter-proposal amount");
  }
  await runTransaction(db, async (firestoreTransaction) => {
    const txRef = doc(db, "pairs", pair.id, "transactions", tx.id);
    const txSnap = await firestoreTransaction.get(txRef);
    if (!txSnap.exists()) throw new Error("Transaction not found");
    const currentTx = txSnap.data() as Transaction;
    if (currentTx.status !== "pending") throw new Error("This transaction has already been resolved");
    if (currentTx.type === "settlement") throw new Error("Settlement requests can only be approved or denied");
    if (currentTx.createdBy === userId) throw new Error("Only your partner can dispute this transaction");
    const update: Record<string, unknown> = {
      status: "disputed",
      disputeReason: reason.trim().slice(0, 500),
      resolvedAt: serverTimestamp(),
    };
    if (proposedAmount !== undefined) update.proposedAmount = proposedAmount;
    firestoreTransaction.update(txRef, update);
  });
  await sendResolvedEmail(pair.id, tx.id);
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
    const txRef = doc(db, "pairs", pair.id, "transactions", tx.id);
    const [pairSnap, txSnap] = await Promise.all([
      firestoreTransaction.get(pairRef),
      firestoreTransaction.get(txRef),
    ]);
    if (!pairSnap.exists() || !txSnap.exists()) throw new Error("Transaction not found");
    const currentTx = txSnap.data() as Transaction;
    if (currentTx.status !== "disputed" || currentTx.proposedAmount === undefined) {
      throw new Error("This counter-proposal is no longer available");
    }

    const pairData = pairSnap.data();
    const creatorIdx = pairData.users.indexOf(currentTx.createdBy);
    let balanceDelta = 0;
    if (currentTx.type === "payment") {
      balanceDelta = creatorIdx === 0 ? currentTx.proposedAmount : -currentTx.proposedAmount;
    } else {
      balanceDelta = creatorIdx === 0 ? -currentTx.proposedAmount : currentTx.proposedAmount;
    }
    newBalance = (pairData.balance || 0) + balanceDelta;

    firestoreTransaction.update(pairRef, {
      balance: newBalance,
      updatedAt: serverTimestamp(),
    });
    firestoreTransaction.update(
      txRef,
      {
        amount: currentTx.proposedAmount,
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

  return candidates.length;
}

/** Close a settled connection while preserving its read-only transaction history. */
export async function removeConnection(pair: Pair): Promise<void> {
  if (pair.status !== "active") throw new Error("This connection is no longer active");
  if (pair.balance !== 0) throw new Error("Settle the balance before removing this connection");

  await updateDoc(doc(db, "pairs", pair.id), {
    status: "removed",
    updatedAt: serverTimestamp(),
  });
}

/**
 * Hard-delete a pending transaction that the current user created.
 * Only works on transactions with status === "pending".
 */
export async function cancelTransaction(pairId: string, txId: string): Promise<void> {
  await deleteDoc(doc(db, "pairs", pairId, "transactions", txId));
}
