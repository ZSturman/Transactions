import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || "onboarding@resend.dev";

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

function buildHtml(body: SendEmailBody): string {
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
          <!-- Header -->
          <tr>
            <td style="background:${accentColor};padding:28px 40px;">
              <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Transactions</p>
            </td>
          </tr>
          <!-- Body -->
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
          <!-- Footer -->
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

export async function POST(req: NextRequest) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[Resend] RESEND_API_KEY not set — skipping email send.");
    return NextResponse.json({ skipped: true }, { status: 200 });
  }

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

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [to_email],
      subject,
      html: buildHtml(body),
    });

    if (error) {
      console.error("[Resend] Send error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[Resend] Unexpected error:", err);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
