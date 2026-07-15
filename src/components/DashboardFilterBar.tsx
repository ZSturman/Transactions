"use client";

import { Pair, TransactionType } from "@/types";
import { useAuth } from "@/contexts/AuthContext";

export interface DashboardFilters {
  searchText: string;
  statusFilter: "all" | "pending" | "approved" | "disputed";
  typeFilter: "all" | TransactionType;
  pairFilter: "all" | string;
}

interface DashboardFilterBarProps {
  filters: DashboardFilters;
  onChange: (filters: DashboardFilters) => void;
  pairs: Pair[];
  totalCount: number;
  filteredCount: number;
}

const STATUS_OPTIONS = ["all", "pending", "approved", "disputed"] as const;
const TYPE_OPTIONS: { value: "all" | TransactionType; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "payment", label: "Payment" },
  { value: "request", label: "Request" },
  { value: "adjustment", label: "Adjustment" },
  { value: "settlement", label: "Settlement" },
  { value: "forgiveness", label: "Forgiveness" },
];

const isFiltered = (f: DashboardFilters) =>
  f.searchText !== "" ||
  f.statusFilter !== "all" ||
  f.typeFilter !== "all" ||
  f.pairFilter !== "all";

export default function DashboardFilterBar({
  filters,
  onChange,
  pairs,
  totalCount,
  filteredCount,
}: DashboardFilterBarProps) {
  const { user } = useAuth();

  function set(partial: Partial<DashboardFilters>) {
    onChange({ ...filters, ...partial });
  }

  function clear() {
    onChange({ searchText: "", statusFilter: "all", typeFilter: "all", pairFilter: "all" });
  }

  const activePairs = pairs.filter((p) => p.status === "active");

  return (
    <div className="space-y-2">
      {/* Search row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search transactions…"
            value={filters.searchText}
            onChange={(e) => set({ searchText: e.target.value })}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition"
          />
        </div>

        {/* Type select */}
        <select
          value={filters.typeFilter}
          onChange={(e) => set({ typeFilter: e.target.value as DashboardFilters["typeFilter"] })}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {/* Person select */}
        {activePairs.length > 1 && (
          <select
            value={filters.pairFilter}
            onChange={(e) => set({ pairFilter: e.target.value })}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition"
          >
            <option value="all">All people</option>
            {activePairs.map((p) => {
              const idx = user ? p.users.indexOf(user.uid) : -1;
              const partner = idx !== -1 ? p.userNames[idx === 0 ? 1 : 0] : p.id;
              return (
                <option key={p.id} value={p.id}>
                  {partner}
                </option>
              );
            })}
          </select>
        )}

        {isFiltered(filters) && (
          <button
            onClick={clear}
            className="text-xs text-blue-600 hover:underline whitespace-nowrap"
          >
            Clear
          </button>
        )}
      </div>

      {/* Status pills row */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => set({ statusFilter: s })}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize font-medium ${
                filters.statusFilter === s
                  ? "bg-gray-800 text-white border-gray-800"
                  : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        {isFiltered(filters) && (
          <span className="text-xs text-gray-400 ml-1">
            {filteredCount} of {totalCount}
          </span>
        )}
      </div>
    </div>
  );
}
