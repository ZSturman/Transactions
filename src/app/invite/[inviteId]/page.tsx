"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Invite } from "@/types";
import { isInviteExpired, useInvites } from "@/hooks/useInvites";

type PageState = "loading" | "ready" | "expired" | "unavailable" | "accepting";

export default function InvitationPage() {
  const params = useParams<{ inviteId: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { acceptInvite } = useInvites();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [state, setState] = useState<PageState>("loading");
  const [error, setError] = useState("");
  const inviteId = params.inviteId;
  const continueTo = `/invite/${encodeURIComponent(inviteId)}`;

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      let mounted = true;
      async function chooseAuthenticationScreen() {
        try {
          const response = await fetch(`/api/invites/${encodeURIComponent(inviteId)}/recipient`, {
            cache: "no-store",
          });
          if (!response.ok) throw new Error("Invitation unavailable");

          const recipient = (await response.json()) as {
            email?: unknown;
            hasAccount?: unknown;
          };
          if (typeof recipient.email !== "string" || typeof recipient.hasAccount !== "boolean") {
            throw new Error("Invalid invitation recipient");
          }

          const search = new URLSearchParams({
            continue: continueTo,
            email: recipient.email,
          });
          if (mounted) {
            router.replace(`/${recipient.hasAccount ? "login" : "register"}?${search}`);
          }
        } catch {
          if (mounted) {
            setError("This invitation is invalid, expired, or temporarily unavailable.");
            setState("unavailable");
          }
        }
      }
      void chooseAuthenticationScreen();
      return () => {
        mounted = false;
      };
    }

    let mounted = true;
    async function load() {
      try {
        const snapshot = await getDoc(doc(db, "invites", inviteId));
        if (!snapshot.exists()) {
          if (mounted) setState("unavailable");
          return;
        }
        const data = { id: snapshot.id, ...snapshot.data() } as Invite;
        if (data.toEmail.toLowerCase() !== user!.email?.toLowerCase()) {
          if (mounted) {
            setError("This invitation was sent to a different email address.");
            setState("unavailable");
          }
          return;
        }
        if (data.status !== "pending" || isInviteExpired(data)) {
          if (mounted) setState("expired");
          return;
        }
        if (mounted) {
          setInvite(data);
          setState("ready");
        }
      } catch {
        if (mounted) {
          setError("Sign in with the email address that received this invitation.");
          setState("unavailable");
        }
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [authLoading, user, inviteId, router, continueTo]);

  async function handleAccept() {
    if (!invite) return;
    setState("accepting");
    setError("");
    try {
      await acceptInvite(invite);
      router.replace(`/pair/${invite.pairId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not accept this invitation");
      setState("ready");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <section className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-7 shadow-sm text-center">
        <h1 className="text-2xl font-bold text-blue-600">Transactions</h1>
        {state === "loading" && <p className="mt-5 text-sm text-gray-500">Checking your invitation…</p>}
        {state === "ready" || state === "accepting" ? (
          <>
            <h2 className="mt-5 text-lg font-semibold">{invite?.fromName} invited you</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Accept to start tracking shared transactions and balances together.
            </p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <button
              onClick={handleAccept}
              disabled={state === "accepting"}
              className="btn-primary mt-6 w-full"
            >
              {state === "accepting" ? "Accepting…" : "Accept invitation"}
            </button>
          </>
        ) : null}
        {state === "expired" && (
          <>
            <h2 className="mt-5 text-lg font-semibold">This invitation is no longer valid</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">It may have expired, been cancelled, or already been accepted. Ask the sender for a new invitation.</p>
          </>
        )}
        {state === "unavailable" && (
          <>
            <h2 className="mt-5 text-lg font-semibold">We couldn&apos;t open this invitation</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">{error || "This link is invalid, has expired, or is not for this account."}</p>
          </>
        )}
      </section>
    </main>
  );
}
