import emailjs from "@emailjs/browser";

const SERVICE_ID = process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID || "YOUR_SERVICE_ID";
const PUBLIC_KEY = process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY || "YOUR_PUBLIC_KEY";

const TEMPLATE_TRANSACTION_CREATED = process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_TRANSACTION || "template_transaction";
const TEMPLATE_TRANSACTION_RESOLVED = process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_RESOLVED || "template_resolved";
const TEMPLATE_INVITE = process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_INVITE || "template_invite";

emailjs.init(PUBLIC_KEY);

interface EmailParams {
  [key: string]: unknown;
  to_email: string;
  to_name: string;
  from_name: string;
  subject: string;
  message: string;
  action_url?: string;
}

export async function sendTransactionEmail(params: EmailParams) {
  if (SERVICE_ID === "YOUR_SERVICE_ID") {
    console.warn("[EmailJS] Not configured — skipping email send. Set NEXT_PUBLIC_EMAILJS_* env vars.");
    return;
  }
  try {
    await emailjs.send(SERVICE_ID, TEMPLATE_TRANSACTION_CREATED, params);
  } catch (err) {
    console.error("Failed to send email:", err);
  }
}

export async function sendResolvedEmail(params: EmailParams) {
  if (SERVICE_ID === "YOUR_SERVICE_ID") return;
  try {
    await emailjs.send(SERVICE_ID, TEMPLATE_TRANSACTION_RESOLVED, params);
  } catch (err) {
    console.error("Failed to send email:", err);
  }
}

export async function sendInviteEmail(params: EmailParams) {
  if (SERVICE_ID === "YOUR_SERVICE_ID") return;
  try {
    await emailjs.send(SERVICE_ID, TEMPLATE_INVITE, params);
  } catch (err) {
    console.error("Failed to send email:", err);
  }
}
