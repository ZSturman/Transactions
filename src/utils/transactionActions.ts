import {
  doc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  addDoc,
  collection,
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
