import { auth } from "@/lib/firebase";

export type NotificationResult = {
  delivered?: boolean;
  skipped?: boolean;
  duplicate?: boolean;
  reason?: string;
};

type NotificationRequest =
  | { type: "invite"; inviteId: string }
  | { type: "transaction" | "resolved"; pairId: string; transactionId: string };

/**
 * The server derives addresses and message content from Firestore after it has
 * verified the Firebase ID token. Keeping raw email content out of this client
 * request prevents the endpoint from becoming an open mail relay.
 */
async function sendNotification(
  body: NotificationRequest
): Promise<NotificationResult> {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return { skipped: true, reason: "not_authenticated" };

    const response = await fetch("/api/send-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const result = (await response.json().catch(() => ({}))) as NotificationResult;
    if (!response.ok) {
      console.error("[Email] Notification was not delivered:", result.reason ?? response.status);
    }
    return result;
  } catch (error) {
    // A transaction or invitation is already committed at this point. Email is
    // deliberately best-effort so an outage never loses the user's data.
    console.error("[Email] Notification request failed:", error);
    return { skipped: true, reason: "network_error" };
  }
}

export function sendTransactionEmail(
  pairId: string,
  transactionId: string
): Promise<NotificationResult> {
  return sendNotification({ type: "transaction", pairId, transactionId });
}

export function sendResolvedEmail(
  pairId: string,
  transactionId: string
): Promise<NotificationResult> {
  return sendNotification({ type: "resolved", pairId, transactionId });
}

export function sendInviteEmail(inviteId: string): Promise<NotificationResult> {
  return sendNotification({ type: "invite", inviteId });
}
