import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useApi } from "../../hooks/useApi";
import { useMinuteTick } from "../../hooks/useSessionWindow";
import { isInSessionWindow } from "../../lib/sessionWindow";
import type { Appointment } from "../../types";

interface DocStatus {
  total: number;
  signed: number;
  pending: number;
  packages: {
    package_id: string;
    package_status: string;
    total: number;
    signed: number;
    pending: number;
  }[];
}

interface PendingReconfirmation {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  type: string;
  status: string;
  meet_link: string | null;
  clinician_email: string | null;
  reconfirmation_token: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

interface ClientProfile {
  exists: boolean;
  status?: "active" | "discharged" | "inactive";
  discharged_at?: string | null;
  intake_completed_at?: string | null;
}

export default function ClientDashboardPage() {
  const { user, bookingEnabled } = useAuth();
  const api = useApi();

  const [nextAppt, setNextAppt] = useState<Appointment | null>(null);
  const [docStatus, setDocStatus] = useState<DocStatus | null>(null);
  const [reconfirmations, setReconfirmations] = useState<PendingReconfirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null);
  useMinuteTick();

  const displayName = user?.displayName?.split(" ")[0] || "there";

  useEffect(() => {
    async function load() {
      try {
        // Load client profile to check status
        try {
          const profile = await api.get<ClientProfile>(`/api/clients/me`);
          setClientProfile(profile);
        } catch {
          // Profile may not exist yet
        }

        // Get upcoming appointments (next 60 days)
        const now = new Date();
        const end = new Date();
        end.setDate(end.getDate() + 60);
        const schedData = await api.get<{ appointments: Appointment[] }>(
          `/api/schedule?start=${now.toISOString()}&end=${end.toISOString()}`
        );
        const upcoming = (schedData.appointments || [])
          .filter((a) => a.status === "scheduled" && new Date(a.scheduled_at) > now)
          .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
        setNextAppt(upcoming[0] || null);

        // Get document signing status
        if (user?.uid) {
          try {
            const docs = await api.get<DocStatus>(`/api/documents/status/${user.uid}`);
            setDocStatus(docs);
          } catch {
            // No docs yet
          }
        }

        // Get pending reconfirmations
        try {
          const reconf = await api.get<{ appointments: PendingReconfirmation[] }>(
            `/api/appointments/my/pending-reconfirmations`
          );
          setReconfirmations(reconf.appointments || []);
        } catch {
          // No pending reconfirmations
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api, user?.uid]);

  async function handleConfirm(appointmentId: string) {
    setConfirmingId(appointmentId);
    try {
      await api.post(`/api/appointments/my/${appointmentId}/confirm`, {});
      setReconfirmations((prev) => prev.filter((r) => r.id !== appointmentId));
    } catch (err) {
      console.error("Failed to confirm:", err);
    } finally {
      setConfirmingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  const isDischarged = clientProfile?.exists && clientProfile.status === "discharged";
  const needsIntake = clientProfile?.exists && !clientProfile.intake_completed_at;

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-3xl mx-auto">
      {/* Welcome header */}
      <div className="mb-8">
        <h1 className="font-display text-2xl md:text-3xl font-bold text-warm-800">
          {needsIntake ? `Welcome, ${displayName}` : `Welcome back, ${displayName}`}
        </h1>
        <p className="text-warm-500 mt-1">
          {isDischarged
            ? "Your treatment has concluded. You can still access your records below."
            : needsIntake
              ? "Let\u2019s get you started."
              : "Here is an overview of your care."}
        </p>
      </div>

      {/* First-time intake prompt */}
      {needsIntake && !isDischarged && (
        <Link
          to="/onboarding"
          className="block mb-6 bg-teal-50 border border-teal-200 rounded-2xl p-5 md:p-6 hover:bg-teal-100 hover:border-teal-300 transition-all"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-teal-600">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-teal-800">Start Your Intake</p>
              <p className="text-sm text-teal-600 mt-0.5">Complete your intake to get started with your care.</p>
            </div>
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-teal-400 ml-auto shrink-0">
              <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </Link>
      )}

      {/* Discharged state banner */}
      {isDischarged && (
        <div className="mb-6">
          <div className="bg-warm-50 border border-warm-200 rounded-2xl p-5 md:p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-warm-100 rounded-xl flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-warm-500">
                  <path
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-semibold text-warm-800">
                  Your treatment has concluded
                </h2>
                <p className="text-sm text-warm-500 mt-1">
                  You have been discharged from active care. Your documents,
                  billing records, and treatment history remain accessible for
                  your records. If you need to resume treatment, please contact
                  your provider.
                </p>
                {clientProfile.discharged_at && (
                  <p className="text-xs text-warm-400 mt-2">
                    Discharged on{" "}
                    {new Date(clientProfile.discharged_at).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pending Reconfirmations — only for active clients */}
      {!isDischarged && reconfirmations.length > 0 && (
        <div className="mb-6">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 md:p-5">
            <h2 className="text-sm font-semibold text-amber-800 uppercase tracking-wide mb-3">
              Confirm Your Appointments
            </h2>
            <div className="space-y-3">
              {reconfirmations.map((r) => (
                <div
                  key={r.id}
                  className="bg-white rounded-xl p-4 border border-amber-100 flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-warm-800">
                      {formatDate(r.scheduled_at)}
                    </p>
                    <p className="text-sm text-warm-500">
                      {formatTime(r.scheduled_at)} -- {r.duration_minutes} min
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirm(r.id)}
                      disabled={confirmingId === r.id}
                      className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
                    >
                      {confirmingId === r.id ? "Confirming..." : "Confirm"}
                    </button>
                    <Link
                      to={`/client/appointments?action=cancel&id=${r.id}`}
                      className="px-4 py-2 border border-warm-300 text-warm-600 text-sm font-medium rounded-lg hover:bg-warm-50 transition-colors"
                    >
                      Change / Cancel
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Next appointment card — only for active clients */}
      {!isDischarged && (
        <div className="mb-6">
          <div className="bg-white rounded-2xl border border-warm-200 shadow-sm p-5 md:p-6">
            <h2 className="text-sm font-semibold text-warm-600 uppercase tracking-wide mb-3">
              Next Appointment
            </h2>
            {nextAppt ? (
              <div>
                <p className="text-lg md:text-xl font-semibold text-warm-800">
                  {formatDate(nextAppt.scheduled_at)}
                </p>
                <p className="text-warm-500 mt-1">
                  {formatTime(nextAppt.scheduled_at)} -- {nextAppt.duration_minutes} min
                  {nextAppt.type === "assessment" ? " (Assessment)" : " (Individual Session)"}
                </p>
                {nextAppt.meet_link && isInSessionWindow(nextAppt.scheduled_at, nextAppt.duration_minutes) && (
                  <a
                    href={nextAppt.meet_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors active:bg-teal-800"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path d="M3.25 4A2.25 2.25 0 001 6.25v7.5A2.25 2.25 0 003.25 16h7.5A2.25 2.25 0 0013 13.75v-1.964l3.914 2.349A.75.75 0 0018 13.5V6.5a.75.75 0 00-1.086-.635L13 8.214V6.25A2.25 2.25 0 0010.75 4h-7.5z" />
                    </svg>
                    Join Session
                  </a>
                )}
              </div>
            ) : (
              <div className="py-4">
                <p className="text-warm-400">No upcoming appointments.</p>
                {bookingEnabled && (
                  <Link
                    to="/client/appointments"
                    className="inline-block mt-3 text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
                  >
                    Schedule an appointment &rarr;
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Documents needing signature — only for active clients */}
      {!isDischarged && docStatus && docStatus.pending > 0 && (
        <div className="mb-6">
          <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5 md:p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-amber-600">
                  <path
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-warm-800">
                  {docStatus.pending} Document{docStatus.pending !== 1 ? "s" : ""} to Sign
                </h2>
                <p className="text-sm text-warm-500 mt-0.5">
                  Please sign your consent forms before your appointment.
                </p>
                <Link
                  to="/client/documents"
                  className="inline-block mt-3 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors active:bg-amber-700"
                >
                  Sign Documents
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div>
        <h2 className="text-sm font-semibold text-warm-600 uppercase tracking-wide mb-3">
          {isDischarged ? "Your Records" : "Quick Actions"}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {!isDischarged && (
            <Link
              to="/client/appointments"
              className="bg-white rounded-xl border border-warm-200 p-4 hover:shadow-sm hover:border-teal-200 transition-all group"
            >
              <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center mb-3 group-hover:bg-teal-100 transition-colors">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-teal-600">
                  <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-sm font-medium text-warm-800">View Appointments</p>
              <p className="text-xs text-warm-400 mt-0.5">{bookingEnabled ? "Schedule or view sessions" : "View your sessions"}</p>
            </Link>
          )}

          <Link
            to="/client/documents"
            className="bg-white rounded-xl border border-warm-200 p-4 hover:shadow-sm hover:border-teal-200 transition-all group"
          >
            <div className="w-10 h-10 bg-sage-50 rounded-lg flex items-center justify-center mb-3 group-hover:bg-sage-100 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-sage-600">
                <path
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-warm-800">Documents</p>
            <p className="text-xs text-warm-400 mt-0.5">
              {isDischarged ? "View your forms" : "Sign or view forms"}
            </p>
          </Link>

          <Link
            to="/client/billing"
            className="bg-white rounded-xl border border-warm-200 p-4 hover:shadow-sm hover:border-teal-200 transition-all group"
          >
            <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center mb-3 group-hover:bg-amber-100 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-amber-600">
                <path
                  d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-warm-800">Billing</p>
            <p className="text-xs text-warm-400 mt-0.5">View superbills</p>
          </Link>

          {!isDischarged && (
            <Link
              to="/onboarding"
              className="bg-white rounded-xl border border-warm-200 p-4 hover:shadow-sm hover:border-teal-200 transition-all group"
            >
              <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center mb-3 group-hover:bg-teal-100 transition-colors">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-teal-600">
                  <path
                    d="M12 1a4 4 0 00-4 4v6a4 4 0 008 0V5a4 4 0 00-4-4z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M19 10v1a7 7 0 01-14 0v-1M12 18v4m-3 0h6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-warm-800">Intake</p>
              <p className="text-xs text-warm-400 mt-0.5">Continue your intake</p>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
