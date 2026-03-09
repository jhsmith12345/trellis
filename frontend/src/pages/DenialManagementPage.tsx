import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DenialCategory {
  category: string;
  label: string;
  description: string;
  is_appealable: boolean;
  typical_resolution: string;
  matched_codes: string[];
}

interface DenialCode {
  reason_code: string;
  description: string;
  group_code: string;
}

interface DenialSuggestion {
  action: string;
  description: string;
  auto_fixable: boolean;
  priority: string;
}

interface DenialListItem {
  claim_id: string;
  external_superbill_id: string;
  payer_name: string;
  payer_id: string;
  total_charge: number;
  total_paid: number;
  denial_category: DenialCategory | null;
  denial_codes: DenialCode[];
  suggestions: DenialSuggestion[];
  days_since_denial: number;
  can_auto_resubmit: boolean;
  resubmission_count: number;
  denied_at: string | null;
  created_at: string;
  // Enriched fields from client join
  client_name?: string;
  cpt_code?: string;
  date_of_service?: string;
}

interface DenialListResponse {
  denials: DenialListItem[];
  count: number;
  total_denied_amount: number;
}

interface DenialDetail {
  claim_id: string;
  external_superbill_id: string;
  payer_name: string;
  payer_id: string;
  total_charge: number;
  total_paid: number;
  patient_responsibility: number;
  status: string;
  denial_category: DenialCategory | null;
  denial_codes: DenialCode[];
  suggestions: DenialSuggestion[];
  can_auto_resubmit: boolean;
  resubmission_count: number;
  original_claim_id: string | null;
  related_claims: { claim_id: string; status: string; created_at: string; resubmission_count: number }[];
  status_history: { status: string; timestamp: string; details?: string }[];
  denied_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ResubmitResponse {
  new_claim_id: string;
  status: string;
  stedi_claim_id: string | null;
  warnings: string[];
  errors: { message: string }[];
}

interface DenialCategoryAnalytic {
  category: string;
  label: string;
  count: number;
  percentage: number;
}

interface DenialPayerAnalytic {
  payer_name: string;
  count: number;
  percentage: number;
}

interface DenialCodeAnalytic {
  reason_code: string;
  description: string;
  count: number;
}

interface DenialTrendPoint {
  month: string;
  count: number;
}

interface DenialAnalytics {
  total_claims: number;
  total_denied: number;
  denial_rate: number;
  total_denied_amount: number;
  average_days_to_resolve: number | null;
  by_category: DenialCategoryAnalytic[];
  by_payer: DenialPayerAnalytic[];
  top_reason_codes: DenialCodeAnalytic[];
  trend: DenialTrendPoint[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  missing_info:            { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    dot: "bg-blue-500" },
  auth_required:           { bg: "bg-purple-50",  text: "text-purple-700",  border: "border-purple-200",  dot: "bg-purple-500" },
  medical_necessity:       { bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-200",  dot: "bg-orange-500" },
  timely_filing:           { bg: "bg-red-50",     text: "text-red-700",     border: "border-red-200",     dot: "bg-red-500" },
  duplicate:               { bg: "bg-gray-50",    text: "text-gray-700",    border: "border-gray-200",    dot: "bg-gray-500" },
  non_covered:             { bg: "bg-red-50",     text: "text-red-700",     border: "border-red-200",     dot: "bg-red-500" },
  coordination_of_benefits:{ bg: "bg-yellow-50",  text: "text-yellow-700",  border: "border-yellow-200",  dot: "bg-yellow-500" },
  eligibility:             { bg: "bg-indigo-50",  text: "text-indigo-700",  border: "border-indigo-200",  dot: "bg-indigo-500" },
  other:                   { bg: "bg-gray-50",    text: "text-gray-600",    border: "border-gray-200",    dot: "bg-gray-400" },
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-600",
  medium: "text-amber-600",
  low: "text-gray-500",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCategoryColor(category: string): { bg: string; text: string; border: string; dot: string } {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other!;
}

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DenialManagementPage() {
  const api = useApi();

  // Data state
  const [denials, setDenials] = useState<DenialListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalDeniedAmount, setTotalDeniedAmount] = useState(0);
  const [analytics, setAnalytics] = useState<DenialAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // Filter state
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [payerFilter, setPayerFilter] = useState<string>("");

  // Detail panel state
  const [selectedDenial, setSelectedDenial] = useState<DenialDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  // Resubmit state
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitResult, setResubmitResult] = useState<ResubmitResponse | null>(null);

  // UI state
  const [showAnalytics, setShowAnalytics] = useState(false);

  // ------ Data loading ------

  const loadDenials = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (categoryFilter) params.set("category", categoryFilter);
      if (payerFilter) params.set("payer", payerFilter);
      const qs = params.toString();
      const resp = await api.get<DenialListResponse>(
        `/api/billing/denials${qs ? `?${qs}` : ""}`
      );
      setDenials(resp.denials);
      setTotalCount(resp.count);
      setTotalDeniedAmount(resp.total_denied_amount);
    } catch (err) {
      console.error("Failed to load denials:", err);
    } finally {
      setLoading(false);
    }
  }, [api, categoryFilter, payerFilter]);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const resp = await api.get<DenialAnalytics>("/api/billing/denials/analytics");
      setAnalytics(resp);
    } catch (err) {
      console.error("Failed to load denial analytics:", err);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadDenials();
  }, [loadDenials]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  async function openDetail(claimId: string) {
    setShowDetail(true);
    setDetailLoading(true);
    setResubmitResult(null);
    setCorrections({});
    try {
      const resp = await api.get<DenialDetail>(`/api/billing/denials/${claimId}`);
      setSelectedDenial(resp);
    } catch (err) {
      console.error("Failed to load denial detail:", err);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setShowDetail(false);
    setSelectedDenial(null);
    setResubmitResult(null);
    setCorrections({});
  }

  async function handleResubmit() {
    if (!selectedDenial) return;
    setResubmitting(true);
    setResubmitResult(null);
    try {
      const resp = await api.post<ResubmitResponse>(
        `/api/billing/denials/${selectedDenial.claim_id}/resubmit`,
        { corrections }
      );
      setResubmitResult(resp);
      // Refresh the list
      loadDenials();
      loadAnalytics();
    } catch (err: any) {
      console.error("Failed to resubmit:", err);
      setResubmitResult({
        new_claim_id: "",
        status: "error",
        stedi_claim_id: null,
        warnings: [],
        errors: [{ message: err.message || "Failed to resubmit claim" }],
      });
    } finally {
      setResubmitting(false);
    }
  }

  function applySuggestionFix(suggestion: DenialSuggestion) {
    // For auto-fixable suggestions, pre-populate the corrections
    // based on the action type
    if (suggestion.action === "resubmit_with_auth" && selectedDenial) {
      setCorrections((prev) => ({
        ...prev,
        authorization_number: "(enter auth number)",
      }));
    } else if (suggestion.action === "resubmit_as_replacement") {
      setCorrections((prev) => ({
        ...prev,
        _resubmission_type: "replacement",
      }));
    }
  }

  // Compute category counts from denials for the summary bar
  const categoryCounts: Record<string, number> = {};
  for (const d of denials) {
    const cat = d.denial_category?.category || "other";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  // Compute unique payer names for dropdown
  const payerNames = Array.from(new Set(denials.map((d) => d.payer_name).filter(Boolean))).sort();

  // Sort denials by days_since_denial (oldest first)
  const sortedDenials = [...denials].sort((a, b) => b.days_since_denial - a.days_since_denial);

  return (
    <div className="px-8 py-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link
              to="/billing"
              className="text-warm-400 hover:text-warm-600 transition-colors"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path
                  fillRule="evenodd"
                  d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                  clipRule="evenodd"
                />
              </svg>
            </Link>
            <h1 className="font-display text-2xl font-bold text-warm-800">
              Denial Management
            </h1>
            {totalCount > 0 && (
              <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                {totalCount}
              </span>
            )}
          </div>
          <p className="text-sm text-warm-500">
            Review denied claims, apply corrections, and resubmit
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAnalytics(!showAnalytics)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              showAnalytics
                ? "bg-teal-600 text-white hover:bg-teal-700"
                : "bg-warm-100 text-warm-700 hover:bg-warm-200"
            }`}
          >
            {showAnalytics ? "Hide Analytics" : "Show Analytics"}
          </button>
          <button
            onClick={() => { loadDenials(); loadAnalytics(); }}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-warm-100 text-warm-700 hover:bg-warm-200 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Summary Bar */}
      <div className="bg-white rounded-xl border border-warm-100 shadow-sm p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-xs text-warm-500 uppercase tracking-wide">Total Denied</p>
              <p className="text-2xl font-bold text-warm-800">{totalCount}</p>
            </div>
            <div>
              <p className="text-xs text-warm-500 uppercase tracking-wide">Denied Amount</p>
              <p className="text-2xl font-bold text-red-600">{formatCurrency(totalDeniedAmount)}</p>
            </div>
          </div>

          {/* Payer filter */}
          <div className="flex items-center gap-2">
            <select
              value={payerFilter}
              onChange={(e) => setPayerFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
            >
              <option value="">All Payers</option>
              {payerNames.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Category badges */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCategoryFilter(null)}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              categoryFilter === null
                ? "bg-warm-800 text-white border-warm-800"
                : "bg-warm-50 text-warm-600 border-warm-200 hover:bg-warm-100"
            }`}
          >
            All ({totalCount})
          </button>
          {Object.entries(categoryCounts).map(([cat, count]) => {
            const colors = getCategoryColor(cat);
            const isActive = categoryFilter === cat;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(isActive ? null : cat)}
                className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                  isActive
                    ? `${colors.bg} ${colors.text} ${colors.border} ring-2 ring-offset-1 ring-current`
                    : `${colors.bg} ${colors.text} ${colors.border} hover:opacity-80`
                }`}
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${colors.dot} mr-1.5`} />
                {CATEGORY_COLORS[cat] ? cat.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) : cat} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Analytics Section */}
      {showAnalytics && (
        <AnalyticsSection analytics={analytics} loading={analyticsLoading} />
      )}

      {/* Denied Claims Table */}
      <div className="bg-white rounded-xl border border-warm-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
          </div>
        ) : sortedDenials.length === 0 ? (
          <div className="py-16 text-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-12 h-12 mx-auto text-warm-300 mb-3">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-warm-500 font-medium">No denied claims</p>
            <p className="text-sm text-warm-400 mt-1">
              {categoryFilter || payerFilter
                ? "Try adjusting your filters"
                : "All claims are in good standing"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-warm-100 bg-warm-50/50">
                  <th className="text-left text-xs font-semibold text-warm-500 uppercase tracking-wide px-5 py-3">
                    Date
                  </th>
                  <th className="text-left text-xs font-semibold text-warm-500 uppercase tracking-wide px-5 py-3">
                    Client
                  </th>
                  <th className="text-left text-xs font-semibold text-warm-500 uppercase tracking-wide px-5 py-3">
                    Payer
                  </th>
                  <th className="text-left text-xs font-semibold text-warm-500 uppercase tracking-wide px-5 py-3">
                    CPT
                  </th>
                  <th className="text-right text-xs font-semibold text-warm-500 uppercase tracking-wide px-5 py-3">
                    Amount
                  </th>
                  <th className="text-left text-xs font-semibold text-warm-500 uppercase tracking-wide px-5 py-3">
                    Category
                  </th>
                  <th className="text-right text-xs font-semibold text-warm-500 uppercase tracking-wide px-5 py-3">
                    Days
                  </th>
                  <th className="text-right text-xs font-semibold text-warm-500 uppercase tracking-wide px-5 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedDenials.map((denial) => {
                  const cat = denial.denial_category?.category || "other";
                  const colors = getCategoryColor(cat);
                  return (
                    <tr
                      key={denial.claim_id}
                      className="border-b border-warm-50 hover:bg-warm-50/50 cursor-pointer transition-colors"
                      onClick={() => openDetail(denial.claim_id)}
                    >
                      <td className="px-5 py-3 text-sm text-warm-700">
                        {formatDate(denial.denied_at || denial.created_at)}
                      </td>
                      <td className="px-5 py-3 text-sm text-warm-700 font-medium">
                        {denial.client_name || denial.external_superbill_id?.slice(0, 8) || "\u2014"}
                      </td>
                      <td className="px-5 py-3 text-sm text-warm-600">
                        {denial.payer_name || "\u2014"}
                      </td>
                      <td className="px-5 py-3 text-sm font-mono text-warm-600">
                        {denial.cpt_code || "\u2014"}
                      </td>
                      <td className="px-5 py-3 text-sm text-warm-700 text-right font-medium">
                        {formatCurrency(denial.total_charge - denial.total_paid)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                          {denial.denial_category?.label || "Unknown"}
                        </span>
                        {denial.resubmission_count > 0 && (
                          <span className="ml-1.5 text-xs text-warm-400">
                            (x{denial.resubmission_count})
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-sm text-right">
                        <span
                          className={`font-medium ${
                            denial.days_since_denial > 60
                              ? "text-red-600"
                              : denial.days_since_denial > 30
                              ? "text-amber-600"
                              : "text-warm-600"
                          }`}
                        >
                          {denial.days_since_denial}d
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(denial.claim_id);
                          }}
                          className="text-xs font-medium text-teal-600 hover:text-teal-700"
                        >
                          Review
                        </button>
                        {denial.can_auto_resubmit && (
                          <span className="ml-2 inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
                            Auto-fix
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Slide-over */}
      {showDetail && (
        <DenialDetailPanel
          denial={selectedDenial}
          loading={detailLoading}
          corrections={corrections}
          setCorrections={setCorrections}
          onApplyFix={applySuggestionFix}
          onResubmit={handleResubmit}
          resubmitting={resubmitting}
          resubmitResult={resubmitResult}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DenialDetailPanel
// ---------------------------------------------------------------------------

function DenialDetailPanel({
  denial,
  loading,
  corrections,
  setCorrections,
  onApplyFix,
  onResubmit,
  resubmitting,
  resubmitResult,
  onClose,
}: {
  denial: DenialDetail | null;
  loading: boolean;
  corrections: Record<string, string>;
  setCorrections: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onApplyFix: (s: DenialSuggestion) => void;
  onResubmit: () => void;
  resubmitting: boolean;
  resubmitResult: ResubmitResponse | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-2xl bg-white shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-warm-100 px-6 py-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-warm-800">
            Denial Detail
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-warm-400 hover:text-warm-600 transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
          </div>
        ) : denial ? (
          <div className="px-6 py-5 space-y-6">
            {/* Claim Overview */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                {denial.denial_category && (
                  <CategoryBadge category={denial.denial_category} />
                )}
                {denial.can_auto_resubmit && (
                  <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                    Auto-resubmit eligible
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-warm-500">Payer:</span>{" "}
                  <span className="font-medium text-warm-700">{denial.payer_name || "\u2014"}</span>
                </div>
                <div>
                  <span className="text-warm-500">Charged:</span>{" "}
                  <span className="font-medium text-warm-700">{formatCurrency(denial.total_charge)}</span>
                </div>
                <div>
                  <span className="text-warm-500">Paid:</span>{" "}
                  <span className="font-medium text-warm-700">{formatCurrency(denial.total_paid)}</span>
                </div>
                <div>
                  <span className="text-warm-500">Patient Resp:</span>{" "}
                  <span className="font-medium text-warm-700">{formatCurrency(denial.patient_responsibility)}</span>
                </div>
                <div>
                  <span className="text-warm-500">Denied:</span>{" "}
                  <span className="font-medium text-warm-700">{formatDate(denial.denied_at)}</span>
                </div>
                <div>
                  <span className="text-warm-500">Resubmissions:</span>{" "}
                  <span className="font-medium text-warm-700">{denial.resubmission_count}</span>
                </div>
              </div>
            </div>

            {/* Denial Reason Codes */}
            {denial.denial_codes.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-warm-700 mb-2">Denial Reason Codes</h3>
                <div className="space-y-2">
                  {denial.denial_codes.map((code, i) => (
                    <div
                      key={`${code.reason_code}-${i}`}
                      className="flex items-start gap-3 px-3 py-2 bg-red-50 rounded-lg border border-red-100"
                    >
                      <span className="font-mono text-sm font-bold text-red-700 shrink-0">
                        {code.reason_code}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm text-red-800">{code.description}</p>
                        {code.group_code && (
                          <p className="text-xs text-red-600 mt-0.5">Group: {code.group_code}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Category Details */}
            {denial.denial_category && (
              <div className="bg-warm-50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-warm-700 mb-1">
                  {denial.denial_category.label}
                </h3>
                <p className="text-sm text-warm-600 mb-2">{denial.denial_category.description}</p>
                <div className="flex items-center gap-4 text-xs">
                  <span className={`font-medium ${denial.denial_category.is_appealable ? "text-green-600" : "text-red-600"}`}>
                    {denial.denial_category.is_appealable ? "Appealable" : "Not Appealable"}
                  </span>
                  <span className="text-warm-500">
                    Resolution: {denial.denial_category.typical_resolution}
                  </span>
                </div>
              </div>
            )}

            {/* Suggested Corrections */}
            {denial.suggestions.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-warm-700 mb-2">Suggested Actions</h3>
                <div className="space-y-2">
                  {denial.suggestions.map((suggestion, i) => (
                    <div
                      key={`${suggestion.action}-${i}`}
                      className="bg-white rounded-lg border border-warm-200 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-semibold uppercase ${PRIORITY_COLORS[suggestion.priority] || "text-gray-500"}`}>
                              {suggestion.priority}
                            </span>
                            {suggestion.auto_fixable && (
                              <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                                Auto-fixable
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-warm-700">{suggestion.description}</p>
                        </div>
                        {suggestion.auto_fixable && (
                          <button
                            onClick={() => onApplyFix(suggestion)}
                            className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
                          >
                            Apply Fix
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Resubmit Section */}
            <div className="bg-white rounded-lg border border-warm-200 p-4">
              <h3 className="text-sm font-semibold text-warm-700 mb-3">Correct & Resubmit</h3>

              {/* Correction fields */}
              <div className="space-y-3 mb-4">
                {Object.entries(corrections).map(([field, value]) => (
                  <div key={field} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={field}
                      onChange={(e) => {
                        const newCorr = { ...corrections };
                        delete newCorr[field];
                        newCorr[e.target.value] = value;
                        setCorrections(newCorr);
                      }}
                      placeholder="Field (e.g., patient.member_id)"
                      className="flex-1 px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
                    />
                    <input
                      type="text"
                      value={value}
                      onChange={(e) =>
                        setCorrections((prev) => ({ ...prev, [field]: e.target.value }))
                      }
                      placeholder="New value"
                      className="flex-1 px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
                    />
                    <button
                      onClick={() => {
                        const newCorr = { ...corrections };
                        delete newCorr[field];
                        setCorrections(newCorr);
                      }}
                      className="p-1.5 text-warm-400 hover:text-red-500 transition-colors"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    setCorrections((prev) => ({ ...prev, [`field_${Object.keys(prev).length + 1}`]: "" }))
                  }
                  className="text-xs font-medium text-teal-600 hover:text-teal-700"
                >
                  + Add correction field
                </button>
              </div>

              <button
                onClick={onResubmit}
                disabled={resubmitting || Object.keys(corrections).length === 0}
                className="w-full px-4 py-2.5 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {resubmitting && (
                  <span className="w-4 h-4 block border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                Resubmit Claim
              </button>

              {/* Resubmit result */}
              {resubmitResult && (
                <div
                  className={`mt-3 px-4 py-3 rounded-lg text-sm ${
                    resubmitResult.status === "error" || resubmitResult.errors.length > 0
                      ? "bg-red-50 text-red-700 border border-red-200"
                      : "bg-teal-50 text-teal-700 border border-teal-200"
                  }`}
                >
                  {resubmitResult.status === "error" || resubmitResult.errors.length > 0 ? (
                    <div>
                      <p className="font-medium">Resubmission failed</p>
                      {resubmitResult.errors.map((err, i) => (
                        <p key={i} className="mt-1">{err.message}</p>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium">Claim resubmitted successfully</p>
                      <p className="mt-1">
                        New claim ID: {resubmitResult.new_claim_id?.slice(0, 8)}...
                        {" \u2014 "}Status: {resubmitResult.status}
                      </p>
                      {resubmitResult.warnings.length > 0 && (
                        <div className="mt-1 text-amber-700">
                          {resubmitResult.warnings.map((w, i) => (
                            <p key={i}>{w}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Resubmission History */}
            {denial.related_claims.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-warm-700 mb-2">Claim History</h3>
                <div className="space-y-1.5">
                  {denial.related_claims.map((rc) => (
                    <div
                      key={rc.claim_id}
                      className="flex items-center justify-between px-3 py-2 bg-warm-50 rounded-lg text-sm"
                    >
                      <div>
                        <span className="font-mono text-warm-600">{rc.claim_id.slice(0, 8)}...</span>
                        <span className={`ml-2 inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                          rc.status === "paid" ? "bg-teal-50 text-teal-700" :
                          rc.status === "denied" ? "bg-red-50 text-red-700" :
                          rc.status === "submitted" ? "bg-amber-50 text-amber-700" :
                          "bg-gray-50 text-gray-700"
                        }`}>
                          {rc.status}
                        </span>
                      </div>
                      <span className="text-xs text-warm-500">{formatDate(rc.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Link to original claim review */}
            {denial.external_superbill_id && (
              <div className="pt-2 border-t border-warm-100">
                <Link
                  to={`/billing/claims/${denial.external_superbill_id}/review`}
                  className="text-sm font-medium text-teal-600 hover:text-teal-700"
                >
                  View Original Claim Review
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="py-16 text-center text-warm-500">
            Failed to load denial details.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CategoryBadge
// ---------------------------------------------------------------------------

function CategoryBadge({ category }: { category: DenialCategory }) {
  const colors = getCategoryColor(category.category);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${colors.bg} ${colors.text} border ${colors.border}`}
    >
      <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
      {category.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AnalyticsSection
// ---------------------------------------------------------------------------

function AnalyticsSection({
  analytics,
  loading,
}: {
  analytics: DenialAnalytics | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-warm-100 shadow-sm p-6 mb-6">
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="bg-white rounded-xl border border-warm-100 shadow-sm p-6 mb-6 text-center text-warm-500 text-sm">
        Unable to load analytics data.
      </div>
    );
  }

  const maxCategoryCount = Math.max(...analytics.by_category.map((c) => c.count), 1);
  const maxPayerCount = Math.max(...analytics.by_payer.map((p) => p.count), 1);
  const maxTrendCount = Math.max(...analytics.trend.map((t) => t.count), 1);

  return (
    <div className="bg-white rounded-xl border border-warm-100 shadow-sm p-6 mb-6">
      <h3 className="font-display text-lg font-bold text-warm-800 mb-4">Denial Analytics</h3>

      {/* Big numbers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="text-center p-4 bg-warm-50 rounded-lg">
          <p className="text-3xl font-bold text-warm-800">
            {analytics.denial_rate.toFixed(1)}%
          </p>
          <p className="text-xs text-warm-500 uppercase tracking-wide mt-1">Denial Rate</p>
        </div>
        <div className="text-center p-4 bg-warm-50 rounded-lg">
          <p className="text-3xl font-bold text-red-600">{analytics.total_denied}</p>
          <p className="text-xs text-warm-500 uppercase tracking-wide mt-1">Total Denied</p>
        </div>
        <div className="text-center p-4 bg-warm-50 rounded-lg">
          <p className="text-3xl font-bold text-warm-800">
            {formatCurrency(analytics.total_denied_amount)}
          </p>
          <p className="text-xs text-warm-500 uppercase tracking-wide mt-1">Denied Amount</p>
        </div>
        <div className="text-center p-4 bg-warm-50 rounded-lg">
          <p className="text-3xl font-bold text-warm-800">
            {analytics.average_days_to_resolve !== null
              ? `${analytics.average_days_to_resolve.toFixed(0)}d`
              : "\u2014"}
          </p>
          <p className="text-xs text-warm-500 uppercase tracking-wide mt-1">Avg Resolution</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Denials by Category */}
        <div>
          <h4 className="text-sm font-semibold text-warm-700 mb-3">By Category</h4>
          <div className="space-y-2">
            {analytics.by_category.map((cat) => {
              const colors = getCategoryColor(cat.category);
              return (
                <div key={cat.category}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-warm-600">{cat.label}</span>
                    <span className="text-warm-500">
                      {cat.count} ({cat.percentage.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="h-3 bg-warm-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${colors.dot}`}
                      style={{ width: `${(cat.count / maxCategoryCount) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Denials by Payer */}
        <div>
          <h4 className="text-sm font-semibold text-warm-700 mb-3">By Payer</h4>
          <div className="space-y-2">
            {analytics.by_payer.map((payer) => (
              <div key={payer.payer_name}>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="text-warm-600 truncate mr-2">{payer.payer_name}</span>
                  <span className="text-warm-500 shrink-0">
                    {payer.count} ({payer.percentage.toFixed(0)}%)
                  </span>
                </div>
                <div className="h-3 bg-warm-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-teal-500"
                    style={{ width: `${(payer.count / maxPayerCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Reason Codes */}
        <div>
          <h4 className="text-sm font-semibold text-warm-700 mb-3">Top Reason Codes</h4>
          <div className="overflow-hidden rounded-lg border border-warm-100">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-warm-50">
                  <th className="text-left px-3 py-1.5 font-semibold text-warm-500">Code</th>
                  <th className="text-left px-3 py-1.5 font-semibold text-warm-500">Description</th>
                  <th className="text-right px-3 py-1.5 font-semibold text-warm-500">Count</th>
                </tr>
              </thead>
              <tbody>
                {analytics.top_reason_codes.slice(0, 8).map((code) => (
                  <tr key={code.reason_code} className="border-t border-warm-50">
                    <td className="px-3 py-1.5 font-mono font-bold text-warm-700">{code.reason_code}</td>
                    <td className="px-3 py-1.5 text-warm-600 truncate max-w-[200px]">{code.description}</td>
                    <td className="px-3 py-1.5 text-right text-warm-700 font-medium">{code.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Monthly Trend */}
        <div>
          <h4 className="text-sm font-semibold text-warm-700 mb-3">Monthly Trend</h4>
          <div className="flex items-end gap-1 h-32">
            {analytics.trend.map((point) => (
              <div key={point.month} className="flex-1 flex flex-col items-center justify-end h-full">
                <div
                  className="w-full bg-red-400 rounded-t transition-all min-h-[2px]"
                  style={{ height: `${(point.count / maxTrendCount) * 100}%` }}
                  title={`${point.month}: ${point.count} denials`}
                />
                <span className="text-[10px] text-warm-400 mt-1 truncate w-full text-center">
                  {point.month.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
