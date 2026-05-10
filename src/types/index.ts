import { Timestamp } from "firebase/firestore";

// ─── Users ──────────────────────────────────────────────
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  currency: string;
  createdAt: Timestamp;
  deleted?: boolean;
  deletedAt?: Timestamp;
}

// ─── Pairs ──────────────────────────────────────────────
export interface Pair {
  id: string;
  users: [string, string];           // [uid1, uid2]
  userEmails: [string, string];
  userNames: [string, string];
  balance: number;                    // positive → users[0] is owed; negative → users[1] is owed
  currency: string;
  status: "active" | "archived" | "pending";
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedUsers?: Record<string, { deletedAt: Timestamp }>;
  hidden?: boolean;                   // hides this pair from dashboard (set after bulk archive)
  hiddenAt?: Timestamp;
}

// ─── Transactions ───────────────────────────────────────
export type TransactionStatus = "pending" | "approved" | "disputed";
export type TransactionType = "payment" | "request" | "adjustment" | "settlement" | "forgiveness";

export interface Transaction {
  id: string;
  pairId: string;
  amount: number;
  type: TransactionType;
  description: string;
  createdBy: string;                  // uid of creator
  status: TransactionStatus;
  disputeReason?: string;
  proposedAmount?: number;            // counter-proposal amount in disputes
  date?: Timestamp;                   // user-specified event date (defaults to createdAt for display)
  createdAt: Timestamp;
  resolvedAt?: Timestamp;
  archived?: boolean;                 // soft-archive: hidden from default views
  archivedAt?: Timestamp;
}

// ─── Balance Snapshots ──────────────────────────────────
export interface BalanceSnapshot {
  id: string;
  balance: number;                    // from perspective of users[0]
  timestamp: Timestamp;
  triggeredBy: string;                // uid of user who triggered the change
  reason: string;                     // e.g. "approved", "settled", "forgiven"
}

// ─── Invites ────────────────────────────────────────────
export type InviteStatus = "pending" | "accepted" | "expired";

export interface PendingTransaction {
  amount: number;
  type: TransactionType;
  description: string;
  date: string; // ISO date string (YYYY-MM-DD)
}

export interface Invite {
  id: string;
  fromUid: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  pairId: string;
  status: InviteStatus;
  pendingTransaction?: PendingTransaction;
  createdAt: Timestamp;
}

// ─── Currencies (subset for the picker) ─────────────────
export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "CAD", symbol: "CA$", name: "Canadian Dollar" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "CHF", symbol: "CHF", name: "Swiss Franc" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan" },
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "MXN", symbol: "MX$", name: "Mexican Peso" },
  { code: "BRL", symbol: "R$", name: "Brazilian Real" },
  { code: "KRW", symbol: "₩", name: "South Korean Won" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar" },
  { code: "HKD", symbol: "HK$", name: "Hong Kong Dollar" },
  { code: "NOK", symbol: "kr", name: "Norwegian Krone" },
  { code: "SEK", symbol: "kr", name: "Swedish Krona" },
  { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar" },
  { code: "ZAR", symbol: "R", name: "South African Rand" },
  { code: "ILS", symbol: "₪", name: "Israeli Shekel" },
  { code: "TRY", symbol: "₺", name: "Turkish Lira" },
];
