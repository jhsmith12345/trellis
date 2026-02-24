import { useState, useEffect, useCallback } from "react";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/Button";
import type { Clinician } from "../types";

interface InviteForm {
  email: string;
  clinician_name: string;
  credentials: string;
}

const EMPTY_INVITE: InviteForm = {
  email: "",
  clinician_name: "",
  credentials: "",
};

interface EditForm {
  clinician_name: string;
  credentials: string;
}

const STATUS_BADGE: Record<string, string> = {
  active: "bg-teal-50 text-teal-700",
  invited: "bg-amber-50 text-amber-700",
  deactivated: "bg-warm-100 text-warm-400",
};

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-warm-100 text-warm-600",
  clinician: "bg-white text-warm-500 border border-warm-200",
};

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-warm-600 mb-1">
      {label}
      {required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-4 py-2.5 rounded-xl border border-warm-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-warm-800 text-sm"
      {...props}
    />
  );
}

export default function TeamManagementPage() {
  const api = useApi();
  const { getIdToken } = useAuth();

  const [clinicians, setClinicians] = useState<Clinician[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [invite, setInvite] = useState<InviteForm>(EMPTY_INVITE);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ clinician_name: "", credentials: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

  const loadTeam = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<{ clinicians: Clinician[] }>("/api/practice/team");
      setClinicians(data.clinicians);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  function setInviteField(key: keyof InviteForm, val: string) {
    setInvite((f) => ({ ...f, [key]: val }));
    setInviteError("");
    setInviteSuccess("");
  }

  async function handleInvite() {
    if (!invite.email.trim() || !invite.clinician_name.trim()) return;
    setInviting(true);
    setInviteError("");
    setInviteSuccess("");
    try {
      await api.post("/api/practice/invite", {
        email: invite.email.trim(),
        clinician_name: invite.clinician_name.trim(),
        credentials: invite.credentials.trim() || null,
      });
      setInviteSuccess(`Invitation sent to ${invite.email.trim()}`);
      setInvite(EMPTY_INVITE);
      await loadTeam();
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviting(false);
    }
  }

  function startEdit(clinician: Clinician) {
    setEditingId(clinician.id);
    setEditForm({
      clinician_name: clinician.clinician_name ?? "",
      credentials: clinician.credentials ?? "",
    });
    setEditError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError("");
  }

  async function handleSaveEdit(clinicianId: string) {
    setEditSaving(true);
    setEditError("");
    try {
      await api.patch(`/api/practice/team/${clinicianId}`, {
        clinician_name: editForm.clinician_name.trim() || null,
        credentials: editForm.credentials.trim() || null,
      });
      setEditingId(null);
      await loadTeam();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeactivate(clinicianId: string) {
    setDeactivatingId(clinicianId);
    setConfirmDeactivateId(null);
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/practice/team/${clinicianId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Request failed: ${res.status}`);
      }
      await loadTeam();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to deactivate clinician");
    } finally {
      setDeactivatingId(null);
    }
  }

  const activeCount = clinicians.filter((c) => c.status === "active").length;

  return (
    <div className="px-8 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold text-warm-800">Team Management</h1>
        <p className="text-warm-500 text-sm mt-1">
          {loading
            ? "Loading team..."
            : `${clinicians.length} member${clinicians.length !== 1 ? "s" : ""} · ${activeCount} active`}
        </p>
      </div>

      {/* Invite Form */}
      <div className="bg-white rounded-2xl border border-warm-100 shadow-sm mb-6 px-6 py-6">
        <h2 className="font-semibold text-warm-800 mb-4">Invite Clinician</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <FieldLabel label="Email" required />
            <TextInput
              value={invite.email}
              onChange={(v) => setInviteField("email", v)}
              type="email"
              placeholder="clinician@practice.com"
              disabled={inviting}
            />
          </div>
          <div>
            <FieldLabel label="Full Name" required />
            <TextInput
              value={invite.clinician_name}
              onChange={(v) => setInviteField("clinician_name", v)}
              placeholder="Dr. Jane Smith"
              disabled={inviting}
            />
          </div>
          <div>
            <FieldLabel label="Credentials" />
            <TextInput
              value={invite.credentials}
              onChange={(v) => setInviteField("credentials", v)}
              placeholder="e.g. LCSW, LPC"
              disabled={inviting}
            />
          </div>
        </div>

        <div className="flex items-center gap-4 mt-4">
          <Button
            onClick={handleInvite}
            disabled={inviting || !invite.email.trim() || !invite.clinician_name.trim()}
            size="sm"
          >
            {inviting ? "Sending..." : "Send Invite"}
          </Button>
          {inviteSuccess && (
            <span className="text-sm text-teal-600 font-medium">{inviteSuccess}</span>
          )}
          {inviteError && (
            <span className="text-sm text-red-600">{inviteError}</span>
          )}
        </div>
      </div>

      {/* Global error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* Team Table */}
      <div className="bg-white rounded-2xl border border-warm-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
          </div>
        ) : clinicians.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 mx-auto mb-3 bg-warm-50 rounded-full flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-warm-300">
                <path
                  d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <p className="text-warm-400 text-sm">No team members yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-warm-100 bg-warm-50">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-warm-400 uppercase tracking-wide">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-warm-400 uppercase tracking-wide">
                    Email
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-warm-400 uppercase tracking-wide">
                    Role
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-warm-400 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-warm-400 uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {clinicians.map((clinician) => (
                  <tr
                    key={clinician.id}
                    className="border-b border-warm-50 last:border-b-0 hover:bg-warm-50/40 transition-colors"
                  >
                    {/* Name / Credentials */}
                    <td className="px-6 py-4">
                      {editingId === clinician.id ? (
                        <div className="space-y-2 min-w-[180px]">
                          <TextInput
                            value={editForm.clinician_name}
                            onChange={(v) =>
                              setEditForm((f) => ({ ...f, clinician_name: v }))
                            }
                            placeholder="Full name"
                          />
                          <TextInput
                            value={editForm.credentials}
                            onChange={(v) =>
                              setEditForm((f) => ({ ...f, credentials: v }))
                            }
                            placeholder="Credentials (e.g. LCSW)"
                          />
                          {editError && (
                            <p className="text-xs text-red-600">{editError}</p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <p className="font-medium text-warm-800">
                            {clinician.clinician_name || (
                              <span className="text-warm-400 italic">No name set</span>
                            )}
                          </p>
                          {clinician.credentials && (
                            <p className="text-xs text-warm-400 mt-0.5">
                              {clinician.credentials}
                            </p>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Email */}
                    <td className="px-4 py-4 text-warm-500">{clinician.email}</td>

                    {/* Role */}
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                          ROLE_BADGE[clinician.practice_role] ?? ""
                        }`}
                      >
                        {clinician.practice_role}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                          STATUS_BADGE[clinician.status] ?? ""
                        }`}
                      >
                        {clinician.status}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-6 py-4 text-right">
                      {editingId === clinician.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleSaveEdit(clinician.id)}
                            disabled={editSaving}
                          >
                            {editSaving ? "Saving..." : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={cancelEdit}
                            disabled={editSaving}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : confirmDeactivateId === clinician.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-warm-500 mr-1">Confirm?</span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-400 text-red-600 hover:bg-red-50"
                            onClick={() => handleDeactivate(clinician.id)}
                            disabled={deactivatingId === clinician.id}
                          >
                            {deactivatingId === clinician.id ? "Deactivating..." : "Yes, deactivate"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmDeactivateId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEdit(clinician)}
                          >
                            Edit
                          </Button>
                          {clinician.practice_role !== "owner" &&
                            clinician.status !== "deactivated" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-500 hover:bg-red-50"
                                onClick={() => setConfirmDeactivateId(clinician.id)}
                                disabled={deactivatingId === clinician.id}
                              >
                                Deactivate
                              </Button>
                            )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
