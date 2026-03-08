import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Superbill {
  id: string;
  client_id: string;
  appointment_id: string | null;
  note_id: string | null;
  clinician_id: string;
  date_of_service: string | null;
  cpt_code: string;
  cpt_description: string | null;
  diagnosis_codes: { code: string; description: string; rank: number }[];
  fee: number | null;
  amount_paid: number;
  status: "generated" | "submitted" | "paid" | "outstanding";
  has_pdf: boolean;
  client_name: string | null;
  client_uuid: string | null;
  created_at: string;
  updated_at: string;
}

interface BillingSummary {
  total_billed: number;
  total_paid: number;
  total_outstanding: number;
}

interface SuperbillsResponse {
  superbills: Superbill[];
  count: number;
  summary: BillingSummary;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "-";
  return `$${amount.toFixed(2)}`;
}

const STATUS_STYLES: Record<string, string> = {
  generated: "bg-blue-50 text-blue-700",
  submitted: "bg-amber-50 text-amber-700",
  paid: "bg-teal-50 text-teal-700",
  outstanding: "bg-red-50 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  generated: "Generated",
  submitted: "Submitted",
  paid: "Paid",
  outstanding: "Outstanding",
};

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "generated", label: "Generated" },
  { value: "submitted", label: "Submitted" },
  { value: "paid", label: "Paid" },
  { value: "outstanding", label: "Outstanding" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BillingPage() {
  const api = useApi();
  const [superbills, setSuperbills] = useState<Superbill[]>([]);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [emailingId, setEmailingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadSuperbills = useCallback(async () => {
    try {
      const statusParam = filter !== "all" ? `?status=${filter}` : "";
      const data = await api.get<SuperbillsResponse>(
        `/api/superbills${statusParam}`
      );
      setSuperbills(
        data.superbills.map((sb) => ({
          ...sb,
          diagnosis_codes:
            typeof sb.diagnosis_codes === "string"
              ? JSON.parse(sb.diagnosis_codes)
              : sb.diagnosis_codes || [],
        }))
      );
      setSummary(data.summary);
    } catch (err) {
      console.error("Failed to load superbills:", err);
    } finally {
      setLoading(false);
    }
  }, [api, filter]);

  useEffect(() => {
    loadSuperbills();
  }, [loadSuperbills]);

  async function handleStatusChange(superbillId: string, newStatus: string) {
    setUpdatingId(superbillId);
    try {
      await api.patch(`/api/superbills/${superbillId}/status`, {
        status: newStatus,
      });
      await loadSuperbills();
    } catch (err) {
      console.error("Failed to update status:", err);
      alert("Failed to update billing status.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleMarkPaid(superbillId: string, fee: number | null) {
    setUpdatingId(superbillId);
    try {
      await api.patch(`/api/superbills/${superbillId}/status`, {
        status: "paid",
        amount_paid: fee || 0,
      });
      await loadSuperbills();
    } catch (err) {
      console.error("Failed to mark as paid:", err);
      alert("Failed to mark as paid.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDownloadPdf(superbillId: string) {
    setDownloadingId(superbillId);
    try {
      const blob = await api.getBlob(`/api/superbills/${superbillId}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `superbill_${superbillId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download PDF:", err);
      alert("Failed to download superbill PDF.");
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleEmailSuperbill(superbillId: string) {
    setEmailingId(superbillId);
    try {
      await api.post(`/api/superbills/${superbillId}/email`, {});
      alert("Superbill emailed to client successfully.");
    } catch (err: any) {
      console.error("Failed to email superbill:", err);
      alert(err.message || "Failed to email superbill.");
    } finally {
      setEmailingId(null);
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-6xl">
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 py-8 max-w-6xl">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold text-warm-800">
          Billing
        </h1>
        <p className="text-sm text-warm-500 mt-1">
          Superbills and billing status for all sessions.
        </p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <SummaryCard
            label="Total Billed"
            value={formatCurrency(summary.total_billed)}
            color="text-warm-700"
          />
          <SummaryCard
            label="Total Paid"
            value={formatCurrency(summary.total_paid)}
            color="text-teal-700"
          />
          <SummaryCard
            label="Outstanding Balance"
            value={formatCurrency(summary.total_outstanding)}
            color={summary.total_outstanding > 0 ? "text-red-600" : "text-teal-700"}
          />
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-warm-100 shadow-sm">
        <div className="px-6 py-4 border-b border-warm-100 flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-warm-800">
            Superbills
          </h2>
          <div className="flex items-center gap-2">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  filter === opt.value
                    ? "bg-teal-50 text-teal-700"
                    : "text-warm-500 hover:text-warm-700 hover:bg-warm-50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {superbills.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs font-semibold text-warm-400 uppercase tracking-wide border-b border-warm-100">
                  <th className="px-6 py-3 text-left">Date</th>
                  <th className="px-6 py-3 text-left">Client</th>
                  <th className="px-6 py-3 text-left">Service</th>
                  <th className="px-6 py-3 text-left">Diagnoses</th>
                  <th className="px-6 py-3 text-right">Fee</th>
                  <th className="px-6 py-3 text-right">Paid</th>
                  <th className="px-6 py-3 text-center">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-100">
                {superbills.map((sb) => (
                  <tr key={sb.id} className="hover:bg-warm-50/50 transition-colors">
                    <td className="px-6 py-4 text-sm text-warm-700">
                      {formatDate(sb.date_of_service)}
                    </td>
                    <td className="px-6 py-4">
                      {sb.client_uuid ? (
                        <Link
                          to={`/clients/${sb.client_uuid}`}
                          className="text-sm font-medium text-teal-700 hover:text-teal-800 transition-colors"
                        >
                          {sb.client_name || "Unknown"}
                        </Link>
                      ) : (
                        <span className="text-sm text-warm-600">
                          {sb.client_name || "Unknown"}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-mono text-warm-600">
                        {sb.cpt_code}
                      </span>
                      <p className="text-xs text-warm-400">
                        {sb.cpt_description}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      {sb.diagnosis_codes && sb.diagnosis_codes.length > 0 ? (
                        <div className="space-y-0.5">
                          {sb.diagnosis_codes.slice(0, 2).map((dx, i) => (
                            <p key={i} className="text-xs">
                              <span className="font-mono text-warm-500">
                                {dx.code}
                              </span>
                            </p>
                          ))}
                          {sb.diagnosis_codes.length > 2 && (
                            <p className="text-xs text-warm-400">
                              +{sb.diagnosis_codes.length - 2} more
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-warm-300">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-right font-medium text-warm-700">
                      {formatCurrency(sb.fee)}
                    </td>
                    <td className="px-6 py-4 text-sm text-right text-warm-600">
                      {formatCurrency(sb.amount_paid)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_STYLES[sb.status] || ""
                        }`}
                      >
                        {STATUS_LABELS[sb.status] || sb.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* PDF Download */}
                        {sb.has_pdf && (
                          <button
                            onClick={() => handleDownloadPdf(sb.id)}
                            disabled={downloadingId === sb.id}
                            className="p-1.5 text-warm-400 hover:text-teal-600 transition-colors disabled:opacity-50"
                            title="Download PDF"
                          >
                            {downloadingId === sb.id ? (
                              <span className="w-4 h-4 block border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
                            ) : (
                              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                                <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                              </svg>
                            )}
                          </button>
                        )}

                        {/* Email */}
                        {sb.has_pdf && (
                          <button
                            onClick={() => handleEmailSuperbill(sb.id)}
                            disabled={emailingId === sb.id}
                            className="p-1.5 text-warm-400 hover:text-blue-600 transition-colors disabled:opacity-50"
                            title="Email to client"
                          >
                            {emailingId === sb.id ? (
                              <span className="w-4 h-4 block border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                            ) : (
                              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                <path d="M3 4a2 2 0 00-2 2v1.161l8.441 4.221a1.25 1.25 0 001.118 0L19 7.162V6a2 2 0 00-2-2H3z" />
                                <path d="M19 8.839l-7.77 3.885a2.75 2.75 0 01-2.46 0L1 8.839V14a2 2 0 002 2h14a2 2 0 002-2V8.839z" />
                              </svg>
                            )}
                          </button>
                        )}

                        {/* Status dropdown */}
                        <StatusDropdown
                          currentStatus={sb.status}
                          superbillId={sb.id}
                          fee={sb.fee}
                          updating={updatingId === sb.id}
                          onStatusChange={handleStatusChange}
                          onMarkPaid={handleMarkPaid}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-16 text-center">
            <div className="w-12 h-12 mx-auto mb-4 bg-warm-50 rounded-full flex items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="w-6 h-6 text-warm-300"
              >
                <path
                  d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="text-warm-500 text-sm">
              {filter === "all"
                ? "No superbills yet. Superbills are automatically generated when clinical notes are signed."
                : `No ${filter} superbills.`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-5">
      <p className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function StatusDropdown({
  currentStatus,
  superbillId,
  fee,
  updating,
  onStatusChange,
  onMarkPaid,
}: {
  currentStatus: string;
  superbillId: string;
  fee: number | null;
  updating: boolean;
  onStatusChange: (id: string, status: string) => void;
  onMarkPaid: (id: string, fee: number | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const options = [
    { value: "generated", label: "Generated" },
    { value: "submitted", label: "Submitted" },
    { value: "paid", label: "Paid" },
    { value: "outstanding", label: "Outstanding" },
  ].filter((o) => o.value !== currentStatus);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={updating}
        className="p-1.5 text-warm-400 hover:text-warm-600 transition-colors disabled:opacity-50"
        title="Change status"
      >
        {updating ? (
          <span className="w-4 h-4 block border-2 border-warm-200 border-t-warm-600 rounded-full animate-spin" />
        ) : (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM10 8.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM11.5 15.5a1.5 1.5 0 10-3 0 1.5 1.5 0 003 0z" />
          </svg>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg border border-warm-100 shadow-lg z-20 py-1">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setOpen(false);
                  if (opt.value === "paid") {
                    onMarkPaid(superbillId, fee);
                  } else {
                    onStatusChange(superbillId, opt.value);
                  }
                }}
                className="w-full px-3 py-2 text-left text-sm text-warm-600 hover:bg-warm-50 hover:text-warm-800 transition-colors"
              >
                Mark as {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
