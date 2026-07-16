import { Timestamp } from "firebase/firestore";

// ─── Users ──────────────────────────────────────────────
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  currency: string;
  notificationPreferences?: NotificationPreferences;
  createdAt: Timestamp;
  deleted?: boolean;
  deletedAt?: Timestamp;
}

export interface NotificationPreferences {
  /** Email when a partner records a transaction that needs review. */
  transactionEmails: boolean;
  /** Email when a transaction is approved or disputed. */
  activityEmails: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  transactionEmails: true,
  activityEmails: true,
};

// ─── Pairs ──────────────────────────────────────────────
export interface Pair {
  id: string;
  users: [string, string];           // [uid1, uid2]
  userEmails: [string, string];
  userNames: [string, string];
  balance: number;                    // positive → users[0] is owed; negative → users[1] is owed
  currency: string;
  status: "active" | "pending" | "removed";
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedUsers?: Record<string, { deletedAt: Timestamp }>;
}

// ─── Transactions ───────────────────────────────────────
export type TransactionStatus = "pending" | "approved" | "disputed";
export type TransactionType = "payment" | "request" | "adjustment" | "settlement" | "forgiveness";

/**
 * Extra context for an expense that was divided between the two people. The
 * transaction amount remains the amount one person owes the other, so split
 * expenses use the exact same balance calculation as existing transactions.
 */
export interface SplitDetails {
  totalAmount: number;
  /** The percentage of the total paid/owed by the person who created the transaction. */
  creatorSharePercent: number;
  /** Which person paid the full bill before the split was recorded. */
  paidBy: "creator" | "partner";
}

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
  /** Canonical pair balance captured when a settlement was requested. */
  balanceAtRequest?: number;
  /** Stable key used to skip duplicate rows in CSV imports. */
  importFingerprint?: string;
  importBatchId?: string;
  split?: SplitDetails;
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
  split?: SplitDetails;
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
  expiresAt?: Timestamp;
  acceptedAt?: Timestamp;
  acceptedBy?: string;
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
