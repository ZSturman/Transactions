import type { EmailType } from "@/app/api/send-email/route";

interface EmailParams {
  to_email: string;
  to_name: string;
  from_name: string;
  subject: string;
  message: string;
  action_url?: string;
}

async function sendEmail(type: EmailType, params: EmailParams): Promise<void> {
  try {
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...params }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error("[Email] Failed to send:", data.error ?? res.statusText);
    }
  } catch (err) {
    console.error("[Email] Network error:", err);
  }
}

export function sendTransactionEmail(params: EmailParams): Promise<void> {
  return sendEmail("transaction", params);
}

export function sendResolvedEmail(params: EmailParams): Promise<void> {
  return sendEmail("resolved", params);
}

export function sendInviteEmail(params: EmailParams): Promise<void> {
  return sendEmail("invite", params);
}
