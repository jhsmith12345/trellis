import { useState, useEffect, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { SectionEditor } from "../components/notes/SectionEditor";
import { NoteSigningModal } from "../components/notes/NoteSigningModal";
import { AmendmentHistory } from "../components/notes/AmendmentHistory";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Amendment {
  id: string;
  status: string;
  signed_at: string | null;
  signed_by: string | null;
  created_at: string;
}

interface NoteDetail {
  id: string;
  encounter_id: string;
  format: string;
  content: Record<string, string>;
  flags: unknown[];
  signed_by: string | null;
  signed_at: string | null;
  status: string;
  content_hash: string | null;
  amendment_of: string | null;
  signature_data: string | null;
  created_at: string;
  updated_at: string;
  client_id: string;
  encounter_type: string;
  encounter_source: string;
  transcript: string;
  encounter_data: Record<string, unknown> | null;
  duration_sec: number | null;
  encounter_created_at: string;
  client: {
    firebase_uid: string;
    full_name: string | null;
    preferred_name: string | null;
    email: string | null;
    date_of_birth: string | null;
  } | null;
  client_uuid: string | null;
  amendments: Amendment[];
  has_pdf: boolean;
}

// ---------------------------------------------------------------------------
// Section labels for each note format
// ---------------------------------------------------------------------------

const FORMAT_SECTIONS: Record<string, { key: string; label: string }[]> = {
  SOAP: [
    { key: "subjective", label: "Subjective" },
    { key: "objective", label: "Objective" },
    { key: "assessment", label: "Assessment" },
    { key: "plan", label: "Plan" },
  ],
  DAP: [
    { key: "data", label: "Data" },
    { key: "assessment", label: "Assessment" },
    { key: "plan", label: "Plan" },
  ],
  narrative: [
    { key: "identifying_information", label: "Identifying Information" },
    { key: "presenting_problem", label: "Presenting Problem" },
    { key: "history_of_present_illness", label: "History of Present Illness" },
    { key: "psychiatric_history", label: "Psychiatric History" },
    { key: "substance_use_history", label: "Substance Use History" },
    { key: "medical_history", label: "Medical History" },
    { key: "family_history", label: "Family History" },
    { key: "social_developmental_history", label: "Social & Developmental History" },
    { key: "mental_status_examination", label: "Mental Status Examination" },
    { key: "diagnostic_impressions", label: "Diagnostic Impressions" },
    { key: "risk_assessment", label: "Risk Assessment" },
    { key: "treatment_recommendations", label: "Treatment Recommendations" },
    { key: "clinical_summary", label: "Clinical Summary" },
  ],
  discharge: [
    { key: "reason_for_treatment", label: "Reason for Treatment" },
    { key: "course_of_treatment", label: "Course of Treatment" },
    { key: "progress_toward_goals", label: "Progress Toward Goals" },
    { key: "diagnoses_at_discharge", label: "Diagnoses at Discharge" },
    { key: "discharge_recommendations", label: "Discharge Recommendations" },
    { key: "medications_at_discharge", label: "Medications at Discharge" },
    { key: "risk_assessment", label: "Risk Assessment at Discharge" },
    { key: "clinical_summary", label: "Clinical Summary" },
  ],
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  review: "bg-blue-50 text-blue-700 border-blue-200",
  signed: "bg-teal-50 text-teal-700 border-teal-200",
  amended: "bg-purple-50 text-purple-700 border-purple-200",
};

const FORMAT_LABELS: Record<string, string> = {
  SOAP: "SOAP Progress Note",
  DAP: "DAP Progress Note",
  narrative: "Biopsychosocial Assessment",
  discharge: "Discharge Summary",
};

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

function formatDuration(sec: number | null | undefined): string {
  if (!sec) return "-";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NoteEditorPage() {
  const { noteId } = useParams();
  const navigate = useNavigate();
  const api = useApi();

  const [note, setNote] = useState<NoteDetail | null>(null);
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState("");
  const [showSigningModal, setShowSigningModal] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [creatingAmendment, setCreatingAmendment] = useState(false);

  // Load note data
  useEffect(() => {
    async function load() {
      if (!noteId) return;
      try {
        const data = await api.get<NoteDetail>(`/api/notes/${noteId}`);
        setNote(data);
        setEditedContent(data.content || {});
      } catch (err) {
        console.error("Failed to load note:", err);
        setError("Failed to load note. It may not exist.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api, noteId]);

  // Handle content changes from TipTap section editors
  const handleSectionChange = useCallback(
    (key: string, value: string) => {
      setEditedContent((prev) => ({ ...prev, [key]: value }));
      setHasChanges(true);
      setSaveMessage("");
    },
    [],
  );

  // Save note
  const handleSave = async () => {
    if (!noteId || !note) return;
    setSaving(true);
    setSaveMessage("");
    try {
      await api.put(`/api/notes/${noteId}`, { content: editedContent });
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

  // Move to review
  const handleMarkReview = async () => {
    if (!noteId || !note) return;
    setSaving(true);
    try {
      if (hasChanges) {
        await api.put(`/api/notes/${noteId}`, { content: editedContent });
      }
      await api.put(`/api/notes/${noteId}`, { status: "review" });
      setNote((prev) => (prev ? { ...prev, status: "review" } : prev));
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

  // Move back to draft
  const handleBackToDraft = async () => {
    if (!noteId || !note) return;
    setSaving(true);
    try {
      await api.put(`/api/notes/${noteId}`, { status: "draft" });
      setNote((prev) => (prev ? { ...prev, status: "draft" } : prev));
      setSaveMessage("Moved back to draft");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (err) {
      console.error("Status change failed:", err);
      setSaveMessage("Failed to update status");
    } finally {
      setSaving(false);
    }
  };

  // Regenerate note
  const handleRegenerate = async () => {
    if (!note) return;
    if (
      !window.confirm(
        "Regenerate this note? This will replace the current content with a new AI-generated draft.",
      )
    )
      return;

    setRegenerating(true);
    try {
      const result = await api.post<{
        note_id: string;
        format: string;
        content: Record<string, string>;
        status: string;
      }>("/api/notes/generate", {
        encounter_id: note.encounter_id,
        note_format: note.format === "narrative" ? null : note.format,
      });
      setEditedContent(result.content);
      setNote((prev) =>
        prev ? { ...prev, content: result.content, status: "draft" } : prev,
      );
      setHasChanges(false);
      setSaveMessage("Note regenerated");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (err) {
      console.error("Regeneration failed:", err);
      setSaveMessage("Regeneration failed. Please try again.");
    } finally {
      setRegenerating(false);
    }
  };

  // Sign note — opens signing modal
  const handleOpenSign = async () => {
    if (!noteId || !note) return;
    // Save any pending changes before signing
    if (hasChanges) {
      setSaving(true);
      try {
        await api.put(`/api/notes/${noteId}`, { content: editedContent });
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

  // After signing succeeds
  const handleSigned = (result: {
    signed_by: string;
    signed_at: string;
    content_hash: string;
  }) => {
    setShowSigningModal(false);
    setNote((prev) =>
      prev
        ? {
            ...prev,
            status: "signed",
            signed_by: result.signed_by,
            signed_at: result.signed_at,
            content_hash: result.content_hash,
            has_pdf: true,
          }
        : prev,
    );
    setSaveMessage("Note signed successfully");
    setTimeout(() => setSaveMessage(""), 5000);
  };

  // Download PDF
  const handleDownloadPdf = async () => {
    if (!noteId) return;
    setDownloadingPdf(true);
    try {
      const blob = await api.getBlob(`/api/notes/${noteId}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clinical_note_${noteId.slice(0, 8)}.pdf`;
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

  // Create amendment
  const handleAmend = async () => {
    if (!noteId || !note) return;
    if (
      !window.confirm(
        "Create an amendment? This will create a new draft note linked to this signed note. The original note will remain unchanged.",
      )
    )
      return;

    setCreatingAmendment(true);
    try {
      const result = await api.post<{
        amendment_id: string;
        original_note_id: string;
      }>(`/api/notes/${noteId}/amend`, {
        content: note.content,
        reason: "Clinician-initiated amendment",
      });
      // Navigate to the new amendment
      navigate(`/notes/${result.amendment_id}`);
    } catch (err) {
      console.error("Amendment creation failed:", err);
      setSaveMessage("Failed to create amendment");
    } finally {
      setCreatingAmendment(false);
    }
  };

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-6xl">
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error || !note) {
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
          <p className="text-warm-500">{error || "Note not found."}</p>
        </div>
      </div>
    );
  }

  const sections = FORMAT_SECTIONS[note.format] || [];
  const isEditable = note.status === "draft" || note.status === "review";
  const isSigned = note.status === "signed" || note.status === "amended";
  const clientName =
    note.client?.preferred_name ||
    note.client?.full_name ||
    note.client?.email ||
    "Unknown Client";

  return (
    <div className="px-8 py-8 max-w-6xl">
      {/* Back link */}
      <div className="flex items-center gap-3 mb-6">
        {note.client_uuid ? (
          <Link
            to={`/clients/${note.client_uuid}`}
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
                {FORMAT_LABELS[note.format] || note.format}
              </h1>
              <span
                className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize border ${
                  STATUS_STYLES[note.status] || ""
                }`}
              >
                {note.status}
              </span>
              {note.amendment_of && (
                <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                  Amendment
                </span>
              )}
            </div>
            <p className="text-sm text-warm-500">
              {clientName} &middot; {formatDateTime(note.encounter_created_at)}
              {note.duration_sec ? ` &middot; ${formatDuration(note.duration_sec)}` : ""}
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
              onClick={() => setShowTranscript(!showTranscript)}
              className="px-3 py-2 text-sm font-medium text-warm-600 bg-warm-50 rounded-lg hover:bg-warm-100 transition-colors"
            >
              {showTranscript ? "Hide Transcript" : "View Transcript"}
            </button>

            {/* Signed note actions */}
            {isSigned && (
              <>
                {note.has_pdf && (
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
                  onClick={handleAmend}
                  disabled={creatingAmendment}
                  className="px-3 py-2 text-sm font-medium text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors disabled:opacity-50"
                >
                  {creatingAmendment ? "Creating..." : "Amend Note"}
                </button>
              </>
            )}

            {/* Draft/review actions */}
            {isEditable && (
              <>
                <button
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50"
                >
                  {regenerating ? "Regenerating..." : "Regenerate"}
                </button>

                <button
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>

                {note.status === "draft" && (
                  <button
                    onClick={handleMarkReview}
                    disabled={saving}
                    className="px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
                  >
                    Ready for Review
                  </button>
                )}

                {note.status === "review" && (
                  <button
                    onClick={handleBackToDraft}
                    disabled={saving}
                    className="px-3 py-2 text-sm font-medium text-warm-600 bg-warm-50 rounded-lg hover:bg-warm-100 transition-colors disabled:opacity-50"
                  >
                    Back to Draft
                  </button>
                )}

                {/* Sign button */}
                <button
                  onClick={handleOpenSign}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-bold text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <SignIcon />
                  Sign Note
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Signed note info banner */}
      {isSigned && (
        <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5 mb-6">
          <div className="flex items-start gap-4">
            {/* Signature display */}
            {note.signature_data && (
              <div className="flex-shrink-0">
                <img
                  src={note.signature_data}
                  alt="Clinician signature"
                  className="h-16 object-contain bg-white rounded-lg border border-teal-200 px-3 py-1"
                />
              </div>
            )}
            <div className="flex-1">
              <p className="text-sm font-semibold text-teal-800">
                Note Signed
              </p>
              <p className="text-sm text-teal-700 mt-0.5">
                Signed by {note.signed_by} on{" "}
                {formatDateTime(note.signed_at)}
              </p>
              {note.content_hash && (
                <p className="text-xs text-teal-600 mt-1 font-mono">
                  Content Hash: {note.content_hash.slice(0, 16)}...
                </p>
              )}
            </div>
            {note.status === "amended" && (
              <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200 flex-shrink-0">
                Has Amendments
              </span>
            )}
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className={`grid gap-6 ${showTranscript ? "lg:grid-cols-2" : "grid-cols-1"}`}>
        {/* Note editor */}
        <div className="space-y-4">
          {sections.length > 0 ? (
            sections.map((section) => (
              <div
                key={section.key}
                className="bg-white rounded-2xl border border-warm-100 shadow-sm overflow-hidden"
              >
                <div className="px-6 py-3 bg-warm-50 border-b border-warm-100">
                  <h3 className="text-sm font-semibold text-warm-700">
                    {section.label}
                  </h3>
                </div>
                <div className="p-6">
                  <SectionEditor
                    content={editedContent[section.key] || ""}
                    onChange={(html) => handleSectionChange(section.key, html)}
                    placeholder={`Enter ${section.label.toLowerCase()}...`}
                    readOnly={!isEditable}
                  />
                </div>
              </div>
            ))
          ) : (
            // Fallback: render all content keys
            Object.entries(editedContent).map(([key, value]) => (
              <div
                key={key}
                className="bg-white rounded-2xl border border-warm-100 shadow-sm overflow-hidden"
              >
                <div className="px-6 py-3 bg-warm-50 border-b border-warm-100">
                  <h3 className="text-sm font-semibold text-warm-700 capitalize">
                    {key.replace(/_/g, " ")}
                  </h3>
                </div>
                <div className="p-6">
                  <SectionEditor
                    content={value || ""}
                    onChange={(html) => handleSectionChange(key, html)}
                    readOnly={!isEditable}
                  />
                </div>
              </div>
            ))
          )}

          {/* Amendment history */}
          <AmendmentHistory
            amendments={note.amendments || []}
            originalNoteId={note.amendment_of}
            currentNoteId={note.id}
          />

          {/* Metadata footer */}
          <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-warm-400 text-xs uppercase tracking-wide mb-1">
                  Created
                </p>
                <p className="text-warm-700">{formatDateTime(note.created_at)}</p>
              </div>
              <div>
                <p className="text-warm-400 text-xs uppercase tracking-wide mb-1">
                  Updated
                </p>
                <p className="text-warm-700">{formatDateTime(note.updated_at)}</p>
              </div>
              <div>
                <p className="text-warm-400 text-xs uppercase tracking-wide mb-1">
                  Encounter Type
                </p>
                <p className="text-warm-700 capitalize">{note.encounter_type}</p>
              </div>
              <div>
                <p className="text-warm-400 text-xs uppercase tracking-wide mb-1">
                  Source
                </p>
                <p className="text-warm-700 capitalize">{note.encounter_source}</p>
              </div>
            </div>
            {note.signed_at && (
              <div className="mt-4 pt-4 border-t border-warm-100">
                <p className="text-sm text-teal-700">
                  Signed by {note.signed_by} on {formatDateTime(note.signed_at)}
                </p>
                {note.content_hash && (
                  <p className="text-xs text-warm-400 font-mono mt-1">
                    SHA-256: {note.content_hash}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Transcript panel */}
        {showTranscript && (
          <div className="bg-white rounded-2xl border border-warm-100 shadow-sm overflow-hidden sticky top-8 self-start max-h-[calc(100vh-8rem)]">
            <div className="px-6 py-4 bg-warm-50 border-b border-warm-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-warm-700">
                Source Transcript
              </h3>
              <span className="text-xs text-warm-400">
                {note.encounter_created_at
                  ? formatDateTime(note.encounter_created_at)
                  : ""}
              </span>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(100vh-14rem)]">
              {note.transcript ? (
                <div className="text-sm text-warm-600 leading-relaxed whitespace-pre-wrap font-mono">
                  {note.transcript}
                </div>
              ) : (
                <p className="text-warm-400 text-sm italic">
                  No transcript available for this encounter.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Signing modal */}
      {showSigningModal && noteId && (
        <NoteSigningModal
          noteId={noteId}
          noteFormat={note.format}
          onSigned={handleSigned}
          onCancel={() => setShowSigningModal(false)}
        />
      )}
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
