"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, updateDoc, getDocs, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { usePairs } from "@/hooks/usePairs";
import { CURRENCIES, DEFAULT_NOTIFICATION_PREFERENCES, NotificationPreferences } from "@/types";
import { exportAllToCsv, exportAllToJson } from "@/utils/export";
import toast from "react-hot-toast";

export default function SettingsPage() {
  const { profile, user, logout, refreshProfile, deleteAccount } = useAuth();
  const { pairs } = usePairs();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(profile?.displayName || "");
  const [currency, setCurrency] = useState(profile?.currency || "USD");
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(
    profile?.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFERENCES
  );
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showDanger, setShowDanger] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", user.uid), { displayName, currency, notificationPreferences });
      await refreshProfile();
      toast.success("Settings saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  async function loadExportData() {
    if (!user) return;
    setExporting(true);
    try {
      const exportPairs = pairs.filter((p) => p.status === "active" || p.status === "pending");
      const transactionsByPairId: Record<string, any[]> = {};
      await Promise.all(
        exportPairs.map(async (pair) => {
          const snap = await getDocs(collection(db, "pairs", pair.id, "transactions"));
          transactionsByPairId[pair.id] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        })
      );
      return { exportPairs, transactionsByPairId };
    } catch (err: any) {
      toast.error(err.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportCsv() {
    const data = await loadExportData();
    if (!data || !user) return;
    exportAllToCsv(data.exportPairs, data.transactionsByPairId, user.uid);
    toast.success("CSV downloaded");
  }

  async function handleExportJson() {
    const data = await loadExportData();
    if (!data) return;
    exportAllToJson(data.exportPairs, data.transactionsByPairId);
    toast.success("JSON downloaded");
  }

  async function handleDeleteAccount() {
    if (!user || !profile) return;
    if (confirmName !== profile.displayName) {
      toast.error("Name doesn't match — please type your display name exactly");
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount();
      router.push("/login");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete account");
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <h1 className="text-xl font-bold">Settings</h1>

      <div className="card">
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
            <input
              type="text"
              className="input-field"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-3">
            <div>
              <h3 className="text-sm font-medium text-gray-700">Email notifications</h3>
              <p className="text-xs text-gray-400 mt-1">Invitation emails are always sent. Control nonessential activity emails here.</p>
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={notificationPreferences.transactionEmails}
                onChange={(event) => setNotificationPreferences((current) => ({ ...current, transactionEmails: event.target.checked }))}
                className="mt-0.5 rounded border-gray-300"
              />
              <span><span className="font-medium text-gray-700">New transaction requests</span><br /><span className="text-xs text-gray-400">When a partner adds a transaction that needs your review.</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={notificationPreferences.activityEmails}
                onChange={(event) => setNotificationPreferences((current) => ({ ...current, activityEmails: event.target.checked }))}
                className="mt-0.5 rounded border-gray-300"
              />
              <span><span className="font-medium text-gray-700">Approvals and disputes</span><br /><span className="text-xs text-gray-400">When your partner resolves a transaction you created.</span></span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              className="input-field bg-gray-50"
              value={user?.email || ""}
              disabled
            />
            <p className="text-xs text-gray-400 mt-1">Email cannot be changed</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Default Currency</label>
            <select
              className="input-field"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.symbol} {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </form>
      </div>

      {/* Your Data */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Your Data</h2>
        <p className="text-xs text-gray-500 mb-3">
          Download a flat CSV for spreadsheets or a complete JSON file that preserves pair and transaction IDs, statuses, and relationships. Archived and pending records are included.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={handleExportCsv} className="btn-secondary text-sm" disabled={exporting}>{exporting ? "Exporting…" : "Download CSV"}</button>
          <button onClick={handleExportJson} className="btn-secondary text-sm" disabled={exporting}>{exporting ? "Exporting…" : "Download JSON"}</button>
        </div>
      </div>

      {/* Account */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Account</h2>
        <button onClick={handleLogout} className="btn-danger w-full">
          Sign Out
        </button>
      </div>

      {/* Danger Zone */}
      <div className="card border-red-200">
        <button
          onClick={() => setShowDanger((v) => !v)}
          className="flex items-center justify-between w-full text-left"
        >
          <h2 className="text-sm font-semibold text-red-700">Danger Zone</h2>
          <span className="text-xs text-red-400">{showDanger ? "▲" : "▼"}</span>
        </button>

        {showDanger && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-gray-600">
              Permanently deletes your account and removes you from all shared balances.
              Your name will appear as <span className="font-medium">[Deleted Account]</span> to others.
              This cannot be undone.
            </p>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Type your display name to confirm:{" "}
                <span className="font-semibold text-gray-700">{profile?.displayName}</span>
              </label>
              <input
                type="text"
                className="input-field text-sm border-red-200 focus:ring-red-400"
                placeholder="Your display name"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
              />
            </div>
            <button
              onClick={handleDeleteAccount}
              className="btn-danger w-full"
              disabled={deleting || confirmName !== profile?.displayName}
            >
              {deleting ? "Deleting…" : "Permanently Delete Account"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
