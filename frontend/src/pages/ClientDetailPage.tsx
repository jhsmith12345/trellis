import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { Appointment } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClientDetail {
  id: string;
  firebase_uid: string;
  email: string;
  full_name: string | null;
  preferred_name: string | null;
  pronouns: string | null;
  date_of_birth: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  payer_name: string | null;
  member_id: string | null;
  group_number: string | null;
  insurance_data: Record<string, unknown> | null;
  status: "active" | "discharged" | "inactive";
  intake_completed_at: string | null;
  documents_completed_at: string | null;
  discharged_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DocStatus {
  total: number;
  signed: number;
  pending: number;
  packages: {
    package_id: string;
    status: string;
    total: number;
    signed: number;
    pending: number;
    created_at: string;
  }[];
}

interface Encounter {
  id: string;
  client_id: string;
  clinician_id: string | null;
  type: string;
  source: string;
  transcript: string;
  data: Record<string, unknown> | null;
  duration_sec: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ClinicalNote {
  id: string;
  encounter_id: string;
  format: string;
  content: Record<string, unknown>;
  flags: unknown[];
  signed_by: string | null;
  signed_at: string | null;
  status: string;
  encounter_type: string;
  encounter_source: string;
  created_at: string;
  updated_at: string;
}

interface TreatmentPlan {
  exists: boolean;
  id?: string;
  client_id?: string;
  version?: number;
  diagnoses?: { code: string; description: string; rank: number }[];
  goals?: { id: string; description: string; objectives: unknown[]; interventions: unknown[] }[];
  presenting_problems?: string | null;
  review_date?: string | null;
  status?: string;
  signed_by?: string | null;
  signed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface SuperbillItem {
  id: string;
  date_of_service: string | null;
  cpt_code: string;
  cpt_description: string | null;
  diagnosis_codes: { code: string; description: string }[];
  fee: number | null;
  amount_paid: number;
  status: string;
  has_pdf: boolean;
  created_at: string;
}

interface SuperbillsResponse {
  superbills: SuperbillItem[];
  count: number;
  client_balance: {
    total_billed: number;
    total_paid: number;
    outstanding: number;
  };
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

const STATUS_STYLES: Record<string, string> = {
  active: "bg-teal-50 text-teal-700",
  discharged: "bg-warm-100 text-warm-500",
  inactive: "bg-amber-50 text-amber-700",
};

const NOTE_STATUS_STYLES: Record<string, string> = {
  draft: "bg-amber-50 text-amber-700",
  review: "bg-blue-50 text-blue-700",
  signed: "bg-teal-50 text-teal-700",
  amended: "bg-purple-50 text-purple-700",
};

const APPT_STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-blue-50 text-blue-700",
  completed: "bg-teal-50 text-teal-700",
  cancelled: "bg-warm-100 text-warm-500",
  no_show: "bg-red-50 text-red-700",
  released: "bg-amber-50 text-amber-700",
};

const ENCOUNTER_TYPE_LABELS: Record<string, string> = {
  intake: "Intake",
  portal: "Portal",
  clinical: "Clinical",
  group: "Group",
};

const ENCOUNTER_SOURCE_LABELS: Record<string, string> = {
  voice: "Voice",
  form: "Form",
  chat: "Chat",
  clinician: "Clinician",
};

const SUPERBILL_STATUS_STYLES: Record<string, string> = {
  generated: "bg-blue-50 text-blue-700",
  submitted: "bg-amber-50 text-amber-700",
  paid: "bg-teal-50 text-teal-700",
  outstanding: "bg-red-50 text-red-700",
};

const APPT_TYPE_LABELS: Record<string, string> = {
  assessment: "Assessment (90791)",
  individual: "Individual (90834)",
  individual_extended: "Individual Extended (90837)",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClientDetailPage() {
  const { clientId } = useParams();
  const api = useApi();
  const navigate = useNavigate();

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [docStatus, setDocStatus] = useState<DocStatus | null>(null);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [notes, setNotes] = useState<ClinicalNote[]>([]);
  const [treatmentPlan, setTreatmentPlan] = useState<TreatmentPlan | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingNoteFor, setGeneratingNoteFor] = useState<string | null>(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [superbills, setSuperbills] = useState<SuperbillItem[]>([]);
  const [downloadingSuperbill, setDownloadingSuperbill] = useState<string | null>(null);

  // Discharge workflow state
  const [showDischargeModal, setShowDischargeModal] = useState(false);
  const [dischargeStatus, setDischargeStatus] = useState<{
    can_discharge: boolean;
    unsigned_note_count: number;
    future_appointment_count: number;
    recurring_series_count: number;
    completed_sessions: number;
    has_treatment_plan: boolean;
  } | null>(null);
  const [dischargeLoading, setDischargeLoading] = useState(false);
  const [dischargeProcessing, setDischargeProcessing] = useState(false);
  const [dischargeReason, setDischargeReason] = useState("");
  const [dischargeStep, setDischargeStep] = useState<
    "confirm" | "processing" | "complete"
  >("confirm");
  const [dischargeResult, setDischargeResult] = useState<{
    note_id: string;
    cancelled_appointments: number;
    ended_series: number;
    completed_sessions: number;
  } | null>(null);

  useEffect(() => {
    async function load() {
      if (!clientId) return;
      try {
        // Load all data in parallel
        const [clientData, encounterData, noteData, planData, apptData] =
          await Promise.all([
            api.get<ClientDetail>(`/api/clients/${clientId}`),
            api.get<{ encounters: Encounter[] }>(`/api/clients/${clientId}/encounters`),
            api.get<{ notes: ClinicalNote[] }>(`/api/clients/${clientId}/notes`),
            api.get<TreatmentPlan>(`/api/clients/${clientId}/treatment-plan`),
            api.get<{ appointments: Appointment[] }>(`/api/clients/${clientId}/appointments`),
          ]);

        setClient(clientData);
        setEncounters(encounterData.encounters);
        setNotes(noteData.notes);
        setTreatmentPlan(planData);
        setAppointments(apptData.appointments);

        // Load superbills for this client
        try {
          const sbData = await api.get<SuperbillsResponse>(
            `/api/superbills/client/${clientId}`
          );
          setSuperbills(sbData.superbills);
        } catch {
          // Non-critical
        }

        // Load doc status using firebase_uid
        if (clientData.firebase_uid) {
          try {
            const status = await api.get<DocStatus>(
              `/api/documents/status/${clientData.firebase_uid}`
            );
            setDocStatus(status);
          } catch {
            // Non-critical
          }
        }
      } catch (err) {
        console.error("Failed to load client detail:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api, clientId]);

  async function handleGenerateNote(encounterId: string) {
    setGeneratingNoteFor(encounterId);
    try {
      const result = await api.post<{
        note_id: string;
        format: string;
        content: Record<string, string>;
        status: string;
      }>("/api/notes/generate", { encounter_id: encounterId });
      // Navigate to the note editor
      navigate(`/notes/${result.note_id}`);
    } catch (err) {
      console.error("Note generation failed:", err);
      alert("Note generation failed. Please try again.");
    } finally {
      setGeneratingNoteFor(null);
    }
  }

  async function handleGeneratePlan() {
    if (!client) return;
    setGeneratingPlan(true);
    try {
      const result = await api.post<{
        plan_id: string;
        status: string;
        action: string;
        plan: TreatmentPlan;
      }>("/api/treatment-plans/generate", {
        client_id: client.firebase_uid,
      });
      navigate(`/treatment-plans/${result.plan_id}`);
    } catch (err: any) {
      console.error("Treatment plan generation failed:", err);
      alert(err.message || "Treatment plan generation failed. Please try again.");
    } finally {
      setGeneratingPlan(false);
    }
  }

  async function handleUpdatePlan() {
    if (!treatmentPlan || !treatmentPlan.id) return;
    setGeneratingPlan(true);
    try {
      const result = await api.post<{
        plan_id: string;
        status: string;
        action: string;
      }>(`/api/treatment-plans/update/${treatmentPlan.id}`, {});
      navigate(`/treatment-plans/${result.plan_id}`);
    } catch (err: any) {
      console.error("Treatment plan update failed:", err);
      alert(err.message || "Treatment plan update failed. Please try again.");
    } finally {
      setGeneratingPlan(false);
    }
  }

  async function handleDownloadSuperbill(superbillId: string) {
    setDownloadingSuperbill(superbillId);
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
      console.error("Failed to download superbill:", err);
      alert("Failed to download superbill PDF.");
    } finally {
      setDownloadingSuperbill(null);
    }
  }

  async function handleDischargeClick() {
    if (!clientId) return;
    setShowDischargeModal(true);
    setDischargeStep("confirm");
    setDischargeReason("");
    setDischargeResult(null);
    setDischargeLoading(true);
    try {
      const status = await api.get<{
        can_discharge: boolean;
        unsigned_note_count: number;
        future_appointment_count: number;
        recurring_series_count: number;
        completed_sessions: number;
        has_treatment_plan: boolean;
      }>(`/api/clients/${clientId}/discharge-status`);
      setDischargeStatus(status);
    } catch (err) {
      console.error("Failed to fetch discharge status:", err);
    } finally {
      setDischargeLoading(false);
    }
  }

  async function handleConfirmDischarge() {
    if (!clientId) return;
    setDischargeProcessing(true);
    setDischargeStep("processing");
    try {
      const result = await api.post<{
        status: string;
        note_id: string;
        cancelled_appointments: number;
        ended_series: number;
        completed_sessions: number;
      }>(`/api/clients/${clientId}/discharge`, {
        reason: dischargeReason || null,
      });
      setDischargeResult(result);
      setDischargeStep("complete");
      // Update local client state
      if (client) {
        setClient({
          ...client,
          status: "discharged",
          discharged_at: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      console.error("Discharge failed:", err);
      alert(err.message || "Discharge failed. Please try again.");
      setDischargeStep("confirm");
    } finally {
      setDischargeProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-5xl">
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="px-8 py-8 max-w-5xl">
        <Link
          to="/clients"
          className="inline-flex items-center gap-1 text-sm text-warm-500 hover:text-warm-700 transition-colors mb-6"
        >
          <BackArrowIcon />
          Back to Clients
        </Link>
        <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-8 text-center">
          <p className="text-warm-500">Client not found.</p>
        </div>
      </div>
    );
  }

  const now = new Date();
  const upcomingAppts = appointments.filter(
    (a) => a.status === "scheduled" && new Date(a.scheduled_at) > now
  );
  const pastAppts = appointments.filter(
    (a) => a.status !== "scheduled" || new Date(a.scheduled_at) <= now
  );

  const address = [
    client.address_line1,
    client.address_line2,
    [client.address_city, client.address_state].filter(Boolean).join(", "),
    client.address_zip,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="px-8 py-8 max-w-5xl">
      {/* Back Link */}
      <Link
        to="/clients"
        className="inline-flex items-center gap-1 text-sm text-warm-500 hover:text-warm-700 transition-colors mb-6"
      >
        <BackArrowIcon />
        Back to Clients
      </Link>

      {/* ----------------------------------------------------------------- */}
      {/* Client Info Header */}
      {/* ----------------------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 bg-teal-50 rounded-full flex items-center justify-center shrink-0">
              <span className="text-xl font-bold text-teal-600">
                {(client.full_name || client.email || "?").charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-display text-xl font-bold text-warm-800">
                  {client.full_name || client.email}
                </h1>
                <span
                  className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                    STATUS_STYLES[client.status] || ""
                  }`}
                >
                  {client.status}
                </span>
              </div>
              {client.preferred_name && (
                <p className="text-sm text-warm-500 mt-0.5">
                  Goes by "{client.preferred_name}"
                  {client.pronouns ? ` (${client.pronouns})` : ""}
                </p>
              )}
              {!client.preferred_name && client.pronouns && (
                <p className="text-sm text-warm-500 mt-0.5">{client.pronouns}</p>
              )}
            </div>
          </div>
          {/* Discharge button */}
          {client.status !== "discharged" ? (
            <button
              onClick={handleDischargeClick}
              className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
            >
              Discharge Client
            </button>
          ) : (
            <span className="px-4 py-2 text-sm font-medium text-warm-400 bg-warm-50 border border-warm-200 rounded-lg">
              Discharged {client.discharged_at ? formatDate(client.discharged_at) : ""}
            </span>
          )}
        </div>

        {/* Contact + Insurance Grid */}
        <div className="grid md:grid-cols-3 gap-6 mt-6 pt-6 border-t border-warm-100">
          {/* Contact */}
          <div>
            <h3 className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-2">
              Contact
            </h3>
            <div className="space-y-1 text-sm">
              <p className="text-warm-700">{client.email}</p>
              <p className="text-warm-600">{client.phone || "No phone"}</p>
              {client.date_of_birth && (
                <p className="text-warm-500">DOB: {formatDate(client.date_of_birth)}</p>
              )}
              {address && <p className="text-warm-500">{address}</p>}
            </div>
          </div>

          {/* Insurance */}
          <div>
            <h3 className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-2">
              Insurance
            </h3>
            <div className="space-y-1 text-sm">
              <p className="text-warm-700 font-medium">
                {client.payer_name || "Self-pay"}
              </p>
              {client.member_id && (
                <p className="text-warm-500">Member ID: {client.member_id}</p>
              )}
              {client.group_number && (
                <p className="text-warm-500">Group: {client.group_number}</p>
              )}
            </div>
          </div>

          {/* Emergency Contact */}
          <div>
            <h3 className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-2">
              Emergency Contact
            </h3>
            <div className="space-y-1 text-sm">
              {client.emergency_contact_name ? (
                <>
                  <p className="text-warm-700">{client.emergency_contact_name}</p>
                  <p className="text-warm-500">
                    {client.emergency_contact_relationship || "Relationship N/A"}
                  </p>
                  <p className="text-warm-500">
                    {client.emergency_contact_phone || "No phone"}
                  </p>
                </>
              ) : (
                <p className="text-warm-400">Not provided</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Two-column layout for sections */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* ----------------------------------------------------------------- */}
        {/* Consent Documents */}
        {/* ----------------------------------------------------------------- */}
        <SectionCard
          title="Consent Documents"
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <path
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
        >
          {docStatus && docStatus.total > 0 ? (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 bg-warm-100 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      docStatus.signed === docStatus.total
                        ? "bg-teal-500"
                        : docStatus.signed > 0
                          ? "bg-amber-400"
                          : "bg-red-400"
                    }`}
                    style={{
                      width: `${(docStatus.signed / docStatus.total) * 100}%`,
                    }}
                  />
                </div>
                <span
                  className={`text-sm font-semibold ${
                    docStatus.signed === docStatus.total
                      ? "text-teal-700"
                      : docStatus.signed > 0
                        ? "text-amber-700"
                        : "text-red-700"
                  }`}
                >
                  {docStatus.signed}/{docStatus.total} signed
                </span>
              </div>
              {docStatus.packages.map((pkg) => (
                <div
                  key={pkg.package_id}
                  className="flex items-center justify-between py-3 border-t border-warm-100"
                >
                  <div>
                    <p className="text-sm font-medium text-warm-700">
                      Document Package
                    </p>
                    <p className="text-xs text-warm-400">
                      Created {formatDate(pkg.created_at)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      pkg.status === "completed"
                        ? "bg-teal-50 text-teal-700"
                        : pkg.status === "partially_signed"
                          ? "bg-amber-50 text-amber-700"
                          : pkg.status === "sent"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-warm-50 text-warm-500"
                    }`}
                  >
                    {pkg.status === "completed"
                      ? "All Signed"
                      : pkg.status === "partially_signed"
                        ? `${pkg.signed}/${pkg.total} signed`
                        : pkg.status === "sent"
                          ? "Awaiting signature"
                          : pkg.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No document packages created yet." />
          )}
        </SectionCard>

        {/* ----------------------------------------------------------------- */}
        {/* Treatment Plan */}
        {/* ----------------------------------------------------------------- */}
        <SectionCard
          title="Treatment Plan"
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <path
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9 14l2 2 4-4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
        >
          {treatmentPlan && treatmentPlan.exists ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span
                  className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                    NOTE_STATUS_STYLES[treatmentPlan.status || "draft"] || ""
                  }`}
                >
                  {treatmentPlan.status}
                </span>
                <span className="text-xs text-warm-400">
                  v{treatmentPlan.version}
                </span>
              </div>

              {treatmentPlan.diagnoses && treatmentPlan.diagnoses.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-1">
                    Diagnoses
                  </p>
                  <div className="space-y-1">
                    {treatmentPlan.diagnoses.map((dx, i) => (
                      <p key={i} className="text-sm text-warm-700">
                        <span className="font-mono text-warm-500 text-xs">
                          {dx.code}
                        </span>{" "}
                        {dx.description}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {treatmentPlan.goals && treatmentPlan.goals.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-1">
                    Goals
                  </p>
                  <p className="text-sm text-warm-600">
                    {treatmentPlan.goals.length} goal
                    {treatmentPlan.goals.length !== 1 ? "s" : ""} defined
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-warm-400 pt-2 border-t border-warm-100">
                <span>Updated {formatDate(treatmentPlan.updated_at)}</span>
                {treatmentPlan.review_date && (
                  <span>Review by {formatDate(treatmentPlan.review_date)}</span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 pt-2 border-t border-warm-100">
                {treatmentPlan.id && (
                  <Link
                    to={`/treatment-plans/${treatmentPlan.id}`}
                    className="px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
                  >
                    Open in Editor
                  </Link>
                )}
                <button
                  onClick={handleUpdatePlan}
                  disabled={generatingPlan}
                  className="px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors disabled:opacity-50"
                >
                  {generatingPlan ? "Updating..." : "Update Plan (AI)"}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <EmptyState text="No treatment plan created yet." />
              <div className="flex justify-center mt-2">
                <button
                  onClick={handleGeneratePlan}
                  disabled={generatingPlan}
                  className="px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors disabled:opacity-50"
                >
                  {generatingPlan ? "Generating..." : "Generate Treatment Plan (AI)"}
                </button>
              </div>
            </div>
          )}
        </SectionCard>

        {/* ----------------------------------------------------------------- */}
        {/* Encounters */}
        {/* ----------------------------------------------------------------- */}
        <SectionCard
          title="Encounters"
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <path
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
          badge={encounters.length > 0 ? String(encounters.length) : undefined}
        >
          {encounters.length > 0 ? (
            <div className="divide-y divide-warm-100">
              {encounters.map((enc) => (
                <div key={enc.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-warm-50 text-warm-600 capitalize">
                        {ENCOUNTER_TYPE_LABELS[enc.type] || enc.type}
                      </span>
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-warm-50 text-warm-500 capitalize">
                        {ENCOUNTER_SOURCE_LABELS[enc.source] || enc.source}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-warm-400">
                        {formatDate(enc.created_at)}
                      </span>
                      {enc.transcript && enc.transcript.length > 0 && (
                        <button
                          onClick={() => handleGenerateNote(enc.id)}
                          disabled={generatingNoteFor === enc.id}
                          className="px-2.5 py-1 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors disabled:opacity-50"
                        >
                          {generatingNoteFor === enc.id ? "Generating..." : "Generate Note"}
                        </button>
                      )}
                    </div>
                  </div>
                  {enc.transcript && (
                    <p className="text-sm text-warm-500 line-clamp-2">
                      {enc.transcript}
                      {enc.transcript.length >= 200 ? "..." : ""}
                    </p>
                  )}
                  {enc.duration_sec && (
                    <p className="text-xs text-warm-400 mt-1">
                      Duration: {Math.round(enc.duration_sec / 60)}m
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No encounters recorded yet." />
          )}
        </SectionCard>

        {/* ----------------------------------------------------------------- */}
        {/* Clinical Notes */}
        {/* ----------------------------------------------------------------- */}
        <SectionCard
          title="Clinical Notes"
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <path
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
          badge={notes.length > 0 ? String(notes.length) : undefined}
        >
          {notes.length > 0 ? (
            <div className="divide-y divide-warm-100">
              {notes.map((note) => (
                <Link
                  key={note.id}
                  to={`/notes/${note.id}`}
                  className="py-3 first:pt-0 last:pb-0 block hover:bg-warm-50 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-warm-700">
                        {note.format === "narrative"
                          ? "Assessment"
                          : note.format === "discharge"
                            ? "Discharge Summary"
                            : note.format}{" "}
                        {note.format !== "discharge" ? "Note" : ""}
                      </span>
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                          NOTE_STATUS_STYLES[note.status] || ""
                        }`}
                      >
                        {note.status}
                      </span>
                    </div>
                    <span className="text-xs text-warm-400">
                      {formatDate(note.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-warm-400">
                      From{" "}
                      {ENCOUNTER_TYPE_LABELS[note.encounter_type] ||
                        note.encounter_type}{" "}
                      encounter
                    </span>
                    {note.signed_at && (
                      <span className="text-xs text-teal-600">
                        Signed {formatDate(note.signed_at)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-teal-600 mt-1">
                    Open in editor
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState text="No clinical notes generated yet. Generate a note from an encounter using the 'Generate Note' button." />
          )}
        </SectionCard>

        {/* ----------------------------------------------------------------- */}
        {/* Appointments */}
        {/* ----------------------------------------------------------------- */}
        <SectionCard
          title="Appointments"
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <rect
                x="3"
                y="4"
                width="18"
                height="18"
                rx="2"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M16 2v4M8 2v4M3 10h18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          }
          badge={
            appointments.length > 0 ? String(appointments.length) : undefined
          }
        >
          {appointments.length > 0 ? (
            <div>
              {/* Upcoming */}
              {upcomingAppts.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-2">
                    Upcoming
                  </p>
                  <div className="space-y-2">
                    {upcomingAppts.map((appt) => (
                      <div
                        key={appt.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-teal-50/50"
                      >
                        <div>
                          <p className="text-sm font-medium text-warm-700">
                            {APPT_TYPE_LABELS[appt.type] || appt.type}
                          </p>
                          <p className="text-xs text-warm-500">
                            {formatDateTime(appt.scheduled_at)} &middot;{" "}
                            {appt.duration_minutes}m
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {appt.meet_link && (
                            <a
                              href={appt.meet_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
                            >
                              Join Meet
                            </a>
                          )}
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                              APPT_STATUS_STYLES[appt.status] || ""
                            }`}
                          >
                            {appt.status.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Past */}
              {pastAppts.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-2">
                    Past
                  </p>
                  <div className="divide-y divide-warm-100">
                    {pastAppts.slice(0, 10).map((appt) => (
                      <div
                        key={appt.id}
                        className="flex items-center justify-between py-2"
                      >
                        <div>
                          <p className="text-sm text-warm-600">
                            {APPT_TYPE_LABELS[appt.type] || appt.type}
                          </p>
                          <p className="text-xs text-warm-400">
                            {formatDateTime(appt.scheduled_at)}
                          </p>
                        </div>
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                            APPT_STATUS_STYLES[appt.status] || ""
                          }`}
                        >
                          {appt.status.replace("_", " ")}
                        </span>
                      </div>
                    ))}
                    {pastAppts.length > 10 && (
                      <p className="text-xs text-warm-400 pt-2">
                        +{pastAppts.length - 10} more
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState text="No appointments booked yet." />
          )}
        </SectionCard>

        {/* ----------------------------------------------------------------- */}
        {/* Superbills */}
        {/* ----------------------------------------------------------------- */}
        <SectionCard
          title="Superbills"
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <path
                d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
          badge={superbills.length > 0 ? String(superbills.length) : undefined}
        >
          {superbills.length > 0 ? (
            <div className="divide-y divide-warm-100">
              {superbills.map((sb) => (
                <div key={sb.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-warm-700">
                        {formatDate(sb.date_of_service)}
                      </span>
                      <span className="text-xs font-mono text-warm-500">
                        {sb.cpt_code}
                      </span>
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                          SUPERBILL_STATUS_STYLES[sb.status] || ""
                        }`}
                      >
                        {sb.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-warm-700">
                        {sb.fee !== null ? `$${sb.fee.toFixed(2)}` : "-"}
                      </span>
                      {sb.has_pdf && (
                        <button
                          onClick={() => handleDownloadSuperbill(sb.id)}
                          disabled={downloadingSuperbill === sb.id}
                          className="px-2.5 py-1 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors disabled:opacity-50"
                        >
                          {downloadingSuperbill === sb.id ? "..." : "Download PDF"}
                        </button>
                      )}
                    </div>
                  </div>
                  {sb.cpt_description && (
                    <p className="text-xs text-warm-400">{sb.cpt_description}</p>
                  )}
                  {sb.diagnosis_codes && sb.diagnosis_codes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {sb.diagnosis_codes.map((dx, i) => (
                        <span
                          key={i}
                          className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono bg-warm-50 text-warm-500"
                        >
                          {dx.code}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="pt-3">
                <Link
                  to="/billing"
                  className="text-xs text-teal-600 hover:text-teal-700 font-medium transition-colors"
                >
                  View all in Billing page
                </Link>
              </div>
            </div>
          ) : (
            <EmptyState text="No superbills yet. Superbills are auto-generated when clinical notes are signed." />
          )}
        </SectionCard>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Discharge Confirmation Modal */}
      {/* ----------------------------------------------------------------- */}
      {showDischargeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              if (dischargeStep !== "processing") {
                setShowDischargeModal(false);
              }
            }}
          />
          {/* Modal */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-warm-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-red-500">
                    <path
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-warm-800">
                    {dischargeStep === "complete"
                      ? "Client Discharged"
                      : "Discharge Client"}
                  </h2>
                  <p className="text-sm text-warm-500">
                    {client.full_name || client.email}
                  </p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-4">
              {/* Step: Confirm */}
              {dischargeStep === "confirm" && (
                <div className="space-y-4">
                  {dischargeLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="w-6 h-6 border-2 border-warm-200 border-t-warm-600 rounded-full animate-spin" />
                      <span className="ml-3 text-sm text-warm-500">
                        Checking discharge readiness...
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <p className="text-sm text-red-800 font-medium mb-1">
                          This is a significant clinical action.
                        </p>
                        <p className="text-sm text-red-700">
                          Discharging this client will cancel all future appointments,
                          end any recurring series, generate an AI discharge summary,
                          and update the client's status. This action cannot be undone.
                        </p>
                      </div>

                      {/* Status summary */}
                      {dischargeStatus && (
                        <div className="bg-warm-50 rounded-lg p-4 space-y-2">
                          <p className="text-xs font-semibold text-warm-500 uppercase tracking-wide">
                            Pre-Discharge Summary
                          </p>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="text-warm-600">Completed sessions:</div>
                            <div className="text-warm-800 font-medium">
                              {dischargeStatus.completed_sessions}
                            </div>
                            <div className="text-warm-600">Future appointments:</div>
                            <div className="text-warm-800 font-medium">
                              {dischargeStatus.future_appointment_count}
                              {dischargeStatus.future_appointment_count > 0 && (
                                <span className="text-warm-400 text-xs ml-1">
                                  (will be cancelled)
                                </span>
                              )}
                            </div>
                            <div className="text-warm-600">Recurring series:</div>
                            <div className="text-warm-800 font-medium">
                              {dischargeStatus.recurring_series_count}
                              {dischargeStatus.recurring_series_count > 0 && (
                                <span className="text-warm-400 text-xs ml-1">
                                  (will be ended)
                                </span>
                              )}
                            </div>
                            <div className="text-warm-600">Treatment plan:</div>
                            <div className="text-warm-800 font-medium">
                              {dischargeStatus.has_treatment_plan ? "Yes" : "None"}
                            </div>
                          </div>

                          {/* Warning about unsigned notes */}
                          {dischargeStatus.unsigned_note_count > 0 && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-2">
                              <p className="text-sm text-amber-800 font-medium">
                                {dischargeStatus.unsigned_note_count} unsigned note
                                {dischargeStatus.unsigned_note_count !== 1 ? "s" : ""}
                              </p>
                              <p className="text-xs text-amber-700 mt-1">
                                Consider signing outstanding notes before discharging.
                                You can proceed, but unsigned notes will remain as drafts.
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Discharge reason */}
                      <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">
                          Discharge Reason (optional)
                        </label>
                        <textarea
                          value={dischargeReason}
                          onChange={(e) => setDischargeReason(e.target.value)}
                          placeholder="e.g., Treatment goals met, mutual agreement, client relocated..."
                          rows={3}
                          className="w-full rounded-lg border border-warm-200 px-3 py-2 text-sm text-warm-800 placeholder:text-warm-400 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Step: Processing */}
              {dischargeStep === "processing" && (
                <div className="py-8 text-center space-y-4">
                  <div className="w-12 h-12 mx-auto border-3 border-warm-200 border-t-red-500 rounded-full animate-spin" />
                  <div>
                    <p className="text-sm font-medium text-warm-800">
                      Processing discharge...
                    </p>
                    <p className="text-xs text-warm-500 mt-1">
                      Cancelling appointments, generating discharge summary,
                      and updating client status. This may take a moment.
                    </p>
                  </div>
                </div>
              )}

              {/* Step: Complete */}
              {dischargeStep === "complete" && dischargeResult && (
                <div className="space-y-4">
                  <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
                    <p className="text-sm text-teal-800 font-medium mb-2">
                      Discharge completed successfully.
                    </p>
                    <div className="text-sm text-teal-700 space-y-1">
                      <p>
                        {dischargeResult.cancelled_appointments} appointment
                        {dischargeResult.cancelled_appointments !== 1 ? "s" : ""}{" "}
                        cancelled
                      </p>
                      {dischargeResult.ended_series > 0 && (
                        <p>
                          {dischargeResult.ended_series} recurring series ended
                        </p>
                      )}
                      <p>
                        Discharge summary created as draft note
                      </p>
                    </div>
                  </div>

                  <div className="bg-warm-50 rounded-lg p-4">
                    <p className="text-sm text-warm-700 font-medium mb-2">
                      Next step: Review and sign the discharge summary.
                    </p>
                    <p className="text-xs text-warm-500">
                      The AI-generated discharge summary has been created as a
                      draft clinical note. Please review, edit as needed, and
                      sign to finalize.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-warm-100 flex justify-end gap-3">
              {dischargeStep === "confirm" && (
                <>
                  <button
                    onClick={() => setShowDischargeModal(false)}
                    className="px-4 py-2 text-sm font-medium text-warm-600 bg-white border border-warm-200 rounded-lg hover:bg-warm-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmDischarge}
                    disabled={dischargeLoading || dischargeProcessing}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    Confirm Discharge
                  </button>
                </>
              )}

              {dischargeStep === "complete" && dischargeResult && (
                <>
                  <button
                    onClick={() => setShowDischargeModal(false)}
                    className="px-4 py-2 text-sm font-medium text-warm-600 bg-white border border-warm-200 rounded-lg hover:bg-warm-50 transition-colors"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      setShowDischargeModal(false);
                      navigate(`/notes/${dischargeResult.note_id}`);
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
                  >
                    Review Discharge Note
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable Sub-components
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

function SectionCard({
  title,
  icon,
  badge,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-6">
      <h2 className="font-display text-base font-bold text-warm-800 mb-4 flex items-center gap-2">
        <span className="text-warm-400">{icon}</span>
        {title}
        {badge && (
          <span className="ml-auto inline-flex items-center justify-center w-6 h-6 rounded-full bg-warm-100 text-warm-500 text-xs font-semibold">
            {badge}
          </span>
        )}
      </h2>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-6">
      <div className="w-10 h-10 mx-auto mb-2 bg-warm-50 rounded-full flex items-center justify-center">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="w-5 h-5 text-warm-300"
        >
          <path
            d="M20 12H4M12 4v16"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <p className="text-warm-400 text-sm">{text}</p>
    </div>
  );
}
