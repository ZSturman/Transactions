import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import {
  FirebaseAdminUnavailableError,
  getAdminAuth,
  getAdminDb,
} from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isExpired(expiresAt: unknown): boolean {
  return expiresAt instanceof Timestamp && expiresAt.toMillis() <= Date.now();
}

function isUserNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "auth/user-not-found"
  );
}

/**
 * An invite document is intentionally unreadable until the recipient signs in.
 * This endpoint lets the opaque, emailed invite URL choose the appropriate
 * authentication screen without exposing invitation details publicly.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  const { inviteId } = await params;
  if (!inviteId || inviteId.length > 256 || inviteId.includes("/")) {
    return NextResponse.json({ reason: "not_found" }, { status: 404 });
  }

  try {
    const snap = await getAdminDb().collection("invites").doc(inviteId).get();
    const invite = snap.data();
    if (
      !snap.exists ||
      !invite ||
      invite.status !== "pending" ||
      isExpired(invite.expiresAt) ||
      typeof invite.toEmail !== "string"
    ) {
      return NextResponse.json({ reason: "not_found" }, { status: 404 });
    }

    let hasAccount = true;
    try {
      await getAdminAuth().getUserByEmail(invite.toEmail);
    } catch (error) {
      if (!isUserNotFound(error)) throw error;
      hasAccount = false;
    }

    return NextResponse.json(
      { email: invite.toEmail, hasAccount },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof FirebaseAdminUnavailableError) {
      return NextResponse.json({ reason: "unavailable" }, { status: 503 });
    }
    console.error("Failed to resolve invitation recipient", error);
    return NextResponse.json({ reason: "unavailable" }, { status: 503 });
  }
}
