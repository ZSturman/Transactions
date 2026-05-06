"use client";

import { useState, useRef, useEffect } from "react";
import { Pair } from "@/types";
import { useAuth } from "@/contexts/AuthContext";

interface PairOptionsMenuProps {
  pair: Pair;
  onExport: () => void;
  onForgive: () => void;
}

export default function PairOptionsMenu({ pair, onExport, onForgive }: PairOptionsMenuProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  if (!user) return null;

  const userIdx = pair.users.indexOf(user.uid);
  const userBalance = userIdx === 0 ? pair.balance : -pair.balance;
  const canForgive = userBalance > 0; // user is owed money — they can forgive

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        aria-label="More options"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-20">
          <button
            onClick={() => {
              onExport();
              setOpen(false);
            }}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Export transactions
          </button>
          {canForgive && (
            <button
              onClick={() => {
                onForgive();
                setOpen(false);
              }}
              className="w-full text-left px-4 py-2 text-sm text-purple-600 hover:bg-purple-50 transition-colors"
            >
              Forgive debt…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
