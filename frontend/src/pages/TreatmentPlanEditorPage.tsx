import { useState, useEffect, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { SectionEditor } from "../components/notes/SectionEditor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Diagnosis {
  code: string;
  description: string;
  rank: number;
  type: string;
}

interface Objective {
  id: string;
  description: string;
  status: string;
}

interface Goal {
  id: string;
  description: string;
  target_date: string;
  status: string;
  objectives: Objective[];
  interventions: string[];
}

interface VersionSummary {
  id: string;
  version: number;
  status: string;
  created_at: string;
  signed_at: string | null;
}

interface PlanDetail {
  id: string;
  client_id: string;
  version: number;
  diagnoses: Diagnosis[];
  goals: Goal[];
  presenting_problems: string | null;
  review_date: string | null;
  status: string;
  signed_by: string | null;
  signed_at: string | null;
  content_hash: string | null;
  signature_data: string | null;
  source_encounter_id: string | null;
  previous_version_id: string | null;
  created_at: string;
  updated_at: string;
  client: {
    firebase_uid: string;
    full_name: string | null;
    preferred_name: string | null;
    email: string | null;
    date_of_birth: string | null;
  } | null;
  client_uuid: string | null;
  versions: VersionSummary[];
  has_pdf: boolean;
  pdf_data_exists?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  review: "bg-blue-50 text-blue-700 border-blue-200",
  signed: "bg-teal-50 text-teal-700 border-teal-200",
  superseded: "bg-warm-100 text-warm-500 border-warm-200",
};

const GOAL_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "met", label: "Met" },
  { value: "modified", label: "Modified" },
  { value: "deferred", label: "Deferred" },
];

const OBJECTIVE_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "met", label: "Met" },
  { value: "modified", label: "Modified" },
];

const DIAGNOSIS_TYPE_OPTIONS = [
  { value: "primary", label: "Primary" },
  { value: "secondary", label: "Secondary" },
  { value: "provisional", label: "Provisional" },
  { value: "rule-out", label: "Rule Out" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TreatmentPlanEditorPage() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const api = useApi();

  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [presentingProblems, setPresentingProblems] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState("");
  const [showSigningModal, setShowSigningModal] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [updatingPlan, setUpdatingPlan] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  // Load plan data
  useEffect(() => {
    async function load() {
      if (!planId) return;
      try {
        const data = await api.get<PlanDetail>(
          `/api/treatment-plans/${planId}`
        );
        setPlan(data);
        setDiagnoses(data.diagnoses || []);
        setGoals(data.goals || []);
        setPresentingProblems(data.presenting_problems || "");
        setReviewDate(data.review_date || "");
      } catch (err) {
        console.error("Failed to load treatment plan:", err);
        setError("Failed to load treatment plan. It may not exist.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api, planId]);

  const markChanged = useCallback(() => {
    setHasChanges(true);
    setSaveMessage("");
  }, []);

  // --- Diagnosis handlers ---
  const addDiagnosis = () => {
    setDiagnoses((prev) => [
      ...prev,
      {
        code: "",
        description: "",
        rank: prev.length + 1,
        type: prev.length === 0 ? "primary" : "secondary",
      },
    ]);
    markChanged();
  };

  const updateDiagnosis = (index: number, field: keyof Diagnosis, value: string | number) => {
    setDiagnoses((prev) =>
      prev.map((dx, i) => (i === index ? { ...dx, [field]: value } : dx))
    );
    markChanged();
  };

  const removeDiagnosis = (index: number) => {
    setDiagnoses((prev) => prev.filter((_, i) => i !== index).map((dx, i) => ({ ...dx, rank: i + 1 })));
    markChanged();
  };

  // --- Goal handlers ---
  const addGoal = () => {
    const nextId = `goal_${goals.length + 1}_${Date.now()}`;
    setGoals((prev) => [
      ...prev,
      {
        id: nextId,
        description: "",
        target_date: "",
        status: "active",
        objectives: [],
        interventions: [],
      },
    ]);
    markChanged();
  };

  const updateGoal = (index: number, field: string, value: string) => {
    setGoals((prev) =>
      prev.map((g, i) => (i === index ? { ...g, [field]: value } : g))
    );
    markChanged();
  };

  const removeGoal = (index: number) => {
    setGoals((prev) => prev.filter((_, i) => i !== index));
    markChanged();
  };

  // --- Objective handlers ---
  const addObjective = (goalIndex: number) => {
    setGoals((prev) =>
      prev.map((g, i) =>
        i === goalIndex
          ? {
              ...g,
              objectives: [
                ...g.objectives,
                {
                  id: `obj_${goalIndex + 1}_${g.objectives.length + 1}_${Date.now()}`,
                  description: "",
                  status: "active",
                },
              ],
            }
          : g
      )
    );
    markChanged();
  };

  const updateObjective = (goalIndex: number, objIndex: number, field: string, value: string) => {
    setGoals((prev) =>
      prev.map((g, gi) =>
        gi === goalIndex
          ? {
              ...g,
              objectives: g.objectives.map((o, oi) =>
                oi === objIndex ? { ...o, [field]: value } : o
              ),
            }
          : g
      )
    );
    markChanged();
  };

  const removeObjective = (goalIndex: number, objIndex: number) => {
    setGoals((prev) =>
      prev.map((g, gi) =>
        gi === goalIndex
          ? { ...g, objectives: g.objectives.filter((_, oi) => oi !== objIndex) }
          : g
      )
    );
    markChanged();
  };

  // --- Intervention handlers ---
  const addIntervention = (goalIndex: number) => {
    setGoals((prev) =>
      prev.map((g, i) =>
        i === goalIndex
          ? { ...g, interventions: [...g.interventions, ""] }
          : g
      )
    );
    markChanged();
  };

  const updateIntervention = (goalIndex: number, intIndex: number, value: string) => {
    setGoals((prev) =>
      prev.map((g, gi) =>
        gi === goalIndex
          ? {
              ...g,
              interventions: g.interventions.map((inv, ii) =>
                ii === intIndex ? value : inv
              ),
            }
          : g
      )
    );
    markChanged();
  };

  const removeIntervention = (goalIndex: number, intIndex: number) => {
    setGoals((prev) =>
      prev.map((g, gi) =>
        gi === goalIndex
          ? { ...g, interventions: g.interventions.filter((_, ii) => ii !== intIndex) }
          : g
      )
    );
    markChanged();
  };

  // --- Save ---
  const handleSave = async () => {
    if (!planId || !plan) return;
    setSaving(true);
    setSaveMessage("");
    try {
      await api.put(`/api/treatment-plans/${planId}`, {
        diagnoses,
        goals,
        presenting_problems: presentingProblems,
        review_date: reviewDate || null,
      });
      setHasChanges(false);
      setSaveMessage("Saved successfully");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (err) {
      console.error("Save failed:", err);
      setSaveMessage("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // --- Status transitions ---
  const handleMarkReview = async () => {
    if (!planId || !plan) return;
    setSaving(true);
    try {
      if (hasChanges) {
        await api.put(`/api/treatment-plans/${planId}`, {
          diagnoses,
          goals,
          presenting_problems: presentingProblems,
          review_date: reviewDate || null,
        });
      }
      await api.put(`/api/treatment-plans/${planId}`, { status: "review" });
      setPlan((prev) => (prev ? { ...prev, status: "review" } : prev));
      setHasChanges(false);
      setSaveMessage("Moved to review");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (err) {
      console.error("Status change failed:", err);
      setSaveMessage("Failed to update status");
    } finally {
      setSaving(false);
    }
  };

  const handleBackToDraft = async () => {
    if (!planId || !plan) return;
    setSaving(true);
    try {
      await api.put(`/api/treatment-plans/${planId}`, { status: "draft" });
      setPlan((prev) => (prev ? { ...prev, status: "draft" } : prev));
      setSaveMessage("Moved back to draft");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (err) {
      console.error("Status change failed:", err);
      setSaveMessage("Failed to update status");
    } finally {
      setSaving(false);
    }
  };

  // --- Sign ---
  const handleOpenSign = async () => {
    if (!planId || !plan) return;
    if (hasChanges) {
      setSaving(true);
      try {
        await api.put(`/api/treatment-plans/${planId}`, {
          diagnoses,
          goals,
          presenting_problems: presentingProblems,
          review_date: reviewDate || null,
        });
        setHasChanges(false);
      } catch (err) {
        console.error("Save before sign failed:", err);
        setSaveMessage("Failed to save. Please save before signing.");
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    setShowSigningModal(true);
  };

  const handleSigned = (result: {
    signed_by: string;
    signed_at: string;
    content_hash: string;
  }) => {
    setShowSigningModal(false);
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            status: "signed",
            signed_by: result.signed_by,
            signed_at: result.signed_at,
            content_hash: result.content_hash,
            has_pdf: true,
          }
        : prev
    );
    setSaveMessage("Treatment plan signed successfully");
    setTimeout(() => setSaveMessage(""), 5000);
  };

  // --- Download PDF ---
  const handleDownloadPdf = async () => {
    if (!planId) return;
    setDownloadingPdf(true);
    try {
      const blob = await api.getBlob(`/api/treatment-plans/${planId}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `treatment_plan_${planId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF download failed:", err);
      setSaveMessage("Failed to download PDF");
    } finally {
      setDownloadingPdf(false);
    }
  };

  // --- AI Update ---
  const handleAiUpdate = async () => {
    if (!planId || !plan) return;
    if (
      !window.confirm(
        "Update this treatment plan? AI will generate a new version incorporating all encounters and notes since the last update. The current version will be preserved."
      )
    )
      return;

    setUpdatingPlan(true);
    try {
      const result = await api.post<{
        plan_id: string;
        status: string;
        action: string;
        previous_plan_id: string;
      }>(`/api/treatment-plans/update/${planId}`, {});
      navigate(`/treatment-plans/${result.plan_id}`);
    } catch (err: any) {
      console.error("AI update failed:", err);
      setSaveMessage(err.message || "Failed to update plan");
    } finally {
      setUpdatingPlan(false);
    }
  };

  // --- Loading/Error states ---
  if (loading) {
    return (
      <div className="px-8 py-8 max-w-6xl">
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="px-8 py-8 max-w-6xl">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-warm-500 hover:text-warm-700 transition-colors mb-6"
        >
          <BackArrowIcon />
          Back to Dashboard
        </Link>
        <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-8 text-center">
          <p className="text-warm-500">{error || "Treatment plan not found."}</p>
        </div>
      </div>
    );
  }

  const isEditable = plan.status === "draft" || plan.status === "review";
  const isSigned = plan.status === "signed";
  const clientName =
    plan.client?.preferred_name ||
    plan.client?.full_name ||
    plan.client?.email ||
    "Unknown Client";

  return (
    <div className="px-8 py-8 max-w-6xl">
      {/* Back link */}
      <div className="flex items-center gap-3 mb-6">
        {plan.client_uuid ? (
          <Link
            to={`/clients/${plan.client_uuid}`}
            className="inline-flex items-center gap-1 text-sm text-warm-500 hover:text-warm-700 transition-colors"
          >
            <BackArrowIcon />
            Back to {clientName}
          </Link>
        ) : (
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1 text-sm text-warm-500 hover:text-warm-700 transition-colors"
          >
            <BackArrowIcon />
            Back to Dashboard
          </Link>
        )}
      </div>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="font-display text-xl font-bold text-warm-800">
                Treatment Plan
              </h1>
              <span className="text-sm text-warm-400 font-mono">v{plan.version}</span>
              <span
                className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize border ${
                  STATUS_STYLES[plan.status] || ""
                }`}
              >
                {plan.status}
              </span>
            </div>
            <p className="text-sm text-warm-500">
              {clientName} &middot; Created {formatDateTime(plan.created_at)}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {saveMessage && (
              <span
                className={`text-sm font-medium ${
                  saveMessage.includes("fail") || saveMessage.includes("Failed")
                    ? "text-red-600"
                    : "text-teal-600"
                }`}
              >
                {saveMessage}
              </span>
            )}

            <button
              onClick={() => setShowVersions(!showVersions)}
              className="px-3 py-2 text-sm font-medium text-warm-600 bg-warm-50 rounded-lg hover:bg-warm-100 transition-colors"
            >
              {showVersions ? "Hide Versions" : `Versions (${plan.versions?.length || 0})`}
            </button>

            {/* Signed plan actions */}
            {isSigned && (
              <>
                {plan.has_pdf && (
                  <button
                    onClick={handleDownloadPdf}
                    disabled={downloadingPdf}
                    className="px-3 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <DownloadIcon />
                    {downloadingPdf ? "Downloading..." : "Download PDF"}
                  </button>
                )}
                <button
                  onClick={handleAiUpdate}
                  disabled={updatingPlan}
                  className="px-3 py-2 text-sm font-medium text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors disabled:opacity-50"
                >
                  {updatingPlan ? "Updating..." : "Update Plan (AI)"}
                </button>
              </>
            )}

            {/* Draft/review actions */}
            {isEditable && (
              <>
                <button
                  onClick={handleAiUpdate}
                  disabled={updatingPlan}
                  className="px-3 py-2 text-sm font-medium text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors disabled:opacity-50"
                >
                  {updatingPlan ? "Updating..." : "Regenerate (AI)"}
                </button>

                <button
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>

                {plan.status === "draft" && (
                  <button
                    onClick={handleMarkReview}
                    disabled={saving}
                    className="px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
                  >
                    Ready for Review
                  </button>
                )}

                {plan.status === "review" && (
                  <button
                    onClick={handleBackToDraft}
                    disabled={saving}
                    className="px-3 py-2 text-sm font-medium text-warm-600 bg-warm-50 rounded-lg hover:bg-warm-100 transition-colors disabled:opacity-50"
                  >
                    Back to Draft
                  </button>
                )}

                <button
                  onClick={handleOpenSign}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-bold text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <SignIcon />
                  Sign Plan
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Signed plan info banner */}
      {isSigned && (
        <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5 mb-6">
          <div className="flex items-start gap-4">
            {plan.signature_data && (
              <div className="flex-shrink-0">
                <img
                  src={plan.signature_data}
                  alt="Clinician signature"
                  className="h-16 object-contain bg-white rounded-lg border border-teal-200 px-3 py-1"
                />
              </div>
            )}
            <div className="flex-1">
              <p className="text-sm font-semibold text-teal-800">
                Treatment Plan Signed
              </p>
              <p className="text-sm text-teal-700 mt-0.5">
                Signed by {plan.signed_by} on {formatDateTime(plan.signed_at)}
              </p>
              {plan.content_hash && (
                <p className="text-xs text-teal-600 mt-1 font-mono">
                  Content Hash: {plan.content_hash.slice(0, 16)}...
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Version history panel */}
      {showVersions && plan.versions && plan.versions.length > 0 && (
        <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-6 mb-6">
          <h3 className="text-sm font-semibold text-warm-700 mb-3 flex items-center gap-2">
            <VersionIcon />
            Version History
          </h3>
          <div className="space-y-2">
            {plan.versions.map((v) => (
              <div
                key={v.id}
                className={`flex items-center justify-between py-2 px-3 rounded-lg ${
                  v.id === plan.id ? "bg-teal-50" : "hover:bg-warm-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs text-warm-400 font-mono w-8">
                    v{v.version}
                  </span>
                  <div>
                    {v.id === plan.id ? (
                      <span className="text-sm font-medium text-teal-700">
                        Current Version
                      </span>
                    ) : (
                      <Link
                        to={`/treatment-plans/${v.id}`}
                        className="text-sm text-teal-600 hover:text-teal-800 underline"
                      >
                        View Version {v.version}
                      </Link>
                    )}
                    <p className="text-xs text-warm-400">
                      {formatDateTime(v.created_at)}
                      {v.signed_at ? ` - Signed ${formatDate(v.signed_at)}` : ""}
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${
                    STATUS_STYLES[v.status] || ""
                  }`}
                >
                  {v.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="space-y-6">
        {/* Diagnoses */}
        <div className="bg-white rounded-2xl border border-warm-100 shadow-sm overflow-hidden">
          <div className="px-6 py-3 bg-warm-50 border-b border-warm-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-warm-700">
              Diagnoses (ICD-10)
            </h3>
            {isEditable && (
              <button
                onClick={addDiagnosis}
                className="px-2.5 py-1 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
              >
                + Add Diagnosis
              </button>
            )}
          </div>
          <div className="p-6">
            {diagnoses.length === 0 ? (
              <p className="text-sm text-warm-400 italic">No diagnoses added yet.</p>
            ) : (
              <div className="space-y-3">
                {diagnoses.map((dx, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-lg bg-warm-50/50"
                  >
                    <span className="text-xs text-warm-400 font-mono w-6 pt-2">
                      {dx.rank}.
                    </span>
                    <div className="flex-1 grid sm:grid-cols-4 gap-2">
                      <input
                        type="text"
                        value={dx.code}
                        onChange={(e) => updateDiagnosis(i, "code", e.target.value)}
                        placeholder="ICD-10 Code"
                        disabled={!isEditable}
                        className="px-3 py-2 text-sm border border-warm-200 rounded-lg focus:ring-2 focus:ring-teal-200 focus:border-teal-400 outline-none disabled:bg-warm-50 disabled:text-warm-500 font-mono"
                      />
                      <input
                        type="text"
                        value={dx.description}
                        onChange={(e) => updateDiagnosis(i, "description", e.target.value)}
                        placeholder="Diagnosis description"
                        disabled={!isEditable}
                        className="sm:col-span-2 px-3 py-2 text-sm border border-warm-200 rounded-lg focus:ring-2 focus:ring-teal-200 focus:border-teal-400 outline-none disabled:bg-warm-50 disabled:text-warm-500"
                      />
                      <select
                        value={dx.type}
                        onChange={(e) => updateDiagnosis(i, "type", e.target.value)}
                        disabled={!isEditable}
                        className="px-3 py-2 text-sm border border-warm-200 rounded-lg focus:ring-2 focus:ring-teal-200 focus:border-teal-400 outline-none disabled:bg-warm-50 disabled:text-warm-500"
                      >
                        {DIAGNOSIS_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {isEditable && (
                      <button
                        onClick={() => removeDiagnosis(i)}
                        className="text-warm-400 hover:text-red-500 transition-colors pt-2"
                        title="Remove diagnosis"
                      >
                        <RemoveIcon />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Presenting Problems */}
        <div className="bg-white rounded-2xl border border-warm-100 shadow-sm overflow-hidden">
          <div className="px-6 py-3 bg-warm-50 border-b border-warm-100">
            <h3 className="text-sm font-semibold text-warm-700">
              Presenting Problems
            </h3>
          </div>
          <div className="p-6">
            <SectionEditor
              content={presentingProblems}
              onChange={(html) => {
                setPresentingProblems(html);
                markChanged();
              }}
              placeholder="Enter presenting problems and clinical formulation..."
              readOnly={!isEditable}
            />
          </div>
        </div>

        {/* Goals & Objectives */}
        <div className="bg-white rounded-2xl border border-warm-100 shadow-sm overflow-hidden">
          <div className="px-6 py-3 bg-warm-50 border-b border-warm-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-warm-700">
              Treatment Goals & Objectives
            </h3>
            {isEditable && (
              <button
                onClick={addGoal}
                className="px-2.5 py-1 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
              >
                + Add Goal
              </button>
            )}
          </div>
          <div className="p-6">
            {goals.length === 0 ? (
              <p className="text-sm text-warm-400 italic">No goals defined yet.</p>
            ) : (
              <div className="space-y-6">
                {goals.map((goal, gi) => (
                  <div
                    key={goal.id || gi}
                    className="border border-warm-200 rounded-xl overflow-hidden"
                  >
                    {/* Goal header */}
                    <div className="px-4 py-3 bg-warm-50 border-b border-warm-200">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-warm-500">
                              GOAL {gi + 1}
                            </span>
                            <select
                              value={goal.status}
                              onChange={(e) => updateGoal(gi, "status", e.target.value)}
                              disabled={!isEditable}
                              className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                                goal.status === "met"
                                  ? "bg-teal-50 text-teal-700 border-teal-200"
                                  : goal.status === "active"
                                    ? "bg-blue-50 text-blue-700 border-blue-200"
                                    : goal.status === "deferred"
                                      ? "bg-warm-100 text-warm-500 border-warm-200"
                                      : "bg-amber-50 text-amber-700 border-amber-200"
                              } disabled:cursor-default`}
                            >
                              {GOAL_STATUS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <textarea
                            value={goal.description}
                            onChange={(e) => updateGoal(gi, "description", e.target.value)}
                            placeholder="Goal description..."
                            disabled={!isEditable}
                            rows={2}
                            className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:ring-2 focus:ring-teal-200 focus:border-teal-400 outline-none disabled:bg-warm-50 disabled:text-warm-500 resize-none"
                          />
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-warm-400">Target Date:</label>
                            <input
                              type="date"
                              value={goal.target_date}
                              onChange={(e) => updateGoal(gi, "target_date", e.target.value)}
                              disabled={!isEditable}
                              className="px-2 py-1 text-xs border border-warm-200 rounded-lg focus:ring-2 focus:ring-teal-200 focus:border-teal-400 outline-none disabled:bg-warm-50 disabled:text-warm-500"
                            />
                          </div>
                        </div>
                        {isEditable && (
                          <button
                            onClick={() => removeGoal(gi)}
                            className="text-warm-400 hover:text-red-500 transition-colors"
                            title="Remove goal"
                          >
                            <RemoveIcon />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Objectives */}
                    <div className="px-4 py-3 border-b border-warm-100">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-warm-500 uppercase tracking-wide">
                          Objectives
                        </span>
                        {isEditable && (
                          <button
                            onClick={() => addObjective(gi)}
                            className="px-2 py-0.5 text-xs text-teal-600 hover:bg-teal-50 rounded transition-colors"
                          >
                            + Add
                          </button>
                        )}
                      </div>
                      {goal.objectives.length === 0 ? (
                        <p className="text-xs text-warm-400 italic">No objectives defined.</p>
                      ) : (
                        <div className="space-y-2">
                          {goal.objectives.map((obj, oi) => (
                            <div
                              key={obj.id || oi}
                              className="flex items-start gap-2"
                            >
                              <span className="text-xs text-warm-400 font-mono pt-2 w-8">
                                {gi + 1}.{oi + 1}
                              </span>
                              <textarea
                                value={obj.description}
                                onChange={(e) => updateObjective(gi, oi, "description", e.target.value)}
                                placeholder="Measurable objective..."
                                disabled={!isEditable}
                                rows={2}
                                className="flex-1 px-3 py-2 text-sm border border-warm-200 rounded-lg focus:ring-2 focus:ring-teal-200 focus:border-teal-400 outline-none disabled:bg-warm-50 disabled:text-warm-500 resize-none"
                              />
                              <select
                                value={obj.status}
                                onChange={(e) => updateObjective(gi, oi, "status", e.target.value)}
                                disabled={!isEditable}
                                className="text-xs px-2 py-1 border border-warm-200 rounded-lg disabled:bg-warm-50 disabled:text-warm-500"
                              >
                                {OBJECTIVE_STATUS_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              {isEditable && (
                                <button
                                  onClick={() => removeObjective(gi, oi)}
                                  className="text-warm-400 hover:text-red-500 transition-colors pt-2"
                                  title="Remove objective"
                                >
                                  <RemoveIcon />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Interventions */}
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-warm-500 uppercase tracking-wide">
                          Interventions
                        </span>
                        {isEditable && (
                          <button
                            onClick={() => addIntervention(gi)}
                            className="px-2 py-0.5 text-xs text-teal-600 hover:bg-teal-50 rounded transition-colors"
                          >
                            + Add
                          </button>
                        )}
                      </div>
                      {goal.interventions.length === 0 ? (
                        <p className="text-xs text-warm-400 italic">No interventions defined.</p>
                      ) : (
                        <div className="space-y-2">
                          {goal.interventions.map((inv, ii) => (
                            <div key={ii} className="flex items-start gap-2">
                              <span className="text-warm-400 pt-2">-</span>
                              <textarea
                                value={inv}
                                onChange={(e) => updateIntervention(gi, ii, e.target.value)}
                                placeholder="Evidence-based intervention..."
                                disabled={!isEditable}
                                rows={2}
                                className="flex-1 px-3 py-2 text-sm border border-warm-200 rounded-lg focus:ring-2 focus:ring-teal-200 focus:border-teal-400 outline-none disabled:bg-warm-50 disabled:text-warm-500 resize-none"
                              />
                              {isEditable && (
                                <button
                                  onClick={() => removeIntervention(gi, ii)}
                                  className="text-warm-400 hover:text-red-500 transition-colors pt-2"
                                  title="Remove intervention"
                                >
                                  <RemoveIcon />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Review Schedule */}
        <div className="bg-white rounded-2xl border border-warm-100 shadow-sm overflow-hidden">
          <div className="px-6 py-3 bg-warm-50 border-b border-warm-100">
            <h3 className="text-sm font-semibold text-warm-700">
              Review Schedule
            </h3>
          </div>
          <div className="p-6">
            <div className="flex items-center gap-4">
              <label className="text-sm text-warm-600">
                Next Review Date:
              </label>
              <input
                type="date"
                value={reviewDate}
                onChange={(e) => {
                  setReviewDate(e.target.value);
                  markChanged();
                }}
                disabled={!isEditable}
                className="px-3 py-2 text-sm border border-warm-200 rounded-lg focus:ring-2 focus:ring-teal-200 focus:border-teal-400 outline-none disabled:bg-warm-50 disabled:text-warm-500"
              />
            </div>
          </div>
        </div>

        {/* Metadata footer */}
        <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-warm-400 text-xs uppercase tracking-wide mb-1">
                Created
              </p>
              <p className="text-warm-700">{formatDateTime(plan.created_at)}</p>
            </div>
            <div>
              <p className="text-warm-400 text-xs uppercase tracking-wide mb-1">
                Updated
              </p>
              <p className="text-warm-700">{formatDateTime(plan.updated_at)}</p>
            </div>
            <div>
              <p className="text-warm-400 text-xs uppercase tracking-wide mb-1">
                Version
              </p>
              <p className="text-warm-700">v{plan.version}</p>
            </div>
            <div>
              <p className="text-warm-400 text-xs uppercase tracking-wide mb-1">
                Review Date
              </p>
              <p className="text-warm-700">{plan.review_date ? formatDate(plan.review_date) : "Not set"}</p>
            </div>
          </div>
          {plan.signed_at && (
            <div className="mt-4 pt-4 border-t border-warm-100">
              <p className="text-sm text-teal-700">
                Signed by {plan.signed_by} on {formatDateTime(plan.signed_at)}
              </p>
              {plan.content_hash && (
                <p className="text-xs text-warm-400 font-mono mt-1">
                  SHA-256: {plan.content_hash}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Signing modal - reuse the note signing modal pattern but call treatment plan sign endpoint */}
      {showSigningModal && planId && (
        <TreatmentPlanSigningModal
          planId={planId}
          onSigned={handleSigned}
          onCancel={() => setShowSigningModal(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Treatment Plan Signing Modal (adapted from NoteSigningModal)
// ---------------------------------------------------------------------------

function TreatmentPlanSigningModal({
  planId,
  onSigned,
  onCancel,
}: {
  planId: string;
  onSigned: (result: {
    signed_by: string;
    signed_at: string;
    content_hash: string;
  }) => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const [storedSignature, setStoredSignature] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Dynamically import signing components
  const [SignatureCanvas, setSignatureCanvas] = useState<any>(null);
  const [SignatureConfirm, setSignatureConfirm] = useState<any>(null);
  const [useStored, setUseStored] = useState(true);

  useEffect(() => {
    // Load signature components
    import("../components/signing/SignatureCanvas").then((mod) =>
      setSignatureCanvas(() => mod.SignatureCanvas)
    );
    import("../components/signing/SignatureConfirm").then((mod) =>
      setSignatureConfirm(() => mod.SignatureConfirm)
    );
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.get<{ signature: string | null }>(
          "/api/treatment-plans/signing/signature"
        );
        setStoredSignature(data.signature);
      } catch {
        // No stored signature
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api]);

  const handleSign = async (signatureData: string) => {
    setSigning(true);
    setError("");
    try {
      const result = await api.post<{
        status: string;
        plan_id: string;
        signed_by: string;
        signed_at: string;
        content_hash: string;
        pdf_generated: boolean;
      }>(`/api/treatment-plans/${planId}/sign`, {
        signature_data: signatureData,
      });

      onSigned({
        signed_by: result.signed_by,
        signed_at: result.signed_at,
        content_hash: result.content_hash,
      });
    } catch (err: any) {
      setError(err.message || "Failed to sign treatment plan");
      setSigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-warm-100">
          <h2 className="font-display text-lg font-bold text-warm-800">
            Sign Treatment Plan
          </h2>
          <p className="text-sm text-warm-500 mt-1">
            Signing this treatment plan will lock it permanently. Updates will
            create a new version.
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5">
            <p className="text-sm text-amber-800">
              <strong>Important:</strong> Once signed, this treatment plan
              cannot be edited. To make changes, use "Update Plan" to create a
              new version.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {loading || !SignatureCanvas || !SignatureConfirm ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
            </div>
          ) : storedSignature && useStored ? (
            <SignatureConfirm
              signaturePng={storedSignature}
              onConfirm={() => handleSign(storedSignature)}
              onDrawNew={() => setUseStored(false)}
              disabled={signing}
            />
          ) : (
            <SignatureCanvas onSign={handleSign} disabled={signing} />
          )}

          {signing && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <div className="w-4 h-4 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
              <span className="text-sm text-warm-500">
                Signing treatment plan and generating PDF...
              </span>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-warm-100 flex justify-end">
          <button
            onClick={onCancel}
            disabled={signing}
            className="px-4 py-2 text-sm font-medium text-warm-600 hover:bg-warm-100 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BackArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path
        fillRule="evenodd"
        d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function SignIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path
        fillRule="evenodd"
        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
      <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM6.75 9.25a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function VersionIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-warm-400">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z"
        clipRule="evenodd"
      />
    </svg>
  );
}
