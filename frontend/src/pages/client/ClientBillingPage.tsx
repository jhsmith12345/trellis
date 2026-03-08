import { useState, useEffect } from "react";
import { useApi } from "../../hooks/useApi";

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
  created_at: string;
  updated_at: string;
}

interface ClientBalance {
  total_billed: number;
  total_paid: number;
  outstanding: number;
}

interface SuperbillsResponse {
  superbills: Superbill[];
  count: number;
  client_balance: ClientBalance;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-US", {
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

const CPT_LABELS: Record<string, string> = {
  "90791": "Assessment",
  "90834": "Individual (45 min)",
  "90837": "Individual (60 min)",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClientBillingPage() {
  const api = useApi();

  const [superbills, setSuperbills] = useState<Superbill[]>([]);
  const [balance, setBalance] = useState<ClientBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const data = await api.get<SuperbillsResponse>("/api/superbills/my");
        setSuperbills(
          (data.superbills || []).map((sb) => ({
            ...sb,
            diagnosis_codes:
              typeof sb.diagnosis_codes === "string"
                ? JSON.parse(sb.diagnosis_codes)
                : sb.diagnosis_codes || [],
          }))
        );
        setBalance(data.client_balance || null);
      } catch (err: any) {
        console.error("Failed to load superbills:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api]);

  async function handleDownload(superbillId: string) {
    setDownloading(superbillId);
    try {
      const blob = await api.getBlob(`/api/superbills/my/${superbillId}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `superbill_${superbillId.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDownloading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-3xl mx-auto">
      <h1 className="font-display text-2xl md:text-3xl font-bold text-warm-800 mb-2">
        Billing
      </h1>
      <p className="text-warm-500 mb-6">
        View and download your superbills for insurance reimbursement.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* Balance summary */}
      {balance && superbills.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-warm-200 p-4 text-center">
            <p className="text-xl md:text-2xl font-bold text-warm-800">
              {formatCurrency(balance.total_billed)}
            </p>
            <p className="text-xs text-warm-500 mt-0.5">Total Billed</p>
          </div>
          <div className="bg-white rounded-xl border border-warm-200 p-4 text-center">
            <p className="text-xl md:text-2xl font-bold text-teal-600">
              {formatCurrency(balance.total_paid)}
            </p>
            <p className="text-xs text-warm-500 mt-0.5">Paid</p>
          </div>
          <div className="bg-white rounded-xl border border-warm-200 p-4 text-center">
            <p
              className={`text-xl md:text-2xl font-bold ${
                balance.outstanding > 0 ? "text-amber-600" : "text-warm-400"
              }`}
            >
              {formatCurrency(balance.outstanding)}
            </p>
            <p className="text-xs text-warm-500 mt-0.5">Outstanding</p>
          </div>
        </div>
      )}

      {/* Superbill list */}
      {superbills.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-warm-200">
          <svg viewBox="0 0 24 24" fill="none" className="w-12 h-12 mx-auto text-warm-300 mb-4">
            <path
              d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <h3 className="text-lg font-semibold text-warm-700 mb-1">No Superbills Yet</h3>
          <p className="text-warm-400 text-sm max-w-xs mx-auto">
            Superbills will appear here after your clinician completes and signs your session notes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {superbills.map((sb) => (
            <div
              key={sb.id}
              className="bg-white rounded-xl border border-warm-200 p-4 md:p-5 hover:shadow-sm transition-shadow"
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        STATUS_STYLES[sb.status] || ""
                      }`}
                    >
                      {STATUS_LABELS[sb.status] || sb.status}
                    </span>
                    <span className="text-xs text-warm-400">
                      {CPT_LABELS[sb.cpt_code] || sb.cpt_description || sb.cpt_code}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-warm-800">
                    {formatDate(sb.date_of_service)}
                  </p>
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-sm text-warm-500">
                      Fee: {formatCurrency(sb.fee)}
                    </span>
                    {sb.amount_paid > 0 && (
                      <span className="text-sm text-teal-600">
                        Paid: {formatCurrency(sb.amount_paid)}
                      </span>
                    )}
                  </div>
                  {sb.diagnosis_codes && sb.diagnosis_codes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {sb.diagnosis_codes.map((dx, i) => (
                        <span
                          key={i}
                          className="text-[11px] px-1.5 py-0.5 rounded bg-warm-100 text-warm-600"
                          title={dx.description}
                        >
                          {dx.code}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {sb.has_pdf && (
                  <button
                    onClick={() => handleDownload(sb.id)}
                    disabled={downloading === sb.id}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-warm-300 text-warm-600 text-sm font-medium rounded-lg hover:bg-warm-50 transition-colors disabled:opacity-50 shrink-0 active:bg-warm-100"
                  >
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
                      <path
                        d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {downloading === sb.id ? "..." : "Download PDF"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Help text */}
      {superbills.length > 0 && (
        <div className="mt-6 bg-warm-50 rounded-xl p-4 border border-warm-100">
          <p className="text-sm text-warm-600">
            <strong>About superbills:</strong> A superbill is a receipt for services that you can
            submit to your insurance company for out-of-network reimbursement. Download the PDF and
            submit it through your insurance provider's portal or by mail.
          </p>
        </div>
      )}
    </div>
  );
}
