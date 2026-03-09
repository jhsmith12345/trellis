import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";
import OutstandingBalances from "../components/billing/OutstandingBalances";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthWarning {
  id: string;
  client_id: string;
  payer_name: string;
  auth_number: string | null;
  authorized_sessions: number | null;
  sessions_used: number;
  start_date: string;
  end_date: string;
  status: string;
  client_name: string | null;
  client_uuid: string | null;
}

interface AuthWarningsResponse {
  expiring: AuthWarning[];
  low_sessions: AuthWarning[];
}

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
  date_submitted: string | null;
  date_paid: string | null;
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

interface AgingBucket {
  count: number;
  amount: number;
}

interface EnhancedSummary {
  aging: {
    current: AgingBucket;
    "31_60": AgingBucket;
    "61_90": AgingBucket;
    over_90: AgingBucket;
  };
  collections_current_month: number;
  collections_prev_month: number;
  avg_days_to_payment: number | null;
  claims_this_month: number;
}

interface FilingDeadlineWarning {
  superbill_id: string;
  client_name: string;
  client_id: string;
  date_of_service: string;
  filing_deadline: string;
  days_remaining: number;
  cpt_code: string;
  fee: number | null;
}

interface FilingDeadlinesResponse {
  at_risk: FilingDeadlineWarning[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "\u2014";
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

/**
 * Compute which A/R aging bucket a superbill falls into based on
 * date_submitted (or created_at as fallback).
 */
function getAgingBucket(sb: Superbill): { label: string; color: string } | null {
  if (sb.status !== "submitted" && sb.status !== "outstanding") return null;
  const ref = sb.date_submitted || sb.created_at;
  if (!ref) return null;
  const days = Math.floor(
    (Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (days <= 30) return { label: "0-30d", color: "bg-emerald-500" };
  if (days <= 60) return { label: "31-60d", color: "bg-amber-400" };
  if (days <= 90) return { label: "61-90d", color: "bg-orange-500" };
  return { label: "90+d", color: "bg-red-500" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BillingPage() {
  const api = useApi();
  const { cashOnly } = useAuth();
  const [superbills, setSuperbills] = useState<Superbill[]>([]);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [enhancedSummary, setEnhancedSummary] = useState<EnhancedSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [emailingId, setEmailingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingCmsId, setDownloadingCmsId] = useState<string | null>(null);
  const [downloadingEdiId, setDownloadingEdiId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloadingBatchEdi, setDownloadingBatchEdi] = useState(false);
  const [batchUpdating, setBatchUpdating] = useState(false);
  const [authWarnings, setAuthWarnings] = useState<AuthWarningsResponse | null>(null);
  const [filingDeadlines, setFilingDeadlines] = useState<FilingDeadlineWarning[]>([]);
  const [showStatementModal, setShowStatementModal] = useState(false);
  const [statementClientId, setStatementClientId] = useState("");
  const [statementFromDate, setStatementFromDate] = useState("");
  const [statementToDate, setStatementToDate] = useState("");
  const [generatingStatement, setGeneratingStatement] = useState(false);
  const [emailingStatement, setEmailingStatement] = useState(false);
  const [submittingClaimId, setSubmittingClaimId] = useState<string | null>(null);
  const [billingConnected, setBillingConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<"superbills" | "outstanding" | "denials">("superbills");
  const [denialCount, setDenialCount] = useState<number>(0);

  // Payment link modal state
  const [paymentLinkModal, setPaymentLinkModal] = useState<{
    superbillId: string;
    clientName: string;
    clientEmail: string | null;
    amount: number;
  } | null>(null);
  const [paymentLinkResult, setPaymentLinkResult] = useState<{
    url: string;
    amount: number;
    expires_at: string | null;
  } | null>(null);
  const [creatingPaymentLink, setCreatingPaymentLink] = useState(false);
  const [copiedPaymentLink, setCopiedPaymentLink] = useState(false);

  const loadSuperbills = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      if (fromDate) params.set("from_date", fromDate);
      if (toDate) params.set("to_date", toDate);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const [data, warnings, summaryData, deadlinesData, billingSettings] = await Promise.all([
        api.get<SuperbillsResponse>(`/api/superbills${qs}`),
        api.get<AuthWarningsResponse>("/api/authorizations/warnings").catch(() => null),
        api.get<EnhancedSummary>("/api/superbills/summary").catch(() => null),
        api.get<FilingDeadlinesResponse>("/api/superbills/filing-deadlines").catch(() => null),
        api.get<{ connected: boolean }>("/api/billing/settings").catch(() => null),
      ]);
      if (billingSettings) setBillingConnected(billingSettings.connected);
      // Fetch denial count if billing is connected
      if (billingSettings?.connected) {
        api.get<{ count: number }>("/api/billing/denials")
          .then((resp) => setDenialCount((resp as any).count ?? 0))
          .catch(() => setDenialCount(0));
      }
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
      if (warnings) setAuthWarnings(warnings);
      if (summaryData) setEnhancedSummary(summaryData);
      if (deadlinesData) setFilingDeadlines(deadlinesData.at_risk);
    } catch (err) {
      console.error("Failed to load superbills:", err);
    } finally {
      setLoading(false);
    }
  }, [api, filter, fromDate, toDate]);

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

  async function handleBatchStatusUpdate(newStatus: string) {
    if (selectedIds.size === 0) return;
    setBatchUpdating(true);
    try {
      await api.patch("/api/superbills/batch-status", {
        superbill_ids: Array.from(selectedIds),
        status: newStatus,
      });
      setSelectedIds(new Set());
      await loadSuperbills();
    } catch (err) {
      console.error("Failed to batch update status:", err);
      alert("Failed to update selected superbills.");
    } finally {
      setBatchUpdating(false);
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

  async function handleDownloadCms1500(superbillId: string) {
    setDownloadingCmsId(superbillId);
    try {
      const blob = await api.getBlob(`/api/superbills/${superbillId}/cms1500`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cms1500_${superbillId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download CMS-1500 PDF:", err);
      alert("Failed to download CMS-1500 PDF.");
    } finally {
      setDownloadingCmsId(null);
    }
  }

  async function handleDownloadEdi837(superbillId: string) {
    setDownloadingEdiId(superbillId);
    try {
      const blob = await api.getBlob(`/api/superbills/${superbillId}/edi837`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `837P_${superbillId.slice(0, 8)}.edi`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download 837P:", err);
      alert("Failed to download 837P EDI file.");
    } finally {
      setDownloadingEdiId(null);
    }
  }

  async function handleBatchEdi837() {
    if (selectedIds.size === 0) return;
    setDownloadingBatchEdi(true);
    try {
      const blob = await api.postBlob("/api/superbills/batch-edi837", {
        superbill_ids: Array.from(selectedIds),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `837P_batch_${new Date().toISOString().slice(0, 10)}.edi`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Failed to download batch 837P:", err);
      alert("Failed to download batch 837P EDI file.");
    } finally {
      setDownloadingBatchEdi(false);
    }
  }

  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === superbills.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(superbills.map((sb) => sb.id)));
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

  async function handleSubmitClaim(superbillId: string) {
    setSubmittingClaimId(superbillId);
    try {
      const result = await api.post<{ status: string; billing_claim_id?: string; warnings?: string[] }>(
        `/api/superbills/${superbillId}/submit`,
        {}
      );
      // Update local state
      setSuperbills((prev) =>
        prev.map((sb) =>
          sb.id === superbillId ? { ...sb, status: "submitted" as const, date_submitted: new Date().toISOString() } : sb
        )
      );
      if (result.warnings && result.warnings.length > 0) {
        alert(`Claim submitted with warnings:\n${result.warnings.join("\n")}`);
      }
    } catch (err: any) {
      console.error("Failed to submit claim:", err);
      alert(err.message || "Failed to submit claim to billing service.");
    } finally {
      setSubmittingClaimId(null);
    }
  }

  async function handleCreatePaymentLink(superbillId: string, patientEmail: string | null) {
    setCreatingPaymentLink(true);
    try {
      const result = await api.post<{
        payment_link_url: string;
        amount: number;
        expires_at: string | null;
        superbill_id: string;
      }>(`/api/superbills/${superbillId}/payment-link`, {
        patient_email: patientEmail,
      });
      setPaymentLinkResult({
        url: result.payment_link_url,
        amount: result.amount,
        expires_at: result.expires_at,
      });
    } catch (err: any) {
      console.error("Failed to create payment link:", err);
      alert(err.message || "Failed to create payment link.");
    } finally {
      setCreatingPaymentLink(false);
    }
  }

  async function handleCopyPaymentLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedPaymentLink(true);
      setTimeout(() => setCopiedPaymentLink(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedPaymentLink(true);
      setTimeout(() => setCopiedPaymentLink(false), 2000);
    }
  }

  /**
   * Compute patient responsibility for a superbill.
   * If fee > amount_paid, there is a patient balance.
   */
  function getPatientBalance(sb: Superbill): number {
    const fee = sb.fee ?? 0;
    const paid = sb.amount_paid ?? 0;
    return Math.max(0, fee - paid);
  }

  // Get unique clients from superbills for the statement modal dropdown
  const uniqueClients = Array.from(
    new Map(
      superbills
        .filter((sb) => sb.client_id)
        .map((sb) => [sb.client_id, { id: sb.client_id, name: sb.client_name || "Unknown", uuid: sb.client_uuid }])
    ).values()
  );

  async function handleGenerateStatement() {
    if (!statementClientId) return;
    setGeneratingStatement(true);
    try {
      const params = new URLSearchParams();
      if (statementFromDate) params.set("from_date", statementFromDate);
      if (statementToDate) params.set("to_date", statementToDate);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const blob = await api.postBlob(`/api/clients/${statementClientId}/statement${qs}`, {});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `statement_${statementClientId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowStatementModal(false);
    } catch (err) {
      console.error("Failed to generate statement:", err);
      alert("Failed to generate patient statement.");
    } finally {
      setGeneratingStatement(false);
    }
  }

  async function handleEmailStatement() {
    if (!statementClientId) return;
    setEmailingStatement(true);
    try {
      const params = new URLSearchParams();
      if (statementFromDate) params.set("from_date", statementFromDate);
      if (statementToDate) params.set("to_date", statementToDate);
      const qs = params.toString() ? `?${params.toString()}` : "";
      await api.post(`/api/clients/${statementClientId}/statement/email${qs}`, {});
      alert("Statement emailed to client successfully.");
      setShowStatementModal(false);
    } catch (err: any) {
      console.error("Failed to email statement:", err);
      alert(err.message || "Failed to email statement.");
    } finally {
      setEmailingStatement(false);
    }
  }

  // Build a lookup of superbill_id -> days_remaining for filing deadline badges
  const filingDeadlineMap = new Map<string, number>();
  for (const fd of filingDeadlines) {
    filingDeadlineMap.set(fd.superbill_id, fd.days_remaining);
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
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-warm-800">
            Billing
          </h1>
          <p className="text-sm text-warm-500 mt-1">
            Superbills and billing status for all sessions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/billing/reports"
            className="px-4 py-2 text-sm font-medium rounded-xl border border-warm-200 text-warm-600 hover:bg-warm-50 transition-colors flex items-center gap-2"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 001.5 1.5h1a1.5 1.5 0 001.5-1.5v-13A1.5 1.5 0 0016.5 2h-1zM9.5 6A1.5 1.5 0 008 7.5v9A1.5 1.5 0 009.5 18h1a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0010.5 6h-1zM3.5 10A1.5 1.5 0 002 11.5v5A1.5 1.5 0 003.5 18h1A1.5 1.5 0 006 16.5v-5A1.5 1.5 0 004.5 10h-1z" />
            </svg>
            Reports
          </Link>
          <button
            onClick={() => setShowStatementModal(true)}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-teal-600 text-white hover:bg-teal-700 transition-colors flex items-center gap-2"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z" clipRule="evenodd" />
            </svg>
            Generate Statement
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex items-center gap-1 border-b border-warm-100">
        <button
          onClick={() => setActiveTab("superbills")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "superbills"
              ? "border-teal-600 text-teal-700"
              : "border-transparent text-warm-500 hover:text-warm-700"
          }`}
        >
          Superbills
        </button>
        <button
          onClick={() => setActiveTab("outstanding")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "outstanding"
              ? "border-teal-600 text-teal-700"
              : "border-transparent text-warm-500 hover:text-warm-700"
          }`}
        >
          Outstanding Balances
        </button>
        {billingConnected && !cashOnly && (
          <Link
            to="/billing/denials"
            className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-warm-500 hover:text-warm-700 transition-colors flex items-center gap-1.5"
          >
            Denials
            {denialCount > 0 && (
              <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 min-w-[20px]">
                {denialCount}
              </span>
            )}
          </Link>
        )}
      </div>

      {/* Outstanding Balances Tab */}
      {activeTab === "outstanding" && (
        <OutstandingBalances billingConnected={billingConnected} />
      )}

      {/* Superbills Tab Content */}
      {activeTab === "superbills" && <>
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
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

      {/* Enhanced Summary Stats */}
      {enhancedSummary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <SummaryCard
            label="Claims This Month"
            value={String(enhancedSummary.claims_this_month)}
            color="text-warm-700"
          />
          <SummaryCard
            label="Collections This Month"
            value={formatCurrency(enhancedSummary.collections_current_month)}
            color="text-teal-700"
            subtitle={`Last month: ${formatCurrency(enhancedSummary.collections_prev_month)}`}
          />
          <SummaryCard
            label="Avg Days to Payment"
            value={enhancedSummary.avg_days_to_payment !== null ? `${enhancedSummary.avg_days_to_payment}` : "N/A"}
            color="text-warm-700"
          />
        </div>
      )}

      {/* A/R Aging Buckets */}
      {enhancedSummary && (
        <div className="mb-6">
          <h2 className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-3">
            Accounts Receivable Aging
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <AgingCard
              label="Current (0-30 days)"
              count={enhancedSummary.aging.current.count}
              amount={enhancedSummary.aging.current.amount}
              bgColor="bg-emerald-50"
              borderColor="border-emerald-200"
              textColor="text-emerald-700"
              dotColor="bg-emerald-500"
            />
            <AgingCard
              label="31-60 days"
              count={enhancedSummary.aging["31_60"].count}
              amount={enhancedSummary.aging["31_60"].amount}
              bgColor="bg-amber-50"
              borderColor="border-amber-200"
              textColor="text-amber-700"
              dotColor="bg-amber-400"
            />
            <AgingCard
              label="61-90 days"
              count={enhancedSummary.aging["61_90"].count}
              amount={enhancedSummary.aging["61_90"].amount}
              bgColor="bg-orange-50"
              borderColor="border-orange-200"
              textColor="text-orange-700"
              dotColor="bg-orange-500"
            />
            <AgingCard
              label="90+ days"
              count={enhancedSummary.aging.over_90.count}
              amount={enhancedSummary.aging.over_90.amount}
              bgColor="bg-red-50"
              borderColor="border-red-200"
              textColor="text-red-700"
              dotColor="bg-red-500"
            />
          </div>
        </div>
      )}

      {/* Authorization Warnings — hidden for cash-only */}
      {!cashOnly && authWarnings && (authWarnings.expiring.length > 0 || authWarnings.low_sessions.length > 0) && (
        <div className="mb-6 space-y-3">
          {authWarnings.low_sessions.map((w) => (
            <div
              key={`low-${w.id}`}
              className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-amber-500 shrink-0">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-amber-800">
                  <span className="font-semibold">{w.client_name || "Client"}</span>
                  {" has "}
                  <span className="font-semibold">{w.authorized_sessions! - w.sessions_used}</span>
                  {" session(s) remaining"}
                  {w.auth_number && <> on auth <span className="font-mono">#{w.auth_number}</span></>}
                  {" ("}{w.payer_name}{")"}
                </p>
              </div>
              {w.client_uuid && (
                <Link
                  to={`/clients/${w.client_uuid}`}
                  className="text-xs font-medium text-amber-700 hover:text-amber-800 whitespace-nowrap"
                >
                  View Client
                </Link>
              )}
            </div>
          ))}
          {authWarnings.expiring.map((w) => {
            const daysLeft = Math.ceil(
              (new Date(w.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            );
            return (
              <div
                key={`exp-${w.id}`}
                className="flex items-center gap-3 px-4 py-3 bg-orange-50 border border-orange-200 rounded-xl"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-orange-500 shrink-0">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-orange-800">
                    <span className="font-semibold">{w.client_name || "Client"}</span>
                    {"'s authorization"}
                    {w.auth_number && <> <span className="font-mono">#{w.auth_number}</span></>}
                    {" expires in "}
                    <span className="font-semibold">{daysLeft} day(s)</span>
                    {" ("}{w.payer_name}{")"}
                  </p>
                </div>
                {w.client_uuid && (
                  <Link
                    to={`/clients/${w.client_uuid}`}
                    className="text-xs font-medium text-orange-700 hover:text-orange-800 whitespace-nowrap"
                  >
                    View Client
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Filing Deadline Warnings — hidden for cash-only */}
      {!cashOnly && filingDeadlines.length > 0 && (
        <div className="mb-6 space-y-2">
          <h2 className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-2">
            Filing Deadline Alerts
          </h2>
          {filingDeadlines.map((fd) => {
            const isUrgent = fd.days_remaining <= 14;
            const isOverdue = fd.days_remaining < 0;
            const bgColor = isUrgent ? "bg-red-50" : "bg-amber-50";
            const borderColor = isUrgent ? "border-red-200" : "border-amber-200";
            const iconColor = isUrgent ? "text-red-500" : "text-amber-500";
            const textColor = isUrgent ? "text-red-800" : "text-amber-800";
            const linkColor = isUrgent
              ? "text-red-700 hover:text-red-800"
              : "text-amber-700 hover:text-amber-800";

            return (
              <div
                key={fd.superbill_id}
                className={`flex items-center gap-3 px-4 py-3 ${bgColor} border ${borderColor} rounded-xl`}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className={`w-5 h-5 ${iconColor} shrink-0`}>
                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${textColor}`}>
                    {isOverdue ? (
                      <>
                        <span className="font-semibold">OVERDUE:</span>{" "}
                        Claim for <span className="font-semibold">{fd.client_name || "Client"}</span>{" "}
                        on {formatDate(fd.date_of_service)} — filing deadline passed{" "}
                        <span className="font-semibold">{Math.abs(fd.days_remaining)} day(s)</span> ago
                      </>
                    ) : isUrgent ? (
                      <>
                        <span className="font-semibold">URGENT:</span>{" "}
                        Claim for <span className="font-semibold">{fd.client_name || "Client"}</span>{" "}
                        on {formatDate(fd.date_of_service)} — filing deadline in{" "}
                        <span className="font-semibold">{fd.days_remaining} day(s)</span>
                      </>
                    ) : (
                      <>
                        Claim for <span className="font-semibold">{fd.client_name || "Client"}</span>{" "}
                        on {formatDate(fd.date_of_service)} — filing deadline in{" "}
                        <span className="font-semibold">{fd.days_remaining} day(s)</span>
                      </>
                    )}
                  </p>
                </div>
                <Link
                  to={`/billing/claims/${fd.superbill_id}/review`}
                  className={`text-xs font-medium ${linkColor} whitespace-nowrap`}
                >
                  Review Claim
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-warm-100 shadow-sm">
        <div className="px-6 py-4 border-b border-warm-100 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-warm-800">
              Superbills
            </h2>
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <>
                  <button
                    onClick={() => handleBatchStatusUpdate("submitted")}
                    disabled={batchUpdating}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {batchUpdating ? (
                      <span className="w-3 h-3 block border-2 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
                    ) : (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                      </svg>
                    )}
                    Mark as Submitted ({selectedIds.size})
                  </button>
                  <button
                    onClick={handleBatchEdi837}
                    disabled={downloadingBatchEdi}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {downloadingBatchEdi ? (
                      <span className="w-3 h-3 block border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
                    ) : (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                        <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                      </svg>
                    )}
                    Download 837P Batch ({selectedIds.size})
                  </button>
                </>
              )}
              <div className="h-4 w-px bg-warm-200" />
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
          {/* Date Range Filter */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-warm-500">Date range:</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-2.5 py-1.5 border border-warm-200 rounded-lg text-xs text-warm-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              placeholder="From"
            />
            <span className="text-xs text-warm-400">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-2.5 py-1.5 border border-warm-200 rounded-lg text-xs text-warm-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              placeholder="To"
            />
            {(fromDate || toDate) && (
              <button
                onClick={() => {
                  setFromDate("");
                  setToDate("");
                }}
                className="text-xs text-warm-400 hover:text-warm-600 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        {superbills.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs font-semibold text-warm-400 uppercase tracking-wide border-b border-warm-100">
                  <th className="px-3 py-3 text-center w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === superbills.length && superbills.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-warm-300 text-teal-600 focus:ring-teal-500"
                    />
                  </th>
                  <th className="px-6 py-3 text-left">Date</th>
                  <th className="px-6 py-3 text-left">Client</th>
                  <th className="px-6 py-3 text-left">Service</th>
                  <th className="px-6 py-3 text-left">Diagnoses</th>
                  <th className="px-6 py-3 text-right">Fee</th>
                  <th className="px-6 py-3 text-right">Ins. Paid</th>
                  <th className="px-5 py-3 text-right">Patient Owes</th>
                  <th className="px-4 py-3 text-center">Submitted</th>
                  <th className="px-4 py-3 text-center">Paid Date</th>
                  <th className="px-6 py-3 text-center">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-100">
                {superbills.map((sb) => {
                  const aging = getAgingBucket(sb);
                  return (
                    <tr key={sb.id} className="hover:bg-warm-50/50 transition-colors">
                      <td className="px-3 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(sb.id)}
                          onChange={() => toggleSelection(sb.id)}
                          className="rounded border-warm-300 text-teal-600 focus:ring-teal-500"
                        />
                      </td>
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
                        {sb.amount_paid > 0 ? (
                          <span className="text-teal-700 font-medium">
                            {formatCurrency(sb.amount_paid)}
                          </span>
                        ) : (
                          formatCurrency(sb.amount_paid)
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm text-right">
                        {sb.status === "paid" || sb.status === "outstanding" ? (
                          sb.fee !== null && sb.fee - sb.amount_paid > 0 ? (
                            <span className="text-blue-700 font-medium">
                              {formatCurrency(sb.fee - sb.amount_paid)}
                            </span>
                          ) : (
                            <span className="text-warm-400">{formatCurrency(0)}</span>
                          )
                        ) : (
                          <span className="text-warm-300">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-xs text-center text-warm-500">
                        {formatDate(sb.date_submitted)}
                      </td>
                      <td className="px-4 py-4 text-xs text-center text-warm-500">
                        {formatDate(sb.date_paid)}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {aging && (
                            <span
                              className={`w-2 h-2 rounded-full ${aging.color}`}
                              title={`A/R aging: ${aging.label}`}
                            />
                          )}
                          <span
                            className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              STATUS_STYLES[sb.status] || ""
                            }`}
                          >
                            {STATUS_LABELS[sb.status] || sb.status}
                          </span>
                          {sb.status === "generated" && filingDeadlineMap.has(sb.id) && (() => {
                            const daysLeft = filingDeadlineMap.get(sb.id)!;
                            const isUrgent = daysLeft <= 14;
                            return (
                              <span
                                className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                                  isUrgent
                                    ? "bg-red-100 text-red-700"
                                    : "bg-amber-100 text-amber-700"
                                }`}
                                title={`Filing deadline: ${daysLeft <= 0 ? "overdue" : `${daysLeft}d remaining`}`}
                              >
                                {daysLeft <= 0 ? `${Math.abs(daysLeft)}d over` : `${daysLeft}d`}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Review */}
                          <Link
                            to={`/billing/claims/${sb.id}/review`}
                            className="p-1.5 text-warm-400 hover:text-teal-600 transition-colors"
                            title="Review claim"
                          >
                            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                              <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                              <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                            </svg>
                          </Link>

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

                          {/* CMS-1500 Download — insurance only */}
                          {!cashOnly && sb.has_pdf && (
                            <button
                              onClick={() => handleDownloadCms1500(sb.id)}
                              disabled={downloadingCmsId === sb.id}
                              className="p-1.5 text-warm-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
                              title="Download CMS-1500"
                            >
                              {downloadingCmsId === sb.id ? (
                                <span className="w-4 h-4 block border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                              ) : (
                                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                  <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zM10 8a.75.75 0 01.75.75v1.5h1.5a.75.75 0 010 1.5h-1.5v1.5a.75.75 0 01-1.5 0v-1.5h-1.5a.75.75 0 010-1.5h1.5v-1.5A.75.75 0 0110 8z" clipRule="evenodd" />
                                </svg>
                              )}
                            </button>
                          )}

                          {/* 837P EDI Download — insurance only */}
                          {!cashOnly && (
                            <button
                              onClick={() => handleDownloadEdi837(sb.id)}
                              disabled={downloadingEdiId === sb.id}
                              className="p-1.5 text-warm-400 hover:text-purple-600 transition-colors disabled:opacity-50"
                              title="Download 837P EDI"
                            >
                              {downloadingEdiId === sb.id ? (
                                <span className="w-4 h-4 block border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
                              ) : (
                                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                  <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm4.75 6.25a.75.75 0 01.75.75v2.19l.72-.72a.75.75 0 111.06 1.06l-2 2a.75.75 0 01-1.06 0l-2-2a.75.75 0 011.06-1.06l.72.72V9a.75.75 0 01.75-.75z" clipRule="evenodd" />
                                </svg>
                              )}
                            </button>
                          )}

                          {/* Submit Claim (billing service) — insurance only */}
                          {!cashOnly && billingConnected && sb.status === "generated" && (
                            <button
                              onClick={() => handleSubmitClaim(sb.id)}
                              disabled={submittingClaimId === sb.id}
                              className="p-1.5 text-warm-400 hover:text-green-600 transition-colors disabled:opacity-50"
                              title="Submit claim to billing service"
                            >
                              {submittingClaimId === sb.id ? (
                                <span className="w-4 h-4 block border-2 border-green-200 border-t-green-600 rounded-full animate-spin" />
                              ) : (
                                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
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

                          {/* Payment Link */}
                          {billingConnected && getPatientBalance(sb) > 0 && (
                            <button
                              onClick={() =>
                                setPaymentLinkModal({
                                  superbillId: sb.id,
                                  clientName: sb.client_name || "Patient",
                                  clientEmail: null,
                                  amount: getPatientBalance(sb),
                                })
                              }
                              className="p-1.5 text-warm-400 hover:text-orange-600 transition-colors"
                              title="Send payment link"
                            >
                              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                <path d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 001.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" />
                              </svg>
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
                  );
                })}
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

      </>}

      {/* Payment Link Modal */}
      {paymentLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setPaymentLinkModal(null);
              setPaymentLinkResult(null);
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 mx-4">
            <h3 className="font-display text-lg font-bold text-warm-800 mb-1">
              Send Payment Link
            </h3>
            <p className="text-sm text-warm-500 mb-4">
              Generate a Stripe payment link for {paymentLinkModal.clientName || "this patient"}.
            </p>

            {!paymentLinkResult ? (
              <div className="space-y-4">
                <div className="bg-warm-50 rounded-xl p-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-warm-600">Patient Responsibility</span>
                    <span className="text-lg font-bold text-red-600">
                      {formatCurrency(paymentLinkModal.amount)}
                    </span>
                  </div>
                </div>

                {paymentLinkModal.clientEmail && (
                  <div>
                    <label className="block text-sm font-medium text-warm-700 mb-1">
                      Patient Email
                    </label>
                    <p className="text-sm text-warm-600 bg-warm-50 rounded-lg px-3 py-2">
                      {paymentLinkModal.clientEmail}
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={() => {
                      setPaymentLinkModal(null);
                      setPaymentLinkResult(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-warm-600 hover:text-warm-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() =>
                      handleCreatePaymentLink(
                        paymentLinkModal.superbillId,
                        paymentLinkModal.clientEmail
                      )
                    }
                    disabled={creatingPaymentLink}
                    className="px-4 py-2 text-sm font-medium rounded-xl bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {creatingPaymentLink ? (
                      <span className="w-3.5 h-3.5 block border-2 border-teal-200 border-t-white rounded-full animate-spin" />
                    ) : (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 001.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" />
                      </svg>
                    )}
                    Generate Payment Link
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
                  <p className="text-sm text-teal-800 font-medium mb-2">
                    Payment link generated!
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={paymentLinkResult.url}
                      className="flex-1 px-3 py-2 text-xs bg-white border border-teal-200 rounded-lg text-warm-600 truncate"
                    />
                    <button
                      onClick={() => handleCopyPaymentLink(paymentLinkResult.url)}
                      className="px-3 py-2 text-xs font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors whitespace-nowrap"
                    >
                      {copiedPaymentLink ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p className="text-xs text-teal-600 mt-2">
                    Amount: {formatCurrency(paymentLinkResult.amount)}
                    {paymentLinkResult.expires_at && (
                      <> &middot; Expires: {formatDate(paymentLinkResult.expires_at)}</>
                    )}
                  </p>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setPaymentLinkModal(null);
                      setPaymentLinkResult(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-warm-600 hover:text-warm-800 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Statement Generation Modal */}
      {showStatementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowStatementModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 mx-4">
            <h3 className="font-display text-lg font-bold text-warm-800 mb-1">
              Generate Patient Statement
            </h3>
            <p className="text-sm text-warm-500 mb-6">
              Select a client and optional date range to generate a statement.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">
                  Client
                </label>
                <select
                  value={statementClientId}
                  onChange={(e) => setStatementClientId(e.target.value)}
                  className="w-full px-3 py-2 border border-warm-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                >
                  <option value="">Select a client...</option>
                  {uniqueClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">
                    From Date
                  </label>
                  <input
                    type="date"
                    value={statementFromDate}
                    onChange={(e) => setStatementFromDate(e.target.value)}
                    className="w-full px-3 py-2 border border-warm-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">
                    To Date
                  </label>
                  <input
                    type="date"
                    value={statementToDate}
                    onChange={(e) => setStatementToDate(e.target.value)}
                    className="w-full px-3 py-2 border border-warm-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  />
                </div>
              </div>

              <p className="text-xs text-warm-400">
                Leave dates blank to include all services.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-warm-100">
              <button
                onClick={() => setShowStatementModal(false)}
                className="px-4 py-2 text-sm font-medium text-warm-600 hover:text-warm-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEmailStatement}
                disabled={!statementClientId || emailingStatement}
                className="px-4 py-2 text-sm font-medium rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {emailingStatement ? (
                  <span className="w-3.5 h-3.5 block border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                ) : (
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                    <path d="M3 4a2 2 0 00-2 2v1.161l8.441 4.221a1.25 1.25 0 001.118 0L19 7.162V6a2 2 0 00-2-2H3z" />
                    <path d="M19 8.839l-7.77 3.885a2.75 2.75 0 01-2.46 0L1 8.839V14a2 2 0 002 2h14a2 2 0 002-2V8.839z" />
                  </svg>
                )}
                Email to Client
              </button>
              <button
                onClick={handleGenerateStatement}
                disabled={!statementClientId || generatingStatement}
                className="px-4 py-2 text-sm font-medium rounded-xl bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {generatingStatement ? (
                  <span className="w-3.5 h-3.5 block border-2 border-teal-200 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                    <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                    <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                  </svg>
                )}
                Download PDF
              </button>
            </div>
          </div>
        </div>
      )}
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
  subtitle,
}: {
  label: string;
  value: string;
  color: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-5">
      <p className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {subtitle && (
        <p className="text-xs text-warm-400 mt-1">{subtitle}</p>
      )}
    </div>
  );
}

function AgingCard({
  label,
  count,
  amount,
  bgColor,
  borderColor,
  textColor,
  dotColor,
}: {
  label: string;
  count: number;
  amount: number;
  bgColor: string;
  borderColor: string;
  textColor: string;
  dotColor: string;
}) {
  return (
    <div className={`${bgColor} border ${borderColor} rounded-xl px-4 py-3`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <p className={`text-xs font-medium ${textColor}`}>{label}</p>
      </div>
      <p className={`text-lg font-bold ${textColor}`}>
        ${amount.toFixed(2)}
      </p>
      <p className="text-xs text-warm-500">
        {count} claim{count !== 1 ? "s" : ""}
      </p>
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
