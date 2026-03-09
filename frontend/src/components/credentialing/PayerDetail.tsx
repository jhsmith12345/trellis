import { useState, useEffect, useCallback } from "react";
import { useApi } from "../../hooks/useApi";
import { StatusBadge, ALL_STATUSES, STATUS_LABELS } from "./StatusBadge";
import { Timeline } from "./Timeline";
import { DocumentUpload } from "./DocumentUpload";
import type { CredentialingPayer, TimelineEvent, CredentialingDocument } from "../../pages/CredentialingPage";

interface Props {
  payerId: string;
  onBack: () => void;
  practiceType: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

const DOC_TYPE_LABELS: Record<string, string> = {
  malpractice_cert: "Malpractice Certificate",
  license: "Professional License",
  w9: "W-9 Form",
  caqh_attestation: "CAQH Attestation",
  dea_certificate: "DEA Certificate",
  board_certification: "Board Certification",
  cv_resume: "CV / Resume",
  proof_of_insurance: "Proof of Insurance",
  diploma: "Diploma",
  application_form: "Application Form",
  other: "Other",
};

export function PayerDetail({ payerId, onBack, practiceType: _practiceType }: Props) {
  const api = useApi();
  const [payer, setPayer] = useState<CredentialingPayer | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showFollowup, setShowFollowup] = useState(false);
  const [followupDraft, setFollowupDraft] = useState<{ subject: string; body: string } | null>(null);
  const [followupLoading, setFollowupLoading] = useState(false);
  const [showTimelineForm, setShowTimelineForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // Edit form state
  const [form, setForm] = useState({
    payer_name: "",
    payer_id: "",
    provider_relations_phone: "",
    provider_relations_email: "",
    provider_relations_fax: "",
    portal_url: "",
    effective_date: "",
    expiration_date: "",
    recredential_reminder_days: 90,
    notes: "",
  });

  const loadPayer = useCallback(async () => {
    try {
      const data = await api.get<CredentialingPayer & { timeline: TimelineEvent[]; documents: CredentialingDocument[] }>(
        `/api/credentialing/payers/${payerId}`
      );
      setPayer(data);
      setForm({
        payer_name: data.payer_name || "",
        payer_id: data.payer_id || "",
        provider_relations_phone: data.provider_relations_phone || "",
        provider_relations_email: data.provider_relations_email || "",
        provider_relations_fax: data.provider_relations_fax || "",
        portal_url: data.portal_url || "",
        effective_date: data.effective_date || "",
        expiration_date: data.expiration_date || "",
        recredential_reminder_days: data.recredential_reminder_days || 90,
        notes: data.notes || "",
      });
    } catch (e) {
      console.error("Failed to load payer:", e);
    } finally {
      setLoading(false);
    }
  }, [api, payerId]);

  useEffect(() => {
    loadPayer();
  }, [loadPayer]);

  async function handleSave() {
    setSaving(true);
    try {
      await api.put(`/api/credentialing/payers/${payerId}`, form);
      setEditing(false);
      setSuccessMsg("Saved");
      setTimeout(() => setSuccessMsg(""), 2000);
      loadPayer();
    } catch (e) {
      console.error("Failed to update:", e);
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus: string, denialReason?: string) {
    try {
      await api.patch(`/api/credentialing/payers/${payerId}/status`, {
        status: newStatus,
        denial_reason: denialReason,
      });
      setShowStatusModal(false);
      loadPayer();
    } catch (e) {
      console.error("Failed to update status:", e);
    }
  }

  async function handleDraftFollowup() {
    setFollowupLoading(true);
    setShowFollowup(true);
    try {
      const data = await api.post<{ subject: string; body: string }>(
        `/api/credentialing/payers/${payerId}/draft-followup`,
        {}
      );
      setFollowupDraft(data);
    } catch (e) {
      console.error("Failed to draft followup:", e);
    } finally {
      setFollowupLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this payer enrollment? This cannot be undone.")) return;
    try {
      await api.del(`/api/credentialing/payers/${payerId}`);
      onBack();
    } catch (e) {
      console.error("Failed to delete:", e);
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-5xl flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!payer) {
    return (
      <div className="px-8 py-8 max-w-5xl">
        <p className="text-warm-500">Payer enrollment not found.</p>
        <button onClick={onBack} className="text-teal-600 text-sm mt-2 hover:text-teal-700">Back to list</button>
      </div>
    );
  }

  const isPending = ["application_submitted", "pending"].includes(payer.status);

  return (
    <div className="px-8 py-8 max-w-5xl">
      {/* Back + header */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-warm-400 hover:text-warm-600 transition-colors mb-4"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
        </svg>
        Back to Payer Enrollments
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-display text-2xl font-bold text-warm-800">{payer.payer_name}</h1>
            <StatusBadge status={payer.status} size="md" />
            {successMsg && (
              <span className="text-sm text-emerald-600 font-medium">{successMsg}</span>
            )}
          </div>
          {payer.payer_id && (
            <p className="text-warm-400 text-sm">Payer ID: {payer.payer_id}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isPending && (
            <button
              onClick={handleDraftFollowup}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M3 4a2 2 0 00-2 2v1.161l8.441 4.221a1.25 1.25 0 001.118 0L19 7.162V6a2 2 0 00-2-2H3z" />
                <path d="M19 8.839l-7.77 3.885a2.75 2.75 0 01-2.46 0L1 8.839V14a2 2 0 002 2h14a2 2 0 002-2V8.839z" />
              </svg>
              Draft Follow-up
            </button>
          )}
          <button
            onClick={() => setShowStatusModal(true)}
            className="px-3 py-2 text-sm font-medium text-warm-600 bg-warm-50 rounded-lg hover:bg-warm-100 transition-colors"
          >
            Change Status
          </button>
          <button
            onClick={() => setEditing(!editing)}
            className="px-3 py-2 text-sm font-medium text-warm-600 bg-warm-50 rounded-lg hover:bg-warm-100 transition-colors"
          >
            {editing ? "Cancel Edit" : "Edit"}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main content — 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Details card */}
          <div className="bg-white rounded-2xl border border-warm-100 shadow-sm">
            <div className="px-6 py-4 border-b border-warm-100">
              <h2 className="font-medium text-warm-800">Enrollment Details</h2>
            </div>
            <div className="p-6 space-y-5">
              {editing ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Payer Name" value={form.payer_name} onChange={(v) => setForm({ ...form, payer_name: v })} />
                    <Field label="Payer ID / EDI ID" value={form.payer_id} onChange={(v) => setForm({ ...form, payer_id: v })} placeholder="Optional" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Effective Date" value={form.effective_date} onChange={(v) => setForm({ ...form, effective_date: v })} type="date" />
                    <Field label="Expiration Date" value={form.expiration_date} onChange={(v) => setForm({ ...form, expiration_date: v })} type="date" />
                  </div>
                  <Field
                    label="Re-credential Reminder (days before expiration)"
                    value={String(form.recredential_reminder_days)}
                    onChange={(v) => setForm({ ...form, recredential_reminder_days: parseInt(v) || 90 })}
                    type="number"
                  />
                  <div>
                    <p className="text-sm font-medium text-warm-600 mb-2">Provider Relations Contact</p>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Phone" value={form.provider_relations_phone} onChange={(v) => setForm({ ...form, provider_relations_phone: v })} placeholder="Phone" small />
                      <Field label="Email" value={form.provider_relations_email} onChange={(v) => setForm({ ...form, provider_relations_email: v })} placeholder="Email" small />
                      <Field label="Fax" value={form.provider_relations_fax} onChange={(v) => setForm({ ...form, provider_relations_fax: v })} placeholder="Fax" small />
                    </div>
                  </div>
                  <Field label="Portal URL" value={form.portal_url} onChange={(v) => setForm({ ...form, portal_url: v })} placeholder="https://" />
                  <div>
                    <label className="block text-xs font-medium text-warm-500 mb-1">Notes</label>
                    <textarea
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 border border-warm-200 rounded-lg text-sm text-warm-800 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={handleDelete}
                      className="px-3 py-2 text-sm text-red-500 hover:text-red-700 transition-colors mr-auto"
                    >
                      Delete Enrollment
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="px-4 py-2 text-sm font-medium text-warm-500 hover:text-warm-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
                    >
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-y-4 gap-x-8 text-sm">
                    <Detail label="Payer ID" value={payer.payer_id} />
                    <Detail label="Status" value={<StatusBadge status={payer.status} />} />
                    <Detail label="Submitted" value={formatDate(payer.application_submitted_at)} />
                    <Detail label="Credentialed" value={formatDate(payer.credentialed_at)} />
                    <Detail label="Effective Date" value={formatDate(payer.effective_date)} />
                    <Detail label="Expiration Date" value={formatDate(payer.expiration_date)} />
                    <Detail label="Reminder" value={payer.recredential_reminder_days ? `${payer.recredential_reminder_days} days before expiry` : "—"} />
                    {payer.denial_reason && <Detail label="Denial Reason" value={payer.denial_reason} />}
                  </div>
                  {(payer.provider_relations_phone || payer.provider_relations_email || payer.portal_url) && (
                    <div className="pt-4 border-t border-warm-50">
                      <p className="text-xs font-medium text-warm-400 uppercase tracking-wider mb-3">Provider Relations</p>
                      <div className="grid grid-cols-2 gap-y-3 gap-x-8 text-sm">
                        <Detail label="Phone" value={payer.provider_relations_phone} />
                        <Detail label="Email" value={payer.provider_relations_email} />
                        <Detail label="Fax" value={payer.provider_relations_fax} />
                        {payer.portal_url && (
                          <div>
                            <p className="text-warm-400 text-xs mb-0.5">Portal</p>
                            <a href={payer.portal_url} target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:text-teal-700 text-sm">
                              {payer.portal_url.replace(/^https?:\/\//, "").slice(0, 40)}
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {payer.notes && (
                    <div className="pt-4 border-t border-warm-50">
                      <p className="text-xs font-medium text-warm-400 uppercase tracking-wider mb-2">Notes</p>
                      <p className="text-sm text-warm-600 whitespace-pre-wrap">{payer.notes}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Documents card */}
          <div className="bg-white rounded-2xl border border-warm-100 shadow-sm">
            <div className="px-6 py-4 border-b border-warm-100 flex items-center justify-between">
              <h2 className="font-medium text-warm-800">Documents</h2>
              <button
                onClick={() => setShowUpload(true)}
                className="text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
              >
                + Upload
              </button>
            </div>
            <div className="p-6">
              {payer.documents && payer.documents.length > 0 ? (
                <div className="space-y-3">
                  {payer.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-warm-50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 bg-warm-50 rounded-lg flex items-center justify-center shrink-0">
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-warm-400">
                            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-warm-700 truncate">{doc.file_name}</p>
                          <p className="text-xs text-warm-400">
                            {DOC_TYPE_LABELS[doc.document_type] || doc.document_type}
                            {doc.expiration_date && ` · Expires ${formatDate(doc.expiration_date)}`}
                            {doc.document_number && ` · #${doc.document_number}`}
                          </p>
                        </div>
                      </div>
                      {doc.verified && (
                        <span className="text-xs text-emerald-600 font-medium">Verified</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-warm-400 text-center py-4">No documents uploaded for this payer yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar — timeline */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-warm-100 shadow-sm">
            <div className="px-5 py-4 border-b border-warm-100 flex items-center justify-between">
              <h2 className="font-medium text-warm-800 text-sm">Activity Timeline</h2>
              <button
                onClick={() => setShowTimelineForm(!showTimelineForm)}
                className="text-xs font-medium text-teal-600 hover:text-teal-700 transition-colors"
              >
                + Add Note
              </button>
            </div>
            <div className="p-5">
              {showTimelineForm && (
                <TimelineForm
                  payerId={payerId}
                  onCreated={() => { setShowTimelineForm(false); loadPayer(); }}
                  onCancel={() => setShowTimelineForm(false)}
                />
              )}
              <Timeline events={payer.timeline || []} />
            </div>
          </div>
        </div>
      </div>

      {/* Status change modal */}
      {showStatusModal && (
        <StatusChangeModal
          currentStatus={payer.status}
          onConfirm={handleStatusChange}
          onClose={() => setShowStatusModal(false)}
        />
      )}

      {/* Document upload modal */}
      {showUpload && (
        <DocumentUpload
          payerId={payerId}
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); loadPayer(); }}
        />
      )}

      {/* Follow-up draft modal */}
      {showFollowup && (
        <FollowupModal
          draft={followupDraft}
          loading={followupLoading}
          onClose={() => { setShowFollowup(false); setFollowupDraft(null); }}
        />
      )}
    </div>
  );
}


function Field({ label, value, onChange, placeholder, type = "text", small }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; small?: boolean;
}) {
  return (
    <div>
      <label className={`block ${small ? "text-[11px]" : "text-xs"} font-medium text-warm-500 mb-1`}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-warm-200 rounded-lg text-sm text-warm-800 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-warm-400 text-xs mb-0.5">{label}</p>
      <div className="text-warm-700">{value || "—"}</div>
    </div>
  );
}


function StatusChangeModal({ currentStatus, onConfirm, onClose }: {
  currentStatus: string;
  onConfirm: (status: string, reason?: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [denialReason, setDenialReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl border border-warm-100 p-6 w-full max-w-sm">
        <h3 className="font-display text-lg font-semibold text-warm-800 mb-1">Change Status</h3>
        <p className="text-sm text-warm-400 mb-4">
          Current: <StatusBadge status={currentStatus} />
        </p>
        <div className="space-y-2 mb-4">
          {ALL_STATUSES.filter((s) => s !== currentStatus).map((s) => (
            <button
              key={s}
              onClick={() => setSelected(s)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                selected === s
                  ? "border-teal-500 bg-teal-50 text-teal-700"
                  : "border-warm-100 hover:border-warm-200 text-warm-700"
              }`}
            >
              <StatusBadge status={s} /> <span className="ml-1">{STATUS_LABELS[s]}</span>
            </button>
          ))}
        </div>
        {selected === "denied" && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-warm-500 mb-1">Denial Reason</label>
            <textarea
              value={denialReason}
              onChange={(e) => setDenialReason(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-warm-200 rounded-lg text-sm text-warm-800 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              placeholder="Optional reason for denial"
            />
          </div>
        )}
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-warm-500 hover:text-warm-700 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => selected && onConfirm(selected, selected === "denied" ? denialReason : undefined)}
            disabled={!selected}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            Update Status
          </button>
        </div>
      </div>
    </div>
  );
}


function TimelineForm({ payerId, onCreated, onCancel }: { payerId: string; onCreated: () => void; onCancel: () => void }) {
  const api = useApi();
  const [eventType, setEventType] = useState("note");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setSaving(true);
    try {
      await api.post(`/api/credentialing/payers/${payerId}/timeline`, {
        event_type: eventType,
        description: description.trim(),
      });
      onCreated();
    } catch (err) {
      console.error("Failed to add event:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 pb-4 border-b border-warm-100">
      <select
        value={eventType}
        onChange={(e) => setEventType(e.target.value)}
        className="w-full text-xs border border-warm-200 rounded-lg px-2.5 py-1.5 text-warm-700 mb-2 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
      >
        <option value="note">Note</option>
        <option value="follow_up_call">Follow-up Call</option>
        <option value="follow_up_email">Follow-up Email</option>
        <option value="document_requested">Document Requested</option>
        <option value="other">Other</option>
      </select>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="What happened?"
        className="w-full px-2.5 py-1.5 border border-warm-200 rounded-lg text-xs text-warm-800 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 mb-2"
        autoFocus
      />
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="text-xs text-warm-400 hover:text-warm-600">Cancel</button>
        <button
          type="submit"
          disabled={!description.trim() || saving}
          className="px-3 py-1 bg-teal-600 text-white text-xs font-medium rounded-md hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Adding..." : "Add"}
        </button>
      </div>
    </form>
  );
}


function FollowupModal({ draft, loading, onClose }: {
  draft: { subject: string; body: string } | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl border border-warm-100 p-6 w-full max-w-lg">
        <h3 className="font-display text-lg font-semibold text-warm-800 mb-1">
          AI-Drafted Follow-up
        </h3>
        <p className="text-xs text-warm-400 mb-4">
          Generated from your application details and timeline. Copy and customize as needed.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
            <span className="text-sm text-warm-400 ml-3">Drafting message...</span>
          </div>
        ) : draft ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-warm-500 mb-1">Subject</label>
              <input
                type="text"
                value={draft.subject}
                readOnly
                className="w-full px-3 py-2 border border-warm-200 rounded-lg text-sm text-warm-800 bg-warm-50"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-warm-500 mb-1">Body</label>
              <textarea
                value={draft.body}
                readOnly
                rows={10}
                className="w-full px-3 py-2 border border-warm-200 rounded-lg text-sm text-warm-800 bg-warm-50 leading-relaxed"
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-warm-500 hover:text-warm-700 transition-colors">
                Close
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
                }}
                className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
              >
                Copy to Clipboard
              </button>
            </div>
          </div>
        ) : (
          <p className="text-warm-400 text-sm py-8 text-center">Failed to generate follow-up. Please try again.</p>
        )}
      </div>
    </div>
  );
}
