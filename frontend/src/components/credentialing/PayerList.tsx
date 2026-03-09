import { useState } from "react";
import { useApi } from "../../hooks/useApi";
import { StatusBadge, ALL_STATUSES, STATUS_LABELS } from "./StatusBadge";
import type { CredentialingPayer } from "../../pages/CredentialingPage";

interface Props {
  payers: CredentialingPayer[];
  loading: boolean;
  statusFilter: string;
  onStatusFilterChange: (s: string) => void;
  onSelectPayer: (id: string) => void;
  onRefresh: () => void;
}

function AddPayerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const api = useApi();
  const [payerName, setPayerName] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!payerName.trim()) return;
    setSaving(true);
    try {
      await api.post("/api/credentialing/payers", { payer_name: payerName.trim() });
      onCreated();
      onClose();
    } catch (err) {
      console.error("Failed to create payer:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl border border-warm-100 p-6 w-full max-w-md">
        <h3 className="font-display text-lg font-semibold text-warm-800 mb-4">
          Add Payer Enrollment
        </h3>
        <form onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-warm-600 mb-1.5">
            Insurance Company Name
          </label>
          <input
            type="text"
            value={payerName}
            onChange={(e) => setPayerName(e.target.value)}
            placeholder="e.g. Blue Cross Blue Shield"
            className="w-full px-3 py-2.5 border border-warm-200 rounded-lg text-sm text-warm-800 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
            autoFocus
          />
          <div className="flex gap-3 mt-6 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-warm-500 hover:text-warm-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!payerName.trim() || saving}
              className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Creating..." : "Create Enrollment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function daysAgo(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function PayerList({ payers, loading, statusFilter, onStatusFilterChange, onSelectPayer, onRefresh }: Props) {
  const [showAddModal, setShowAddModal] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  // Summary counts
  const counts = {
    total: payers.length,
    credentialed: payers.filter((p) => p.status === "credentialed").length,
    pending: payers.filter((p) => ["application_submitted", "pending"].includes(p.status)).length,
    action: payers.filter((p) => ["not_started", "gathering_docs", "denied"].includes(p.status)).length,
  };

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard label="Total Payers" value={counts.total} color="warm" />
        <SummaryCard label="Credentialed" value={counts.credentialed} color="emerald" />
        <SummaryCard label="In Progress" value={counts.pending} color="blue" />
        <SummaryCard label="Needs Action" value={counts.action} color="amber" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="text-sm border border-warm-200 rounded-lg px-3 py-2 text-warm-700 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
          >
            <option value="">All statuses</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors shadow-sm"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
          </svg>
          Add Payer
        </button>
      </div>

      {/* Payer list */}
      {payers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-12 text-center">
          <div className="w-14 h-14 bg-warm-50 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-warm-300">
              <path d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-warm-500 text-sm mb-4">No payer enrollments yet.</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
          >
            Add your first payer enrollment
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {payers.map((payer) => {
            const daysSinceSubmission = daysAgo(payer.application_submitted_at);
            const isStale = daysSinceSubmission !== null && daysSinceSubmission > 30 &&
              ["application_submitted", "pending"].includes(payer.status);
            const isExpiringSoon = payer.expiration_date && payer.status === "credentialed" &&
              daysAgo(payer.expiration_date) !== null && daysAgo(payer.expiration_date)! < 0 &&
              Math.abs(daysAgo(payer.expiration_date)!) <= (payer.recredential_reminder_days || 90);

            return (
              <button
                key={payer.id}
                onClick={() => onSelectPayer(payer.id)}
                className="w-full text-left bg-white rounded-xl border border-warm-100 shadow-sm hover:shadow-md hover:border-warm-200 transition-all p-5 group"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-1.5">
                      <h3 className="font-medium text-warm-800 group-hover:text-teal-700 transition-colors truncate">
                        {payer.payer_name}
                      </h3>
                      <StatusBadge status={payer.status} />
                      {isStale && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-600">
                          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                            <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm.75-10.25a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0v-4.5zM8 12a1 1 0 100-2 1 1 0 000 2z" />
                          </svg>
                          {daysSinceSubmission}d pending
                        </span>
                      )}
                      {isExpiringSoon && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-600">
                          Expiring {formatDate(payer.expiration_date)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-warm-400">
                      {payer.application_submitted_at && (
                        <span>Submitted {formatDate(payer.application_submitted_at)}</span>
                      )}
                      {payer.credentialed_at && (
                        <span>Credentialed {formatDate(payer.credentialed_at)}</span>
                      )}
                      {payer.effective_date && (
                        <span>Effective {formatDate(payer.effective_date)}</span>
                      )}
                      {payer.expiration_date && (
                        <span>Expires {formatDate(payer.expiration_date)}</span>
                      )}
                      {!payer.application_submitted_at && !payer.credentialed_at && (
                        <span>Created {formatDate(payer.created_at)}</span>
                      )}
                    </div>
                  </div>
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-warm-300 group-hover:text-warm-500 transition-colors shrink-0 mt-0.5">
                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                  </svg>
                </div>

                {/* Doc checklist progress */}
                {payer.required_documents && payer.required_documents.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-warm-50">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-warm-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-teal-500 rounded-full transition-all"
                          style={{
                            width: `${(payer.required_documents.filter((d) => d.uploaded).length / payer.required_documents.length) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs text-warm-400">
                        {payer.required_documents.filter((d) => d.uploaded).length}/{payer.required_documents.length} docs
                      </span>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {showAddModal && (
        <AddPayerModal
          onClose={() => setShowAddModal(false)}
          onCreated={onRefresh}
        />
      )}
    </>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    warm: "bg-white",
    emerald: "bg-emerald-50/50",
    blue: "bg-blue-50/50",
    amber: "bg-amber-50/50",
  };
  const numColor: Record<string, string> = {
    warm: "text-warm-800",
    emerald: "text-emerald-700",
    blue: "text-blue-700",
    amber: "text-amber-700",
  };

  return (
    <div className={`${colorMap[color]} rounded-xl border border-warm-100 p-4`}>
      <p className="text-xs font-medium text-warm-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${numColor[color]}`}>{value}</p>
    </div>
  );
}
