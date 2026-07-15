"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingScreen />}><AuthGate>{children}</AuthGate></Suspense>;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const continueTo = useSearchParams().get("continue");
  const destination = continueTo?.startsWith("/invite/") ? continueTo : "/";

  useEffect(() => {
    if (!loading && user) {
      router.replace(destination);
    }
  }, [user, loading, router, destination]);

  if (loading) return <LoadingScreen />;

  if (user) return null;
  return <>{children}</>;
}

function LoadingScreen() {
  return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>;
}
