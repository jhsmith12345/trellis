import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useMinuteTick } from "../hooks/useSessionWindow";
import { isInSessionWindow } from "../lib/sessionWindow";
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
  sex: string | null;
  payer_name: string | null;
  payer_id: string | null;
  member_id: string | null;
  group_number: string | null;
  default_modality: string | null;
  secondary_payer_name: string | null;
  secondary_payer_id: string | null;
  secondary_member_id: string | null;
  secondary_group_number: string | null;
  filing_deadline_days: number | null;
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

interface Authorization {
  id: string;
  client_id: string;
  clinician_id: string;
  payer_name: string;
  auth_number: string | null;
  authorized_sessions: number | null;
  sessions_used: number;
  cpt_codes: string[] | null;
  diagnosis_codes: string[] | null;
  start_date: string;
  end_date: string;
  status: "active" | "expired" | "exhausted" | "pending";
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface AuthorizationsResponse {
  authorizations: Authorization[];
  count: number;
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

const AUTH_STATUS_STYLES: Record<string, string> = {
  active: "bg-teal-50 text-teal-700",
  pending: "bg-blue-50 text-blue-700",
  expired: "bg-warm-100 text-warm-500",
  exhausted: "bg-red-50 text-red-700",
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
  useMinuteTick();
  const [generatingNoteFor, setGeneratingNoteFor] = useState<string | null>(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [superbills, setSuperbills] = useState<SuperbillItem[]>([]);
  const [downloadingSuperbill, setDownloadingSuperbill] = useState<string | null>(null);
  const [downloadingStatement, setDownloadingStatement] = useState(false);
  const [emailingStatement, setEmailingStatement] = useState(false);

  // Authorization state
  const [authorizations, setAuthorizations] = useState<Authorization[]>([]);
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [editingAuth, setEditingAuth] = useState<Authorization | null>(null);
  const [authSaving, setAuthSaving] = useState(false);
  const [authForm, setAuthForm] = useState({
    payer_name: "",
    auth_number: "",
    authorized_sessions: "",
    cpt_codes: "",
    start_date: "",
    end_date: "",
    notes: "",
  });

  // Eligibility check state
  const [billingConnected, setBillingConnected] = useState(false);
  const [checkingEligibility, setCheckingEligibility] = useState(false);
  const [eligibilityResult, setEligibilityResult] = useState<Record<string, any> | null>(null);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);

  // Patient payment tracking state
  const [clientBalance, setClientBalance] = useState<{
    total_billed: number;
    total_paid: number;
    outstanding: number;
  } | null>(null);
  const [paymentLinkModal, setPaymentLinkModal] = useState<{
    superbillId: string;
    amount: number;
  } | null>(null);
  const [paymentLinkResult, setPaymentLinkResult] = useState<{
    url: string;
    amount: number;
    expires_at: string | null;
  } | null>(null);
  const [creatingPaymentLink, setCreatingPaymentLink] = useState(false);
  const [copiedPaymentLink, setCopiedPaymentLink] = useState(false);

  // Inline edit state for client profile fields
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [savingField, setSavingField] = useState(false);

  async function handleSaveField(fieldName: string) {
    if (!client || !clientId) return;
    setSavingField(true);
    try {
      const payload: Record<string, unknown> = {};
      if (fieldName === "filing_deadline_days") {
        payload[fieldName] = parseInt(editValue, 10) || 90;
      } else {
        payload[fieldName] = editValue || null;
      }
      await api.patch(`/api/clients/${clientId}`, payload);
      setClient({ ...client, ...payload } as ClientDetail);
      setEditingField(null);
    } catch (err) {
      console.error("Failed to save field:", err);
    } finally {
      setSavingField(false);
    }
  }

  function startEdit(fieldName: string, currentValue: string | number | null) {
    setEditingField(fieldName);
    setEditValue(String(currentValue ?? ""));
  }

  async function handleCheckEligibility() {
    if (!clientId) return;
    setCheckingEligibility(true);
    setEligibilityError(null);
    try {
      const result = await api.post<Record<string, any>>(
        `/api/clients/${client?.firebase_uid || clientId}/eligibility`,
        {}
      );
      setEligibilityResult(result);
    } catch (err: any) {
      setEligibilityError(err.message || "Failed to check eligibility.");
      setEligibilityResult(null);
    } finally {
      setCheckingEligibility(false);
    }
  }

  async function handleCreatePaymentLink(superbillId: string) {
    setCreatingPaymentLink(true);
    try {
      const result = await api.post<{
        payment_link_url: string;
        amount: number;
        expires_at: string | null;
        superbill_id: string;
      }>(`/api/superbills/${superbillId}/payment-link`, {});
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
          if (sbData.client_balance) {
            setClientBalance(sbData.client_balance);
          }
        } catch {
          // Non-critical
        }

        // Load authorizations for this client
        try {
          const authData = await api.get<AuthorizationsResponse>(
            `/api/authorizations/client/${clientData.firebase_uid}`
          );
          setAuthorizations(authData.authorizations);
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

        // Check if billing service is connected
        try {
          const billingSettings = await api.get<{ connected: boolean }>("/api/billing/settings");
          setBillingConnected(billingSettings.connected);
        } catch {
          // Non-critical
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

  async function handleDownloadStatement() {
    if (!client) return;
    setDownloadingStatement(true);
    try {
      const blob = await api.postBlob(`/api/clients/${client.firebase_uid}/statement`, {});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `statement_${(client.full_name || "client").replace(/\s+/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to generate statement:", err);
      alert("Failed to generate patient statement.");
    } finally {
      setDownloadingStatement(false);
    }
  }

  async function handleEmailStatement() {
    if (!client) return;
    setEmailingStatement(true);
    try {
      await api.post(`/api/clients/${client.firebase_uid}/statement/email`, {});
      alert("Statement emailed to client successfully.");
    } catch (err: any) {
      console.error("Failed to email statement:", err);
      alert(err.message || "Failed to email statement.");
    } finally {
      setEmailingStatement(false);
    }
  }

  // --- Authorization handlers ---
  function openAuthForm(auth?: Authorization) {
    if (auth) {
      setEditingAuth(auth);
      setAuthForm({
        payer_name: auth.payer_name,
        auth_number: auth.auth_number || "",
        authorized_sessions: auth.authorized_sessions !== null ? String(auth.authorized_sessions) : "",
        cpt_codes: auth.cpt_codes ? auth.cpt_codes.join(", ") : "",
        start_date: auth.start_date,
        end_date: auth.end_date,
        notes: auth.notes || "",
      });
    } else {
      setEditingAuth(null);
      setAuthForm({
        payer_name: client?.payer_name || "",
        auth_number: "",
        authorized_sessions: "",
        cpt_codes: "",
        start_date: "",
        end_date: "",
        notes: "",
      });
    }
    setShowAuthForm(true);
  }

  async function handleSaveAuth() {
    if (!client) return;
    setAuthSaving(true);
    try {
      const payload: Record<string, unknown> = {
        payer_name: authForm.payer_name,
        auth_number: authForm.auth_number || null,
        authorized_sessions: authForm.authorized_sessions ? parseInt(authForm.authorized_sessions, 10) : null,
        cpt_codes: authForm.cpt_codes ? authForm.cpt_codes.split(",").map((s) => s.trim()).filter(Boolean) : null,
        start_date: authForm.start_date,
        end_date: authForm.end_date,
        notes: authForm.notes || null,
      };

      if (editingAuth) {
        await api.put(`/api/authorizations/${editingAuth.id}`, payload);
      } else {
        await api.post("/api/authorizations", {
          ...payload,
          client_id: client.firebase_uid,
        });
      }

      // Reload authorizations
      const authData = await api.get<AuthorizationsResponse>(
        `/api/authorizations/client/${client.firebase_uid}`
      );
      setAuthorizations(authData.authorizations);
      setShowAuthForm(false);
      setEditingAuth(null);
    } catch (err: any) {
      console.error("Failed to save authorization:", err);
      alert(err.message || "Failed to save authorization.");
    } finally {
      setAuthSaving(false);
    }
  }

  async function handleDeleteAuth(authId: string) {
    if (!client || !confirm("Delete this authorization?")) return;
    try {
      await api.del(`/api/authorizations/${authId}`);
      setAuthorizations((prev) => prev.filter((a) => a.id !== authId));
    } catch (err: any) {
      console.error("Failed to delete authorization:", err);
      alert(err.message || "Failed to delete authorization.");
    }
  }

  function getAuthColor(auth: Authorization): string {
    if (auth.status === "expired" || auth.status === "exhausted") return "border-red-200 bg-red-50/30";
    if (auth.authorized_sessions !== null) {
      const remaining = auth.authorized_sessions - auth.sessions_used;
      if (remaining <= 3) return "border-amber-200 bg-amber-50/30";
    }
    const endDate = new Date(auth.end_date);
    const now = new Date();
    const daysUntilExpiry = Math.floor((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry <= 14) return "border-amber-200 bg-amber-50/30";
    return "border-teal-200 bg-teal-50/30";
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
              {client.sex && (
                <p className="text-warm-500">
                  Sex: {{ M: "Male", F: "Female", X: "Non-binary", U: "Not specified" }[client.sex] || client.sex}
                </p>
              )}
              {address && <p className="text-warm-500">{address}</p>}
              <p className="text-warm-500">
                Modality: {client.default_modality === "in_office" ? "In-office" : "Telehealth"}
                <button
                  onClick={() => startEdit("default_modality", client.default_modality)}
                  className="ml-1 text-teal-600 hover:text-teal-700 text-xs"
                >
                  edit
                </button>
              </p>
              {editingField === "default_modality" && (
                <div className="flex items-center gap-2 mt-1">
                  <select
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="px-2 py-1 text-xs border border-warm-200 rounded-lg"
                  >
                    <option value="telehealth">Telehealth</option>
                    <option value="in_office">In-office</option>
                  </select>
                  <button onClick={() => handleSaveField("default_modality")} disabled={savingField} className="text-xs text-teal-600 font-medium">Save</button>
                  <button onClick={() => setEditingField(null)} className="text-xs text-warm-400">Cancel</button>
                </div>
              )}
            </div>
          </div>

          {/* Insurance */}
          <div>
            <h3 className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-2">
              Primary Insurance
            </h3>
            <div className="space-y-1 text-sm">
              <p className="text-warm-700 font-medium">
                {client.payer_name || "Self-pay"}
                <button
                  onClick={() => startEdit("payer_name", client.payer_name)}
                  className="ml-1 text-teal-600 hover:text-teal-700 text-xs"
                >
                  edit
                </button>
              </p>
              {editingField === "payer_name" && (
                <div className="flex items-center gap-2">
                  <input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="px-2 py-1 text-xs border border-warm-200 rounded-lg w-full" />
                  <button onClick={() => handleSaveField("payer_name")} disabled={savingField} className="text-xs text-teal-600 font-medium">Save</button>
                  <button onClick={() => setEditingField(null)} className="text-xs text-warm-400">Cancel</button>
                </div>
              )}
              {client.payer_id && (
                <p className="text-warm-500">Payer ID: {client.payer_id}</p>
              )}
              {client.member_id && (
                <p className="text-warm-500">Member ID: {client.member_id}</p>
              )}
              {client.group_number && (
                <p className="text-warm-500">Group: {client.group_number}</p>
              )}
              {(client.payer_name && !client.payer_id) && (
                <button
                  onClick={() => startEdit("payer_id", client.payer_id)}
                  className="text-xs text-teal-600 hover:text-teal-700"
                >
                  + Add Payer ID
                </button>
              )}
              {editingField === "payer_id" && (
                <div className="flex items-center gap-2">
                  <input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="Electronic payer ID" className="px-2 py-1 text-xs border border-warm-200 rounded-lg w-full" />
                  <button onClick={() => handleSaveField("payer_id")} disabled={savingField} className="text-xs text-teal-600 font-medium">Save</button>
                  <button onClick={() => setEditingField(null)} className="text-xs text-warm-400">Cancel</button>
                </div>
              )}

              {/* Secondary Insurance */}
              {client.secondary_payer_name ? (
                <div className="mt-3 pt-2 border-t border-warm-50">
                  <p className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-1">Secondary</p>
                  <p className="text-warm-700">{client.secondary_payer_name}</p>
                  {client.secondary_payer_id && <p className="text-warm-500">Payer ID: {client.secondary_payer_id}</p>}
                  {client.secondary_member_id && <p className="text-warm-500">Member ID: {client.secondary_member_id}</p>}
                  {client.secondary_group_number && <p className="text-warm-500">Group: {client.secondary_group_number}</p>}
                </div>
              ) : (
                <button
                  onClick={() => startEdit("secondary_payer_name", "")}
                  className="text-xs text-teal-600 hover:text-teal-700 mt-2"
                >
                  + Add Secondary Insurance
                </button>
              )}
              {editingField === "secondary_payer_name" && (
                <div className="flex items-center gap-2 mt-1">
                  <input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="Secondary payer name" className="px-2 py-1 text-xs border border-warm-200 rounded-lg w-full" />
                  <button onClick={() => handleSaveField("secondary_payer_name")} disabled={savingField} className="text-xs text-teal-600 font-medium">Save</button>
                  <button onClick={() => setEditingField(null)} className="text-xs text-warm-400">Cancel</button>
                </div>
              )}

              {/* Eligibility Check */}
              {billingConnected && client.payer_id && client.member_id && (
                <div className="mt-4 pt-3 border-t border-warm-100">
                  <button
                    onClick={handleCheckEligibility}
                    disabled={checkingEligibility}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 transition-colors disabled:opacity-50"
                  >
                    {checkingEligibility ? (
                      <span className="w-3 h-3 block border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
                    ) : (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                      </svg>
                    )}
                    Verify Eligibility
                  </button>

                  {eligibilityError && (
                    <p className="mt-2 text-xs text-red-600">{eligibilityError}</p>
                  )}

                  {eligibilityResult && (
                    <div className="mt-3 p-3 bg-warm-50 rounded-lg space-y-2">
                      {/* Active/Inactive badge */}
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            eligibilityResult.active
                              ? "bg-teal-100 text-teal-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {eligibilityResult.active ? "Active" : "Inactive"}
                        </span>
                        {eligibilityResult.plan_name && (
                          <span className="text-xs text-warm-500">{eligibilityResult.plan_name}</span>
                        )}
                        {eligibilityResult.cached && (
                          <span className="text-xs text-warm-400 italic">cached</span>
                        )}
                      </div>

                      {/* Copay */}
                      {eligibilityResult.copay?.amount != null && (
                        <div className="flex justify-between text-xs">
                          <span className="text-warm-500">Copay</span>
                          <span className="text-warm-700 font-medium">${eligibilityResult.copay.amount.toFixed(2)}</span>
                        </div>
                      )}

                      {/* Deductible */}
                      {eligibilityResult.deductible?.individual?.total != null && (
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-warm-500">Deductible</span>
                            <span className="text-warm-700">
                              ${((eligibilityResult.deductible.individual.total || 0) - (eligibilityResult.deductible.individual.remaining || 0)).toFixed(2)}
                              {" / "}
                              ${eligibilityResult.deductible.individual.total.toFixed(2)}
                            </span>
                          </div>
                          <div className="w-full bg-warm-200 rounded-full h-1.5">
                            <div
                              className="bg-teal-500 h-1.5 rounded-full"
                              style={{
                                width: `${Math.min(100, ((eligibilityResult.deductible.individual.total - (eligibilityResult.deductible.individual.remaining || 0)) / eligibilityResult.deductible.individual.total) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* OOP Max */}
                      {eligibilityResult.out_of_pocket_max?.individual?.total != null && (
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-warm-500">OOP Max</span>
                            <span className="text-warm-700">
                              ${((eligibilityResult.out_of_pocket_max.individual.total || 0) - (eligibilityResult.out_of_pocket_max.individual.remaining || 0)).toFixed(2)}
                              {" / "}
                              ${eligibilityResult.out_of_pocket_max.individual.total.toFixed(2)}
                            </span>
                          </div>
                          <div className="w-full bg-warm-200 rounded-full h-1.5">
                            <div
                              className="bg-indigo-500 h-1.5 rounded-full"
                              style={{
                                width: `${Math.min(100, ((eligibilityResult.out_of_pocket_max.individual.total - (eligibilityResult.out_of_pocket_max.individual.remaining || 0)) / eligibilityResult.out_of_pocket_max.individual.total) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Session limits */}
                      {eligibilityResult.session_limits && (
                        <div className="flex justify-between text-xs">
                          <span className="text-warm-500">Sessions</span>
                          <span className="text-warm-700">
                            {eligibilityResult.session_limits.used ?? 0} / {eligibilityResult.session_limits.allowed ?? "N/A"}
                            {eligibilityResult.session_limits.remaining != null && (
                              <span className="text-warm-400"> ({eligibilityResult.session_limits.remaining} remaining)</span>
                            )}
                          </span>
                        </div>
                      )}

                      {/* Prior auth */}
                      {eligibilityResult.prior_auth_required != null && (
                        <div className="flex justify-between text-xs">
                          <span className="text-warm-500">Prior Auth Required</span>
                          <span className={`font-medium ${eligibilityResult.prior_auth_required ? "text-amber-600" : "text-teal-600"}`}>
                            {eligibilityResult.prior_auth_required ? "Yes" : "No"}
                          </span>
                        </div>
                      )}

                      {/* Carve-out payer warning */}
                      {eligibilityResult.carve_out_payer && (
                        <div className="mt-1 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                          Carve-out: {eligibilityResult.carve_out_payer.name}
                          {eligibilityResult.carve_out_payer.id && ` (${eligibilityResult.carve_out_payer.id})`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
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

        {/* Editable demographic fields row */}
        <div className="grid md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-warm-50">
          <div className="text-sm">
            <span className="text-warm-400 text-xs">Sex</span>
            <p className="text-warm-700">
              {client.sex ? { M: "Male", F: "Female", X: "Non-binary", U: "Not specified" }[client.sex] || client.sex : "Not set"}
              <button onClick={() => startEdit("sex", client.sex)} className="ml-1 text-teal-600 hover:text-teal-700 text-xs">edit</button>
            </p>
            {editingField === "sex" && (
              <div className="flex items-center gap-2 mt-1">
                <select value={editValue} onChange={(e) => setEditValue(e.target.value)} className="px-2 py-1 text-xs border border-warm-200 rounded-lg">
                  <option value="">Select...</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="X">Non-binary</option>
                  <option value="U">Not specified</option>
                </select>
                <button onClick={() => handleSaveField("sex")} disabled={savingField} className="text-xs text-teal-600 font-medium">Save</button>
                <button onClick={() => setEditingField(null)} className="text-xs text-warm-400">Cancel</button>
              </div>
            )}
          </div>
          <div className="text-sm">
            <span className="text-warm-400 text-xs">Filing Deadline</span>
            <p className="text-warm-700">
              {client.filing_deadline_days ?? 90} days
              <button onClick={() => startEdit("filing_deadline_days", client.filing_deadline_days)} className="ml-1 text-teal-600 hover:text-teal-700 text-xs">edit</button>
            </p>
            {editingField === "filing_deadline_days" && (
              <div className="flex items-center gap-2 mt-1">
                <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="px-2 py-1 text-xs border border-warm-200 rounded-lg w-20" />
                <span className="text-xs text-warm-400">days</span>
                <button onClick={() => handleSaveField("filing_deadline_days")} disabled={savingField} className="text-xs text-teal-600 font-medium">Save</button>
                <button onClick={() => setEditingField(null)} className="text-xs text-warm-400">Cancel</button>
              </div>
            )}
          </div>
          {client.secondary_payer_id && (
            <div className="text-sm">
              <span className="text-warm-400 text-xs">Secondary Payer ID</span>
              <p className="text-warm-700">{client.secondary_payer_id}</p>
            </div>
          )}
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
          action={
            client && (
              <Link
                to={`/notes/new?client=${client.firebase_uid}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                </svg>
                New Note
              </Link>
            )
          }
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
                          {appt.meet_link && isInSessionWindow(appt.scheduled_at, appt.duration_minutes) && (
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
                        <div className="flex items-center gap-2">
                          {appt.status === "completed" && !appt.encounter_id && client && (
                            <Link
                              to={`/notes/new?client=${client.firebase_uid}&appointment=${appt.id}`}
                              className="px-2.5 py-1 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
                            >
                              Write Note
                            </Link>
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
        {/* Authorizations */}
        {/* ----------------------------------------------------------------- */}
        <SectionCard
          title="Authorizations"
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <path
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
          badge={authorizations.length > 0 ? String(authorizations.length) : undefined}
        >
          {/* Add Authorization button */}
          <div className="flex justify-end mb-3">
            <button
              onClick={() => openAuthForm()}
              className="px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
            >
              + Add Authorization
            </button>
          </div>

          {authorizations.length > 0 ? (
            <div className="space-y-3">
              {authorizations.map((auth) => (
                <div
                  key={auth.id}
                  className={`rounded-xl border p-4 ${getAuthColor(auth)}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-warm-800">
                        {auth.payer_name}
                      </span>
                      {auth.auth_number && (
                        <span className="text-xs font-mono text-warm-500">
                          #{auth.auth_number}
                        </span>
                      )}
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium uppercase ${
                          AUTH_STATUS_STYLES[auth.status] || ""
                        }`}
                      >
                        {auth.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {(auth.status === "active" || auth.status === "pending") && (
                        <button
                          onClick={() => openAuthForm(auth)}
                          className="p-1 text-warm-400 hover:text-teal-600 transition-colors"
                          title="Edit"
                        >
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteAuth(auth.id)}
                        className="p-1 text-warm-400 hover:text-red-600 transition-colors"
                        title="Delete"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                          <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 01.78.72l.5 6a.75.75 0 01-1.5.12l-.5-6a.75.75 0 01.72-.78zm2.84.72a.75.75 0 111.5-.12l.5 6a.75.75 0 11-1.5.12l-.5-6z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Sessions progress */}
                  {auth.authorized_sessions !== null && (
                    <div className="mb-2">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-warm-500">
                          {auth.sessions_used} / {auth.authorized_sessions} sessions used
                        </span>
                        <span className="font-medium text-warm-600">
                          {auth.authorized_sessions - auth.sessions_used} remaining
                        </span>
                      </div>
                      <div className="w-full h-2 bg-warm-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            auth.authorized_sessions - auth.sessions_used <= 3
                              ? auth.authorized_sessions - auth.sessions_used <= 0
                                ? "bg-red-500"
                                : "bg-amber-500"
                              : "bg-teal-500"
                          }`}
                          style={{
                            width: `${Math.min(100, (auth.sessions_used / auth.authorized_sessions) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Date range */}
                  <div className="flex items-center gap-3 text-xs text-warm-500">
                    <span>
                      {formatDate(auth.start_date)} - {formatDate(auth.end_date)}
                    </span>
                    {auth.cpt_codes && auth.cpt_codes.length > 0 && (
                      <span className="font-mono">
                        CPT: {auth.cpt_codes.join(", ")}
                      </span>
                    )}
                  </div>
                  {auth.notes && (
                    <p className="text-xs text-warm-400 mt-1">{auth.notes}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No authorizations. Add one to track insurance-approved sessions." />
          )}

          {/* Auth Form Modal */}
          {showAuthForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div
                className="absolute inset-0 bg-black/50"
                onClick={() => { setShowAuthForm(false); setEditingAuth(null); }}
              />
              <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
                <h3 className="font-display text-lg font-bold text-warm-800 mb-4">
                  {editingAuth ? "Edit Authorization" : "Add Authorization"}
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-warm-600 mb-1">
                      Payer Name *
                    </label>
                    <input
                      type="text"
                      value={authForm.payer_name}
                      onChange={(e) => setAuthForm({ ...authForm, payer_name: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
                      placeholder="e.g. Blue Cross Blue Shield"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-warm-600 mb-1">
                      Authorization Number
                    </label>
                    <input
                      type="text"
                      value={authForm.auth_number}
                      onChange={(e) => setAuthForm({ ...authForm, auth_number: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
                      placeholder="e.g. AUTH-12345"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-warm-600 mb-1">
                      Authorized Sessions
                    </label>
                    <input
                      type="number"
                      value={authForm.authorized_sessions}
                      onChange={(e) => setAuthForm({ ...authForm, authorized_sessions: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
                      placeholder="Leave blank for unlimited"
                      min="1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-warm-600 mb-1">
                      CPT Codes (optional, comma-separated)
                    </label>
                    <input
                      type="text"
                      value={authForm.cpt_codes}
                      onChange={(e) => setAuthForm({ ...authForm, cpt_codes: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
                      placeholder="e.g. 90834, 90837"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-warm-600 mb-1">
                        Start Date *
                      </label>
                      <input
                        type="date"
                        value={authForm.start_date}
                        onChange={(e) => setAuthForm({ ...authForm, start_date: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-warm-600 mb-1">
                        End Date *
                      </label>
                      <input
                        type="date"
                        value={authForm.end_date}
                        onChange={(e) => setAuthForm({ ...authForm, end_date: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-warm-600 mb-1">
                      Notes
                    </label>
                    <textarea
                      value={authForm.notes}
                      onChange={(e) => setAuthForm({ ...authForm, notes: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
                      rows={2}
                      placeholder="Optional notes..."
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-5">
                  <button
                    onClick={() => { setShowAuthForm(false); setEditingAuth(null); }}
                    className="px-4 py-2 text-sm font-medium text-warm-600 hover:text-warm-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveAuth}
                    disabled={authSaving || !authForm.payer_name || !authForm.start_date || !authForm.end_date}
                    className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
                  >
                    {authSaving ? "Saving..." : editingAuth ? "Update" : "Create"}
                  </button>
                </div>
              </div>
            </div>
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
              {/* Patient Balance Summary */}
              {clientBalance && clientBalance.outstanding > 0 && (
                <div className="pb-3 mb-1">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
                      Patient Balance
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-xs text-warm-500">Billed</p>
                        <p className="text-sm font-semibold text-warm-700">
                          ${clientBalance.total_billed.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-warm-500">Paid</p>
                        <p className="text-sm font-semibold text-teal-700">
                          ${clientBalance.total_paid.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-warm-500">Outstanding</p>
                        <p className="text-sm font-bold text-red-600">
                          ${clientBalance.outstanding.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {superbills.map((sb) => {
                const patientBalance = (sb.fee ?? 0) - (sb.amount_paid ?? 0);
                return (
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
                  {/* Patient responsibility and payment link per superbill */}
                  {patientBalance > 0 && (
                    <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-warm-50">
                      <span className="text-xs text-red-600 font-medium">
                        Patient owes: ${patientBalance.toFixed(2)}
                      </span>
                      {billingConnected && (
                        <button
                          onClick={() =>
                            setPaymentLinkModal({
                              superbillId: sb.id,
                              amount: patientBalance,
                            })
                          }
                          className="px-2 py-0.5 text-[10px] font-medium text-orange-700 bg-orange-50 rounded-lg hover:bg-orange-100 transition-colors flex items-center gap-1"
                        >
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-2.5 h-2.5">
                            <path d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 001.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" />
                          </svg>
                          Send Payment Link
                        </button>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
              <div className="pt-3 flex items-center justify-between">
                <Link
                  to="/billing"
                  className="text-xs text-teal-600 hover:text-teal-700 font-medium transition-colors"
                >
                  View all in Billing page
                </Link>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleEmailStatement}
                    disabled={emailingStatement}
                    className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    {emailingStatement ? (
                      <span className="w-3 h-3 block border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                    ) : (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                        <path d="M3 4a2 2 0 00-2 2v1.161l8.441 4.221a1.25 1.25 0 001.118 0L19 7.162V6a2 2 0 00-2-2H3z" />
                        <path d="M19 8.839l-7.77 3.885a2.75 2.75 0 01-2.46 0L1 8.839V14a2 2 0 002 2h14a2 2 0 002-2V8.839z" />
                      </svg>
                    )}
                    Email Statement
                  </button>
                  <button
                    onClick={handleDownloadStatement}
                    disabled={downloadingStatement}
                    className="px-2.5 py-1 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    {downloadingStatement ? (
                      <span className="w-3 h-3 block border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
                    ) : (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                        <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z" clipRule="evenodd" />
                      </svg>
                    )}
                    Statement PDF
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState text="No superbills yet. Superbills are auto-generated when clinical notes are signed." />
          )}
        </SectionCard>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Payment Link Modal */}
      {/* ----------------------------------------------------------------- */}
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
              Generate a Stripe payment link for {client?.full_name || "this patient"}.
            </p>

            {!paymentLinkResult ? (
              <div className="space-y-4">
                <div className="bg-warm-50 rounded-xl p-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-warm-600">Patient Responsibility</span>
                    <span className="text-lg font-bold text-red-600">
                      ${paymentLinkModal.amount.toFixed(2)}
                    </span>
                  </div>
                </div>

                {client?.email && (
                  <div>
                    <label className="block text-sm font-medium text-warm-700 mb-1">
                      Patient Email
                    </label>
                    <p className="text-sm text-warm-600 bg-warm-50 rounded-lg px-3 py-2">
                      {client.email}
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
                    onClick={() => handleCreatePaymentLink(paymentLinkModal.superbillId)}
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
                    Amount: ${paymentLinkResult.amount.toFixed(2)}
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
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  badge?: string;
  action?: React.ReactNode;
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
        {action && <span className="ml-auto">{action}</span>}
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
