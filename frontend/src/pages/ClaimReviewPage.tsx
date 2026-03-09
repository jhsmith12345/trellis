import { useState, useEffect, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { ICD10Search } from "../components/billing/ICD10Search";
import ERADetailView, { ERAData } from "../components/billing/ERADetailView";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiagnosisCode {
  code: string;
  description: string;
  rank?: number;
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
  diagnosis_codes: DiagnosisCode[];
  fee: number | null;
  amount_paid: number;
  status: string;
  billing_npi: string | null;
  auth_number: string | null;
  has_pdf: boolean;
  client_name: string | null;
  client_uuid: string | null;
  created_at: string;
  updated_at: string;
}

interface CMS1500Fields {
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CPT_OPTIONS: { code: string; description: string }[] = [
  { code: "90791", description: "Psychiatric Diagnostic Evaluation" },
  { code: "90832", description: "Psychotherapy, 30 min" },
  { code: "90834", description: "Psychotherapy, 45 min" },
  { code: "90837", description: "Psychotherapy, 60 min" },
  { code: "90846", description: "Family therapy w/o patient" },
  { code: "90847", description: "Family therapy w/ patient" },
];

const POS_OPTIONS: { code: string; label: string }[] = [
  { code: "02", label: "02 - Telehealth" },
  { code: "11", label: "11 - Office" },
  { code: "10", label: "10 - Telehealth (Patient Home)" },
];

const MODIFIER_OPTIONS: string[] = [
  "95", "GT", "HO", "XE", "XP", "XS", "XU", "25", "59",
];

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClaimReviewPage() {
  const { superbillId } = useParams<{ superbillId: string }>();
  const api = useApi();

  const [superbill, setSuperbill] = useState<Superbill | null>(null);
  const [cms1500, setCms1500] = useState<CMS1500Fields | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [downloadingCms, setDownloadingCms] = useState(false);
  const [downloadingEdi, setDownloadingEdi] = useState(false);
  const [markingSubmitted, setMarkingSubmitted] = useState(false);
  const [submittingClaim, setSubmittingClaim] = useState(false);
  const [billingConnected, setBillingConnected] = useState(false);
  const [eraData, setEraData] = useState<ERAData | null>(null);
  const [eraLoading, setEraLoading] = useState(false);

  // Denial info (shown when claim is denied)
  const [denialInfo, setDenialInfo] = useState<{
    denial_category: { category: string; label: string; description: string; is_appealable: boolean; typical_resolution: string } | null;
    denial_codes: { reason_code: string; description: string; group_code: string }[];
    suggestions: { action: string; description: string; auto_fixable: boolean; priority: string }[];
    can_auto_resubmit: boolean;
  } | null>(null);

  // Editable form state
  const [cptCode, setCptCode] = useState("");
  const [cptDescription, setCptDescription] = useState("");
  const [diagnosisCodes, setDiagnosisCodes] = useState<DiagnosisCode[]>([]);
  const [fee, setFee] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [placeOfService, setPlaceOfService] = useState("02");
  const [modifiers, setModifiers] = useState<string[]>([]);
  const [authNumber, setAuthNumber] = useState("");
  const [secondaryInsOpen, setSecondaryInsOpen] = useState(false);
  // Payer fields are stored on the client — we show them read-only for now
  // but allow editing payer_id and secondary fields on the superbill
  const [payerId, setPayerId] = useState("");
  const [secondaryPayerName, setSecondaryPayerName] = useState("");
  const [secondaryPayerId, setSecondaryPayerId] = useState("");
  const [secondaryMemberId, setSecondaryMemberId] = useState("");

  const loadData = useCallback(async () => {
    if (!superbillId) return;
    try {
      const [sb, cmsData, billingSettings] = await Promise.all([
        api.get<Superbill>(`/api/superbills/${superbillId}`),
        api.get<{ cms1500_fields: CMS1500Fields }>(`/api/superbills/${superbillId}/cms1500/data`),
        api.get<{ connected: boolean }>("/api/billing/settings").catch(() => null),
      ]);
      if (billingSettings) setBillingConnected(billingSettings.connected);

      // Normalize diagnosis_codes
      const dxCodes =
        typeof sb.diagnosis_codes === "string"
          ? JSON.parse(sb.diagnosis_codes as unknown as string)
          : sb.diagnosis_codes || [];

      setSuperbill({ ...sb, diagnosis_codes: dxCodes });
      setCms1500(cmsData.cms1500_fields);

      // Initialize form state
      setCptCode(sb.cpt_code || "");
      setCptDescription(sb.cpt_description || "");
      setDiagnosisCodes(dxCodes);
      setFee(sb.fee !== null ? String(sb.fee) : "");
      setAmountPaid(String(sb.amount_paid || 0));
      setPlaceOfService(cmsData.cms1500_fields?.box_24?.[0]?.b_pos || "02");
      setAuthNumber(sb.auth_number || "");
      // Parse modifiers from CMS-1500 data
      const modStr = cmsData.cms1500_fields?.box_24?.[0]?.d_modifiers || "";
      setModifiers(modStr ? modStr.split(",").map((m: string) => m.trim()).filter(Boolean) : []);
    } catch (err) {
      console.error("Failed to load superbill:", err);
    } finally {
      setLoading(false);
    }
  }, [api, superbillId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Fetch ERA data when superbill has been adjudicated/paid/denied
  const showEra = superbill
    ? ["submitted", "paid", "outstanding", "adjudicated", "denied"].includes(superbill.status)
    : false;

  useEffect(() => {
    if (!superbillId || !showEra) return;
    let cancelled = false;
    setEraLoading(true);
    api
      .get<ERAData>(`/api/superbills/${superbillId}/era`)
      .then((data) => {
        if (!cancelled) setEraData(data);
      })
      .catch(() => {
        // 404 = no ERA data yet, which is normal for submitted claims
        if (!cancelled) setEraData(null);
      })
      .finally(() => {
        if (!cancelled) setEraLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, superbillId, showEra]);

  // Fetch denial info for denied claims
  const isDenied = superbill?.status === "denied" || superbill?.status === "outstanding";
  useEffect(() => {
    if (!superbillId || !isDenied) return;
    let cancelled = false;
    // Try to get denial detail using superbill ID as the external reference
    api
      .get<any>(`/api/billing/denials/${superbillId}`)
      .then((data) => {
        if (!cancelled) {
          setDenialInfo({
            denial_category: data.denial_category,
            denial_codes: data.denial_codes || [],
            suggestions: data.suggestions || [],
            can_auto_resubmit: data.can_auto_resubmit || false,
          });
        }
      })
      .catch(() => {
        // No denial data — fine, the billing service may not have it
        if (!cancelled) setDenialInfo(null);
      });
    return () => { cancelled = true; };
  }, [api, superbillId, isDenied]);

  const isEditable = superbill?.status === "generated";

  async function handleSave() {
    if (!superbillId || !isEditable) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const payload: Record<string, any> = {
        cpt_code: cptCode,
        cpt_description: cptDescription,
        diagnosis_codes: diagnosisCodes,
        fee: fee ? parseFloat(fee) : null,
        place_of_service: placeOfService,
        modifiers,
        auth_number: authNumber || null,
        payer_id: payerId || null,
        secondary_payer_name: secondaryPayerName || null,
        secondary_payer_id: secondaryPayerId || null,
        secondary_member_id: secondaryMemberId || null,
      };

      const updated = await api.patch<Superbill>(`/api/superbills/${superbillId}`, payload);
      const dxCodes =
        typeof updated.diagnosis_codes === "string"
          ? JSON.parse(updated.diagnosis_codes as unknown as string)
          : updated.diagnosis_codes || [];
      setSuperbill({ ...updated, diagnosis_codes: dxCodes });

      // Reload CMS-1500 data
      const cmsData = await api.get<{ cms1500_fields: CMS1500Fields }>(
        `/api/superbills/${superbillId}/cms1500/data`
      );
      setCms1500(cmsData.cms1500_fields);

      setSaveMessage("Changes saved successfully.");
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err: any) {
      console.error("Failed to save:", err);
      setSaveMessage(`Error: ${err.message || "Failed to save changes."}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadCms1500() {
    if (!superbillId) return;
    setDownloadingCms(true);
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
      console.error("Failed to download CMS-1500:", err);
      alert("Failed to download CMS-1500 PDF.");
    } finally {
      setDownloadingCms(false);
    }
  }

  async function handleDownloadEdi837() {
    if (!superbillId) return;
    setDownloadingEdi(true);
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
      setDownloadingEdi(false);
    }
  }

  async function handleMarkSubmitted() {
    if (!superbillId) return;
    setMarkingSubmitted(true);
    try {
      await api.patch(`/api/superbills/${superbillId}/status`, { status: "submitted" });
      // Reload data to reflect new status
      await loadData();
    } catch (err: any) {
      console.error("Failed to mark as submitted:", err);
      alert(err.message || "Failed to mark as submitted.");
    } finally {
      setMarkingSubmitted(false);
    }
  }

  async function handleSubmitClaim() {
    if (!superbillId) return;
    setSubmittingClaim(true);
    try {
      await api.post(`/api/superbills/${superbillId}/submit`, {});
      await loadData();
    } catch (err: any) {
      console.error("Failed to submit claim:", err);
      alert(err.message || "Failed to submit claim to billing service.");
    } finally {
      setSubmittingClaim(false);
    }
  }

  // Diagnosis code management
  function addDiagnosis(dx: { code: string; description: string }) {
    setDiagnosisCodes((prev) => [
      ...prev,
      { code: dx.code, description: dx.description, rank: prev.length + 1 },
    ]);
  }

  function removeDiagnosis(idx: number) {
    setDiagnosisCodes((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveDiagnosis(idx: number, direction: "up" | "down") {
    setDiagnosisCodes((prev) => {
      const next = [...prev];
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= next.length) return prev;
      const temp = next[idx]!;
      next[idx] = next[targetIdx]!;
      next[targetIdx] = temp;
      return next;
    });
  }

  // Modifier management
  function toggleModifier(mod: string) {
    setModifiers((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
    );
  }

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-7xl">
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!superbill) {
    return (
      <div className="px-8 py-8 max-w-7xl">
        <p className="text-warm-500">Superbill not found.</p>
        <Link to="/billing" className="text-teal-600 hover:text-teal-700 text-sm mt-2 inline-block">
          Back to Billing
        </Link>
      </div>
    );
  }

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
              Claim Review
            </h1>
            <span
              className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                superbill.status === "generated"
                  ? "bg-blue-50 text-blue-700"
                  : superbill.status === "submitted"
                  ? "bg-amber-50 text-amber-700"
                  : superbill.status === "paid"
                  ? "bg-teal-50 text-teal-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {superbill.status.charAt(0).toUpperCase() + superbill.status.slice(1)}
            </span>
          </div>
          <p className="text-sm text-warm-500">
            {superbill.client_name} &middot; {formatDate(superbill.date_of_service)} &middot;{" "}
            {superbill.cpt_code}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {isEditable && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving && (
                <span className="w-4 h-4 block border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              Save Changes
            </button>
          )}
          <button
            onClick={handleDownloadCms1500}
            disabled={downloadingCms}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {downloadingCms && (
              <span className="w-4 h-4 block border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
            )}
            CMS-1500
          </button>
          <button
            onClick={handleDownloadEdi837}
            disabled={downloadingEdi}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {downloadingEdi && (
              <span className="w-4 h-4 block border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
            )}
            837P
          </button>
          {billingConnected && isEditable && (
            <button
              onClick={handleSubmitClaim}
              disabled={submittingClaim}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {submittingClaim && (
                <span className="w-4 h-4 block border-2 border-green-200 border-t-green-600 rounded-full animate-spin" />
              )}
              Submit Claim
            </button>
          )}
          {isEditable && (
            <button
              onClick={handleMarkSubmitted}
              disabled={markingSubmitted}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {markingSubmitted && (
                <span className="w-4 h-4 block border-2 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
              )}
              Mark as Submitted
            </button>
          )}
        </div>
      </div>

      {/* Save message */}
      {saveMessage && (
        <div
          className={`mb-4 px-4 py-2 rounded-lg text-sm ${
            saveMessage.startsWith("Error")
              ? "bg-red-50 text-red-700 border border-red-200"
              : "bg-teal-50 text-teal-700 border border-teal-200"
          }`}
        >
          {saveMessage}
        </div>
      )}

      {!isEditable && !denialInfo && (
        <div className="mb-4 px-4 py-2 rounded-lg text-sm bg-amber-50 text-amber-700 border border-amber-200">
          This claim has been {superbill.status}. Editing is only available for claims with "generated" status.
        </div>
      )}

      {/* Denial Banner */}
      {denialInfo && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 overflow-hidden">
          <div className="px-5 py-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-red-600">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                  <h3 className="font-semibold text-red-800">
                    Claim Denied{denialInfo.denial_category ? ` \u2014 ${denialInfo.denial_category.label}` : ""}
                  </h3>
                  {denialInfo.can_auto_resubmit && (
                    <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                      Auto-resubmit eligible
                    </span>
                  )}
                </div>
                {denialInfo.denial_category && (
                  <p className="text-sm text-red-700 mb-2">{denialInfo.denial_category.description}</p>
                )}
                {/* Denial codes */}
                {denialInfo.denial_codes.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {denialInfo.denial_codes.map((code, i) => (
                      <span key={`${code.reason_code}-${i}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-800 text-xs font-medium">
                        <span className="font-mono font-bold">{code.reason_code}</span>
                        <span className="text-red-600">{code.description}</span>
                      </span>
                    ))}
                  </div>
                )}
                {/* Top suggestions */}
                {denialInfo.suggestions.length > 0 && (
                  <div className="space-y-1 mt-2">
                    <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Suggested Actions:</p>
                    {denialInfo.suggestions.slice(0, 3).map((s, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-red-700">
                        <span className="text-red-400 mt-0.5">&#8226;</span>
                        <span>{s.description}</span>
                        {s.auto_fixable && (
                          <span className="shrink-0 inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                            Auto-fixable
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Link
                to="/billing/denials"
                className="shrink-0 px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Correct & Resubmit
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left panel — Editable form */}
        <div className="lg:col-span-3 space-y-5">
          {/* Patient Info (read-only) */}
          <FormSection title="Patient Information" readOnly>
            <div className="grid grid-cols-2 gap-4">
              <ReadOnlyField label="Patient Name" value={superbill.client_name || "-"} />
              <ReadOnlyField label="Date of Birth" value={cms1500?.box_3_dob || "-"} />
              <ReadOnlyField label="Sex" value={cms1500?.box_3_sex || "-"} />
              <ReadOnlyField
                label="Address"
                value={
                  [cms1500?.box_5_street, cms1500?.box_5_city, cms1500?.box_5_state, cms1500?.box_5_zip]
                    .filter(Boolean)
                    .join(", ") || "-"
                }
              />
              <ReadOnlyField label="Phone" value={cms1500?.box_5_phone || "-"} />
              {superbill.client_uuid && (
                <div>
                  <Link
                    to={`/clients/${superbill.client_uuid}`}
                    className="text-sm text-teal-600 hover:text-teal-700 font-medium"
                  >
                    View Client Profile
                  </Link>
                </div>
              )}
            </div>
          </FormSection>

          {/* Insurance */}
          <FormSection title="Insurance">
            <div className="grid grid-cols-2 gap-4">
              <ReadOnlyField label="Payer Name" value={cms1500?.box_11c || "-"} />
              <ReadOnlyField label="Member ID" value={cms1500?.box_1a || "-"} />
              <ReadOnlyField label="Group Number" value={cms1500?.box_11 || "-"} />
              <div>
                <label className="block text-xs font-medium text-warm-500 mb-1">
                  Payer ID (Electronic)
                </label>
                <input
                  type="text"
                  value={payerId}
                  onChange={(e) => setPayerId(e.target.value)}
                  disabled={!isEditable}
                  placeholder="e.g., 12345"
                  className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 disabled:bg-warm-50 disabled:text-warm-400"
                />
              </div>
            </div>
          </FormSection>

          {/* Secondary Insurance (collapsible) */}
          <div className="bg-white rounded-xl border border-warm-100 shadow-sm overflow-hidden">
            <button
              onClick={() => setSecondaryInsOpen(!secondaryInsOpen)}
              className="w-full px-5 py-3 flex items-center justify-between hover:bg-warm-50 transition-colors"
            >
              <h3 className="text-sm font-semibold text-warm-700">Secondary Insurance</h3>
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className={`w-4 h-4 text-warm-400 transition-transform ${
                  secondaryInsOpen ? "rotate-180" : ""
                }`}
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            {secondaryInsOpen && (
              <div className="px-5 pb-4 pt-1">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-warm-500 mb-1">
                      Payer Name
                    </label>
                    <input
                      type="text"
                      value={secondaryPayerName}
                      onChange={(e) => setSecondaryPayerName(e.target.value)}
                      disabled={!isEditable}
                      className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 disabled:bg-warm-50 disabled:text-warm-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-warm-500 mb-1">
                      Payer ID
                    </label>
                    <input
                      type="text"
                      value={secondaryPayerId}
                      onChange={(e) => setSecondaryPayerId(e.target.value)}
                      disabled={!isEditable}
                      className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 disabled:bg-warm-50 disabled:text-warm-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-warm-500 mb-1">
                      Member ID
                    </label>
                    <input
                      type="text"
                      value={secondaryMemberId}
                      onChange={(e) => setSecondaryMemberId(e.target.value)}
                      disabled={!isEditable}
                      className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 disabled:bg-warm-50 disabled:text-warm-400"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Service Details */}
          <FormSection title="Service Details">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-warm-500 mb-1">
                  CPT Code
                </label>
                <select
                  value={cptCode}
                  onChange={(e) => {
                    const opt = CPT_OPTIONS.find((o) => o.code === e.target.value);
                    setCptCode(e.target.value);
                    if (opt) setCptDescription(opt.description);
                  }}
                  disabled={!isEditable}
                  className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 disabled:bg-warm-50 disabled:text-warm-400"
                >
                  {CPT_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.code} - {opt.description}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-warm-500 mb-1">
                  Place of Service
                </label>
                <select
                  value={placeOfService}
                  onChange={(e) => setPlaceOfService(e.target.value)}
                  disabled={!isEditable}
                  className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 disabled:bg-warm-50 disabled:text-warm-400"
                >
                  {POS_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-warm-500 mb-1">
                  Modifiers
                </label>
                <div className="flex flex-wrap gap-2">
                  {MODIFIER_OPTIONS.map((mod) => (
                    <button
                      key={mod}
                      type="button"
                      onClick={() => isEditable && toggleModifier(mod)}
                      disabled={!isEditable}
                      className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                        modifiers.includes(mod)
                          ? "bg-teal-50 border-teal-300 text-teal-700 font-medium"
                          : "border-warm-200 text-warm-500 hover:bg-warm-50"
                      } disabled:opacity-60`}
                    >
                      {mod}
                    </button>
                  ))}
                </div>
              </div>
              <ReadOnlyField label="Units" value="1" />
              <ReadOnlyField label="Date of Service" value={formatDate(superbill.date_of_service)} />
            </div>
          </FormSection>

          {/* Diagnosis Codes */}
          <FormSection title="Diagnosis Codes (ICD-10)">
            {diagnosisCodes.length > 0 ? (
              <div className="space-y-1.5 mb-3">
                {diagnosisCodes.map((dx, i) => (
                  <div
                    key={`${dx.code}-${i}`}
                    className="flex items-center gap-2 px-3 py-2 bg-warm-50 rounded-lg group"
                  >
                    <span className="text-xs font-semibold text-warm-400 w-5">
                      {String.fromCharCode(65 + i)}.
                    </span>
                    <span className="font-mono text-sm font-semibold text-warm-700">
                      {dx.code}
                    </span>
                    <span className="text-sm text-warm-600 flex-1 truncate">
                      {dx.description}
                    </span>
                    {isEditable && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => moveDiagnosis(i, "up")}
                          disabled={i === 0}
                          className="p-1 text-warm-400 hover:text-warm-600 disabled:opacity-30"
                          title="Move up"
                        >
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path
                              fillRule="evenodd"
                              d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={() => moveDiagnosis(i, "down")}
                          disabled={i === diagnosisCodes.length - 1}
                          className="p-1 text-warm-400 hover:text-warm-600 disabled:opacity-30"
                          title="Move down"
                        >
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path
                              fillRule="evenodd"
                              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={() => removeDiagnosis(i)}
                          className="p-1 text-red-400 hover:text-red-600"
                          title="Remove"
                        >
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-warm-400 mb-3">No diagnosis codes added.</p>
            )}
            {isEditable && (
              <ICD10Search
                onSelect={addDiagnosis}
                excludeCodes={diagnosisCodes.map((dx) => dx.code)}
              />
            )}
          </FormSection>

          {/* Authorization */}
          <FormSection title="Authorization">
            <div>
              <label className="block text-xs font-medium text-warm-500 mb-1">
                Authorization Number
              </label>
              <input
                type="text"
                value={authNumber}
                onChange={(e) => setAuthNumber(e.target.value)}
                disabled={!isEditable}
                placeholder="Prior authorization number"
                className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 disabled:bg-warm-50 disabled:text-warm-400"
              />
            </div>
          </FormSection>

          {/* Charges */}
          <FormSection title="Charges">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-warm-500 mb-1">
                  Fee ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  disabled={!isEditable}
                  className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 disabled:bg-warm-50 disabled:text-warm-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-warm-500 mb-1">
                  Amount Paid ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={amountPaid}
                  disabled
                  className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg bg-warm-50 text-warm-400"
                />
              </div>
            </div>
          </FormSection>

          {/* ERA / Payment Posting */}
          {showEra && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-teal-600">
                  <path
                    fillRule="evenodd"
                    d="M1 4a1 1 0 011-1h16a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4zm12 4a3 3 0 11-6 0 3 3 0 016 0zM4 9a1 1 0 100-2 1 1 0 000 2zm12-1a1 1 0 11-2 0 1 1 0 012 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <h3 className="text-sm font-semibold text-warm-700">
                  ERA / Payment Posting
                </h3>
              </div>
              <ERADetailView
                eraData={eraData}
                loading={eraLoading}
                chargedAmount={superbill?.fee}
              />
            </div>
          )}

          {/* Provider Info (read-only) */}
          <FormSection title="Provider Information" readOnly>
            <div className="grid grid-cols-2 gap-4">
              <ReadOnlyField label="Practice/Billing" value={cms1500?.box_33_name || "-"} />
              <ReadOnlyField label="Billing NPI" value={cms1500?.box_33a || "-"} />
              <ReadOnlyField label="Rendering NPI" value={cms1500?.box_24?.[0]?.j_npi || "-"} />
              <ReadOnlyField label="Tax ID" value={cms1500?.box_25_tax_id || "-"} />
              <ReadOnlyField
                label="Address"
                value={cms1500?.box_33_address || "-"}
              />
              <ReadOnlyField label="Phone" value={cms1500?.box_33_phone || "-"} />
            </div>
          </FormSection>
        </div>

        {/* Right panel — CMS-1500 Preview */}
        <div className="lg:col-span-2">
          <div className="sticky top-8">
            <div className="bg-white rounded-xl border border-warm-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-warm-50 border-b border-warm-100">
                <h3 className="text-sm font-semibold text-warm-700">CMS-1500 Preview</h3>
                <p className="text-xs text-warm-400 mt-0.5">
                  Live preview of claim data
                </p>
              </div>
              <div className="p-5 text-xs space-y-4">
                {/* Patient */}
                <PreviewSection title="Patient">
                  <PreviewRow label="Name" value={cms1500?.box_2 || "-"} />
                  <PreviewRow label="DOB" value={cms1500?.box_3_dob || "-"} />
                  <PreviewRow label="Sex" value={cms1500?.box_3_sex || "-"} />
                  <PreviewRow label="ID #" value={cms1500?.box_1a || "-"} />
                </PreviewSection>

                {/* Insurance */}
                <PreviewSection title="Insurance">
                  <PreviewRow label="Type" value={cms1500?.box_1 || "-"} />
                  <PreviewRow label="Payer" value={cms1500?.box_11c || "-"} />
                  <PreviewRow label="Group #" value={cms1500?.box_11 || "-"} />
                  {cms1500?.box_9_name && (
                    <PreviewRow label="Secondary" value={cms1500.box_9_name} />
                  )}
                </PreviewSection>

                {/* Diagnosis */}
                <PreviewSection title="Diagnoses (Box 21)">
                  {diagnosisCodes.length > 0 ? (
                    diagnosisCodes.map((dx, i) => (
                      <div key={dx.code} className="flex gap-1.5">
                        <span className="font-semibold text-warm-400">
                          {String.fromCharCode(65 + i)}.
                        </span>
                        <span className="font-mono font-semibold">{dx.code}</span>
                        <span className="text-warm-500 truncate">{dx.description}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-warm-400 italic">None</span>
                  )}
                </PreviewSection>

                {/* Service Line */}
                <PreviewSection title="Service Line (Box 24)">
                  <PreviewRow label="DOS" value={formatDate(superbill.date_of_service)} />
                  <PreviewRow label="POS" value={placeOfService} />
                  <PreviewRow
                    label="CPT"
                    value={`${cptCode}${modifiers.length > 0 ? ` (${modifiers.join(", ")})` : ""}`}
                    bold
                  />
                  <PreviewRow
                    label="Dx Ptr"
                    value={diagnosisCodes.map((_, i) => String.fromCharCode(65 + i)).join(",") || "A"}
                  />
                  <PreviewRow label="Charge" value={fee ? `$${parseFloat(fee).toFixed(2)}` : "-"} bold />
                  <PreviewRow label="Units" value="1" />
                </PreviewSection>

                {/* Authorization */}
                {authNumber && (
                  <PreviewSection title="Authorization (Box 23)">
                    <PreviewRow label="Auth #" value={authNumber} />
                  </PreviewSection>
                )}

                {/* Totals */}
                <PreviewSection title="Billing Summary">
                  <PreviewRow
                    label="Total Charge"
                    value={fee ? `$${parseFloat(fee).toFixed(2)}` : "-"}
                    bold
                  />
                  <PreviewRow
                    label="Amount Paid"
                    value={formatCurrency(parseFloat(amountPaid) || 0)}
                  />
                  <PreviewRow
                    label="Balance Due"
                    value={
                      fee
                        ? formatCurrency(parseFloat(fee) - (parseFloat(amountPaid) || 0))
                        : "-"
                    }
                    bold
                  />
                </PreviewSection>

                {/* Provider */}
                <PreviewSection title="Provider (Box 33)">
                  <PreviewRow label="Name" value={cms1500?.box_33_name || "-"} />
                  <PreviewRow label="NPI" value={cms1500?.box_33a || "-"} />
                  <PreviewRow label="Tax ID" value={cms1500?.box_25_tax_id || "-"} />
                </PreviewSection>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FormSection({
  title,
  readOnly,
  children,
}: {
  title: string;
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-warm-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-warm-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-warm-700">{title}</h3>
        {readOnly && (
          <span className="text-xs text-warm-400 bg-warm-50 px-2 py-0.5 rounded">
            Read-only
          </span>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-warm-500 mb-1">{label}</label>
      <p className="text-sm text-warm-700">{value}</p>
    </div>
  );
}

function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-warm-500 uppercase tracking-wide mb-1.5 border-b border-warm-100 pb-1">
        {title}
      </h4>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-warm-400">{label}:</span>
      <span className={`text-warm-700 text-right ${bold ? "font-semibold" : ""}`}>
        {value}
      </span>
    </div>
  );
}
