import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { Resend } from "resend";
import {
  FirebaseAdminUnavailableError,
  getAdminAuth,
  getAdminDb,
} from "@/lib/firebase-admin";

export const runtime = "nodejs";

export type EmailType = "transaction" | "resolved" | "invite";

type SendEmailBody =
  | { type: "invite"; inviteId: string }
  | { type: "transaction" | "resolved"; pairId: string; transactionId: string };

type Delivery = {
  id: string;
  toEmail: string;
  toName: string;
  fromName: string;
  subject: string;
  message: string;
  actionUrl: string;
  preferenceEnabled: boolean;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character]!;
  });
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(Math.abs(amount));
  } catch {
    return `${currency} ${Math.abs(amount).toFixed(2)}`;
  }
}

function appUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return request.nextUrl.origin;
}

function emailHtml(delivery: Delivery, accent = "#2563eb"): string {
  const toName = escapeHtml(delivery.toName || "there");
  const fromName = escapeHtml(delivery.fromName);
  const message = escapeHtml(delivery.message);
  const subject = escapeHtml(delivery.subject);
  const actionUrl = escapeHtml(delivery.actionUrl);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#172033">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;background:#f8fafc"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
      <tr><td style="padding:22px 32px;background:${accent};font-weight:700;font-size:20px;color:#fff">Transactions</td></tr>
      <tr><td style="padding:32px"><p style="margin:0 0 12px;font-size:15px">Hi ${toName},</p><p style="margin:0 0 24px;font-size:15px;line-height:1.6">${message}</p>
      <a href="${actionUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:${accent};color:#fff;text-decoration:none;font-size:14px;font-weight:600">Open Transactions</a></td></tr>
      <tr><td style="padding:18px 32px;border-top:1px solid #eef2f7;font-size:12px;color:#64748b">Sent by ${fromName} via Transactions.</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !value.includes("/");
}

function parseBody(value: unknown): SendEmailBody | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.type === "invite" && validId(body.inviteId)) {
    return { type: "invite", inviteId: body.inviteId };
  }
  if (
    (body.type === "transaction" || body.type === "resolved") &&
    validId(body.pairId) &&
    validId(body.transactionId)
  ) {
    return { type: body.type, pairId: body.pairId, transactionId: body.transactionId };
  }
  return null;
}

async function verifyActor(request: NextRequest): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const decoded = await getAdminAuth().verifyIdToken(token);
  return decoded.uid;
}

async function profileFor(uid: string) {
  const snap = await getAdminDb().collection("users").doc(uid).get();
  return snap.exists ? snap.data() ?? {} : {};
}

function isExpired(expiresAt: unknown): boolean {
  return expiresAt instanceof Timestamp && expiresAt.toMillis() <= Date.now();
}

async function buildInviteDelivery(
  body: Extract<SendEmailBody, { type: "invite" }>,
  actorUid: string,
  request: NextRequest
): Promise<Delivery | null> {
  const inviteSnap = await getAdminDb().collection("invites").doc(body.inviteId).get();
  if (!inviteSnap.exists) return null;
  const invite = inviteSnap.data() ?? {};
  if (
    invite.fromUid !== actorUid ||
    invite.status !== "pending" ||
    isExpired(invite.expiresAt) ||
    typeof invite.toEmail !== "string"
  ) {
    return null;
  }

  const fromName = String(invite.fromName || invite.fromEmail || "A Transactions user");
  const recipientName = invite.toEmail.split("@")[0] || "there";
  return {
    id: `invite_${body.inviteId}`,
    toEmail: invite.toEmail,
    toName: recipientName,
    fromName,
    subject: `${fromName} invited you to Transactions`,
    message: `${fromName} invited you to track shared transactions and balances. Sign in or create an account with this email address to accept the invitation.`,
    actionUrl: `${appUrl(request)}/invite/${encodeURIComponent(body.inviteId)}`,
    preferenceEnabled: true,
  };
}

async function buildTransactionDelivery(
  body: Extract<SendEmailBody, { type: "transaction" | "resolved" }>,
  actorUid: string,
  request: NextRequest
): Promise<Delivery | null> {
  const db = getAdminDb();
  const pairRef = db.collection("pairs").doc(body.pairId);
  const txRef = pairRef.collection("transactions").doc(body.transactionId);
  const [pairSnap, txSnap, actorProfile] = await Promise.all([
    pairRef.get(),
    txRef.get(),
    profileFor(actorUid),
  ]);
  if (!pairSnap.exists || !txSnap.exists) return null;

  const pair = pairSnap.data() ?? {};
  const transaction = txSnap.data() ?? {};
  const users = Array.isArray(pair.users) ? pair.users : [];
  const userEmails = Array.isArray(pair.userEmails) ? pair.userEmails : [];
  const userNames = Array.isArray(pair.userNames) ? pair.userNames : [];
  const actorIndex = users.indexOf(actorUid);
  if (pair.status !== "active" || actorIndex === -1) return null;

  if (body.type === "transaction" && transaction.createdBy !== actorUid) return null;
  if (
    body.type === "resolved" &&
    !["approved", "disputed"].includes(String(transaction.status))
  ) {
    return null;
  }

  const recipientUid =
    body.type === "transaction"
      ? users.find((uid: unknown) => uid !== actorUid)
      : transaction.createdBy === actorUid
      ? users.find((uid: unknown) => uid !== actorUid)
      : transaction.createdBy;
  const recipientIndex = users.indexOf(recipientUid);
  if (typeof recipientUid !== "string" || recipientIndex === -1 || recipientUid === actorUid) return null;

  const recipientProfile = await profileFor(recipientUid);
  const preferences = (recipientProfile.notificationPreferences ?? {}) as Record<string, unknown>;
  const preferenceEnabled =
    body.type === "transaction"
      ? preferences.transactionEmails !== false
      : preferences.activityEmails !== false;
  const amount = formatAmount(Number(transaction.amount) || 0, String(pair.currency || "USD"));
  const description = transaction.description ? ` for “${String(transaction.description)}”` : "";
  const fromName = String(actorProfile.displayName || userNames[actorIndex] || userEmails[actorIndex] || "Your partner");
  const toName = String(recipientProfile.displayName || userNames[recipientIndex] || userEmails[recipientIndex] || "there");
  const isApproved = transaction.status === "approved";
  const action = body.type === "transaction"
    ? transaction.type === "request"
      ? "requested"
      : "recorded a payment of"
    : isApproved
    ? "approved"
    : "disputed";
  const message = body.type === "transaction"
    ? `${fromName} ${action} ${amount}${description}. Review the transaction in Transactions.`
    : isApproved
    ? `${fromName} approved your transaction of ${amount}${description}. The shared balance has been updated.`
    : `${fromName} disputed your transaction of ${amount}${description}${transaction.disputeReason ? `: “${String(transaction.disputeReason)}”` : "."}`;

  return {
    id: `${body.type}_${body.pairId}_${body.transactionId}`,
    toEmail: String(recipientProfile.email || userEmails[recipientIndex] || ""),
    toName,
    fromName,
    subject:
      body.type === "transaction"
        ? `${fromName} ${action} ${amount}`
        : `Transaction ${isApproved ? "approved" : "disputed"}: ${amount}`,
    message,
    actionUrl: `${appUrl(request)}/pair/${encodeURIComponent(body.pairId)}`,
    preferenceEnabled: preferenceEnabled && Boolean(recipientProfile.email || userEmails[recipientIndex]),
  };
}

async function claimDelivery(delivery: Delivery): Promise<boolean> {
  const ref = getAdminDb().collection("notificationDeliveries").doc(delivery.id);
  let claimed = false;
  await getAdminDb().runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) return;
    transaction.create(ref, {
      state: "claimed",
      kind: delivery.id.split("_")[0],
      toEmail: delivery.toEmail,
      createdAt: FieldValue.serverTimestamp(),
    });
    claimed = true;
  });
  return claimed;
}

async function updateDelivery(id: string, values: Record<string, unknown>) {
  await getAdminDb().collection("notificationDeliveries").doc(id).update({
    ...values,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function POST(request: NextRequest) {
  let body: SendEmailBody | null;
  try {
    body = parseBody(await request.json());
  } catch {
    body = null;
  }
  if (!body) return NextResponse.json({ reason: "invalid_request" }, { status: 400 });

  let actorUid: string | null;
  try {
    actorUid = await verifyActor(request);
  } catch (error) {
    if (error instanceof FirebaseAdminUnavailableError) {
      return NextResponse.json({ skipped: true, reason: "email_not_configured" }, { status: 202 });
    }
    return NextResponse.json({ reason: "invalid_auth" }, { status: 401 });
  }
  if (!actorUid) return NextResponse.json({ reason: "missing_auth" }, { status: 401 });

  const delivery =
    body.type === "invite"
      ? await buildInviteDelivery(body, actorUid, request)
      : await buildTransactionDelivery(body, actorUid, request);
  if (!delivery) return NextResponse.json({ skipped: true, reason: "resource_unavailable" }, { status: 202 });

  const claimed = await claimDelivery(delivery);
  if (!claimed) return NextResponse.json({ duplicate: true, reason: "already_processed" }, { status: 200 });

  if (!delivery.preferenceEnabled) {
    await updateDelivery(delivery.id, { state: "skipped", reason: "preference_disabled" });
    return NextResponse.json({ skipped: true, reason: "preference_disabled" }, { status: 200 });
  }
  if (!process.env.RESEND_API_KEY) {
    await updateDelivery(delivery.id, { state: "skipped", reason: "resend_not_configured" });
    return NextResponse.json({ skipped: true, reason: "resend_not_configured" }, { status: 202 });
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? "Transactions <onboarding@resend.dev>",
      to: [delivery.toEmail],
      subject: delivery.subject,
      html: emailHtml(delivery, body.type === "invite" ? "#4f46e5" : "#2563eb"),
    });
    if (error) throw new Error(error.message);
    await updateDelivery(delivery.id, { state: "sent", sentAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ delivered: true }, { status: 200 });
  } catch (error) {
    console.error("[Email] Resend delivery failed", error);
    // Do not retry automatically: Resend may have accepted the message before
    // a network failure. This at-most-once reservation avoids duplicates.
    await updateDelivery(delivery.id, { state: "failed", reason: "provider_error" });
    return NextResponse.json({ skipped: true, reason: "provider_error" }, { status: 202 });
  }
}
