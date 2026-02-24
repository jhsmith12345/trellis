import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useApi } from "../hooks/useApi";
import type { Appointment, PracticeProfile, Clinician } from "../types";

interface UnsignedNote {
  id: string;
  encounter_id: string;
  format: string;
  status: string;
  encounter_type: string;
  client_id: string;
  client_name: string | null;
  client_uuid: string | null;
  created_at: string;
  updated_at: string;
}

interface PlanReviewDue {
  id: string;
  client_id: string;
  client_name: string | null;
  client_uuid: string | null;
  version: number;
  status: string;
  review_date: string | null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function DashboardPage() {
  const { user, isOwner, practiceType } = useAuth();
  const api = useApi();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [profile, setProfile] = useState<PracticeProfile | null>(null);
  const [unsignedNotes, setUnsignedNotes] = useState<UnsignedNote[]>([]);
  const [plansForReview, setPlansForReview] = useState<PlanReviewDue[]>([]);
  const [clinicians, setClinicians] = useState<Clinician[]>([]);
  const [loading, setLoading] = useState(true);
  const isGroup = practiceType === "group";

  const displayName = user?.displayName || user?.email || "Clinician";

  useEffect(() => {
    async function load() {
      try {
        // Fetch today's schedule (today to 7 days out)
        const now = new Date();
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);

        const [scheduleData, profileData, notesData, planReviewData, teamData] = await Promise.all([
          api.get<{ appointments: Appointment[] }>(
            `/api/schedule?start=${start.toISOString()}&end=${end.toISOString()}`
          ),
          api.get<PracticeProfile>("/api/practice-profile"),
          api.get<{ notes: UnsignedNote[]; count: number }>("/api/notes/unsigned").catch(() => ({ notes: [], count: 0 })),
          api.get<{ plans: PlanReviewDue[]; count: number }>("/api/treatment-plans/due-for-review").catch(() => ({ plans: [], count: 0 })),
          isGroup && isOwner
            ? api.get<{ clinicians: Clinician[] }>("/api/practice/team").catch(() => ({ clinicians: [] }))
            : Promise.resolve({ clinicians: [] }),
        ]);

        setClinicians(teamData.clinicians.filter((c) => c.status === "active"));
        setAppointments(
          scheduleData.appointments
            .filter((a) => a.status === "scheduled")
            .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
        );
        setProfile(profileData.exists ? profileData : null);
        setUnsignedNotes(notesData.notes);
        setPlansForReview(planReviewData.plans);
      } catch {
        // silently handle — dashboard still renders
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api]);

  // Split appointments into today vs upcoming
  const todayStr = new Date().toDateString();
  const todayAppts = appointments.filter(
    (a) => new Date(a.scheduled_at).toDateString() === todayStr
  );
  const upcomingAppts = appointments.filter(
    (a) => new Date(a.scheduled_at).toDateString() !== todayStr
  );

  return (
    <div className="px-8 py-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold text-warm-800">
          Welcome back, {displayName.split(" ")[0]}
        </h1>
        <p className="text-warm-500 mt-1">
          {new Date().toLocaleDateString([], {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>

      {/* Setup prompt if no profile */}
      {!loading && !profile && (
        <Link
          to="/settings/practice"
          className="block mb-8 bg-amber-50 border border-amber-200 rounded-2xl p-6 hover:border-amber-300 transition-colors"
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-amber-600">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-1-8a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0V6a1 1 0 0 0-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-warm-800">Complete your practice profile</h3>
              <p className="text-sm text-warm-500 mt-1">
                Add your credentials, contact info, and rates to start accepting clients.
              </p>
            </div>
          </div>
        </Link>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Today's Schedule */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-warm-100 shadow-sm">
          <div className="px-6 py-4 border-b border-warm-100 flex items-center justify-between">
            <h2 className="font-semibold text-warm-800">Today's Schedule</h2>
            <Link
              to="/schedule"
              className="text-sm text-teal-600 hover:text-teal-700 font-medium"
            >
              View full schedule
            </Link>
          </div>
          <div className="p-6">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
              </div>
            ) : todayAppts.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 mx-auto mb-3 bg-warm-50 rounded-full flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-warm-300">
                    <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="text-warm-400 text-sm">No appointments today</p>
              </div>
            ) : (
              <div className="space-y-3">
                {todayAppts.map((appt) => (
                  <div
                    key={appt.id}
                    className="flex items-center gap-4 p-3 rounded-xl bg-warm-50 hover:bg-teal-50/50 transition-colors"
                  >
                    <div className="text-center shrink-0 w-16">
                      <p className="text-sm font-semibold text-teal-700">
                        {formatTime(appt.scheduled_at)}
                      </p>
                      <p className="text-xs text-warm-400">{appt.duration_minutes}m</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-warm-800 truncate">
                        {appt.client_name}
                      </p>
                      <p className="text-xs text-warm-400 capitalize">
                        {appt.type === "assessment" ? "Intake Assessment" : "Individual Session"}
                      </p>
                    </div>
                    {appt.meet_link && (
                      <a
                        href={appt.meet_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 px-3 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
                      >
                        Join Meet
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Upcoming (next 7 days excluding today) */}
            {!loading && upcomingAppts.length > 0 && (
              <div className="mt-6 pt-6 border-t border-warm-100">
                <h3 className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-3">
                  Upcoming This Week
                </h3>
                <div className="space-y-2">
                  {upcomingAppts.slice(0, 5).map((appt) => (
                    <div
                      key={appt.id}
                      className="flex items-center gap-4 px-3 py-2"
                    >
                      <p className="text-xs text-warm-400 w-24 shrink-0">
                        {formatDate(appt.scheduled_at)} {formatTime(appt.scheduled_at)}
                      </p>
                      <p className="text-sm text-warm-700 truncate">
                        {appt.client_name}
                      </p>
                      <span className="text-xs text-warm-400 capitalize ml-auto shrink-0">
                        {appt.type === "assessment" ? "Intake" : "Session"}
                      </span>
                    </div>
                  ))}
                  {upcomingAppts.length > 5 && (
                    <p className="text-xs text-warm-400 px-3">
                      +{upcomingAppts.length - 5} more
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Quick Links */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-6">
            <h2 className="font-semibold text-warm-800 mb-4">Quick Actions</h2>
            <div className="space-y-2">
              <QuickLink to="/clients" label="Client List" desc="View all clients" icon={
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
                </svg>
              } />
              <QuickLink to="/schedule" label="Schedule" desc="Manage availability" icon={
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                  <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              } />
              <QuickLink to="/settings/practice" label="Practice Profile" desc="Edit your info" icon={
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              } />
            </div>
          </div>

          {/* Unsigned Notes Queue */}
          <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-warm-800 flex items-center gap-2">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-amber-500">
                  <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Unsigned Notes
              </h2>
              {unsignedNotes.length > 0 && (
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
                  {unsignedNotes.length}
                </span>
              )}
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <div className="w-5 h-5 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
              </div>
            ) : unsignedNotes.length === 0 ? (
              <div className="text-center py-4">
                <div className="w-10 h-10 mx-auto mb-2 bg-teal-50 rounded-full flex items-center justify-center">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-teal-500">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                  </svg>
                </div>
                <p className="text-warm-400 text-sm">All notes signed</p>
              </div>
            ) : (
              <div className="space-y-2">
                {unsignedNotes.slice(0, 5).map((note) => (
                  <Link
                    key={note.id}
                    to={`/notes/${note.id}`}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-warm-50 transition-colors"
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 ${
                      note.status === "draft" ? "bg-amber-400" : "bg-blue-400"
                    }`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-warm-700 hover:text-teal-700 truncate">
                        {note.client_name || "Unknown Client"}
                      </p>
                      <p className="text-xs text-warm-400">
                        {note.format === "narrative" ? "Assessment" : note.format} &middot; {formatShortDate(note.created_at)} &middot;{" "}
                        <span className={`capitalize ${
                          note.status === "draft" ? "text-amber-600" : "text-blue-600"
                        }`}>
                          {note.status}
                        </span>
                      </p>
                    </div>
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-warm-300 shrink-0">
                      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                    </svg>
                  </Link>
                ))}
                {unsignedNotes.length > 5 && (
                  <p className="text-xs text-warm-400 px-2">
                    +{unsignedNotes.length - 5} more
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Treatment Plans Due for Review */}
          {!loading && plansForReview.length > 0 && (
            <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-warm-800 flex items-center gap-2">
                  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-purple-500">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M9 14l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Plans Due for Review
                </h2>
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold">
                  {plansForReview.length}
                </span>
              </div>
              <div className="space-y-2">
                {plansForReview.slice(0, 5).map((plan) => (
                  <Link
                    key={plan.id}
                    to={`/treatment-plans/${plan.id}`}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-warm-50 transition-colors"
                  >
                    <div className="w-2 h-2 rounded-full shrink-0 bg-purple-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-warm-700 hover:text-teal-700 truncate">
                        {plan.client_name || "Unknown Client"}
                      </p>
                      <p className="text-xs text-warm-400">
                        v{plan.version} &middot; Review by {plan.review_date ? formatShortDate(plan.review_date) : "N/A"}
                      </p>
                    </div>
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-warm-300 shrink-0">
                      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                    </svg>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Stats card */}
          <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-6">
            <h2 className="font-semibold text-warm-800 mb-4">This Week</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-teal-50 rounded-xl">
                <p className="text-2xl font-bold text-teal-700">
                  {loading ? "-" : appointments.length}
                </p>
                <p className="text-xs text-teal-600 mt-0.5">Appointments</p>
              </div>
              <div className="text-center p-3 bg-warm-50 rounded-xl">
                <p className="text-2xl font-bold text-warm-700">
                  {loading ? "-" : todayAppts.length}
                </p>
                <p className="text-xs text-warm-500 mt-0.5">Today</p>
              </div>
            </div>
          </div>

          {/* Team overview (group practice owners only) */}
          {isGroup && isOwner && clinicians.length > 0 && (
            <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-warm-800">Team</h2>
                <Link
                  to="/settings/team"
                  className="text-sm text-teal-600 hover:text-teal-700 font-medium"
                >
                  Manage
                </Link>
              </div>
              <div className="space-y-2">
                {clinicians.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-2 py-1.5">
                    <div className="w-7 h-7 bg-teal-50 rounded-full flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-teal-600">
                        {(c.clinician_name || c.email).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-warm-700 truncate">
                        {c.clinician_name || c.email}
                      </p>
                      <p className="text-xs text-warm-400 capitalize">{c.practice_role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickLink({
  to,
  label,
  desc,
  icon,
}: {
  to: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 p-3 rounded-xl hover:bg-warm-50 transition-colors group"
    >
      <div className="w-9 h-9 bg-teal-50 text-teal-600 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-teal-100 transition-colors">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-warm-800">{label}</p>
        <p className="text-xs text-warm-400">{desc}</p>
      </div>
    </Link>
  );
}
