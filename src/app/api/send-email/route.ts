import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import emailjs from "@emailjs/nodejs";

export type EmailType = "transaction" | "resolved" | "invite";

interface SendEmailBody {
  type: EmailType;
  to_email: string;
  to_name: string;
  from_name: string;
  subject: string;
  message: string;
  action_url?: string;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── EmailJS ────────────────────────────────────────────────────────────────

function getEmailJSTemplateId(type: EmailType): string {
  if (type === "invite") {
    return process.env.EMAILJS_TEMPLATE_INVITE_ID!;
  }
  return process.env.EMAILJS_TEMPLATE_TRANSACTION_ID!;
}

async function sendViaEmailJS(body: SendEmailBody): Promise<void> {
  const { type, to_email, to_name, from_name, subject, message, action_url } = body;

  const accentColor =
    type === "resolved" ? "#10b981" : type === "invite" ? "#6366f1" : "#3b82f6";
  const ctaLabel =
    type === "resolved" ? "View Balance" : type === "invite" ? "Accept Invite" : "Review Transaction";

  const templateParams: Record<string, string> = {
    to_email,
    to_name,
    from_name,
    subject,
    message,
    action_url: action_url ?? "",
    accent_color: accentColor,
    cta_label: ctaLabel,
  };

  await emailjs.send(
    process.env.EMAILJS_SERVICE_ID!,
    getEmailJSTemplateId(type),
    templateParams,
    {
      publicKey: process.env.EMAILJS_PUBLIC_KEY!,
      privateKey: process.env.EMAILJS_PRIVATE_KEY!,
    }
  );
}

// ─── Resend (fallback) ───────────────────────────────────────────────────────

function buildResendHtml(body: SendEmailBody): string {
  const { to_name, from_name, message, action_url, type } = body;

  const accentColor =
    type === "invite" ? "#6366f1" : type === "resolved" ? "#10b981" : "#3b82f6";
  const ctaLabel =
    type === "invite" ? "Accept Invite" : type === "resolved" ? "View Balance" : "Review Transaction";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${body.subject}</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background:${accentColor};padding:28px 40px;">
              <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Transactions</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 8px;font-size:15px;color:#6b7280;">Hi ${to_name},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#111827;line-height:1.6;">${message}</p>
              ${
                action_url
                  ? `<a href="${action_url}" style="display:inline-block;background:${accentColor};color:#ffffff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;">${ctaLabel}</a>`
                  : ""
              }
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f3f4f6;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">Sent by ${from_name} via Transactions</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendViaResend(body: SendEmailBody): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? "Transactions App <onboarding@resend.dev>";

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: [body.to_email],
    subject: body.subject,
    html: buildResendHtml(body),
  });

  if (error) {
    throw new Error(error.message);
  }
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: SendEmailBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { type, to_email, to_name, from_name, subject, message } = body;

  if (!type || !to_email || !to_name || !from_name || !subject || !message) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!isValidEmail(to_email)) {
    return NextResponse.json({ error: "Invalid to_email" }, { status: 400 });
  }

  const emailJSConfigured =
    process.env.EMAILJS_SERVICE_ID &&
    process.env.EMAILJS_PUBLIC_KEY &&
    process.env.EMAILJS_PRIVATE_KEY &&
    process.env.EMAILJS_TEMPLATE_INVITE_ID &&
    process.env.EMAILJS_TEMPLATE_TRANSACTION_ID;

  // Try EmailJS first
  if (emailJSConfigured) {
    try {
      await sendViaEmailJS(body);
      return NextResponse.json({ ok: true, via: "emailjs" }, { status: 200 });
    } catch (emailJSError) {
      console.error("[EmailJS] Send failed, trying Resend fallback:", emailJSError);
    }
  } else {
    console.warn("[EmailJS] Not configured — skipping to Resend fallback.");
  }

  // Resend fallback
  if (!process.env.RESEND_API_KEY) {
    console.warn("[Resend] RESEND_API_KEY not set — skipping email send.");
    return NextResponse.json({ skipped: true }, { status: 200 });
  }

  try {
    await sendViaResend(body);
    return NextResponse.json({ ok: true, via: "resend" }, { status: 200 });
  } catch (resendError) {
    console.error("[Resend] Fallback also failed:", resendError);
    return NextResponse.json({ skipped: true }, { status: 200 });
  }
}
