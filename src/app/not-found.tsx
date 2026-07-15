"use client";

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-200">404</h1>
        <p className="text-lg text-gray-500 mt-2">Page not found</p>
        <Link
          href="/"
          className="inline-block mt-4 text-blue-600 hover:underline font-medium text-sm"
        >
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
