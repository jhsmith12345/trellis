import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useApi } from "../../hooks/useApi";
import { useMinuteTick } from "../../hooks/useSessionWindow";
import { isInSessionWindow } from "../../lib/sessionWindow";
import type { Appointment, TimeSlot } from "../../types";

interface ClientProfile {
  exists: boolean;
  status?: "active" | "discharged" | "inactive";
  discharged_at?: string | null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PracticeProfile {
  exists: boolean;
  clinician_uid?: string;
  clinician_name?: string;
  practice_name?: string;
  email?: string;
  default_session_duration?: number;
  intake_duration?: number;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

const TYPE_LABELS: Record<string, string> = {
  assessment: "Assessment",
  individual: "Individual Session",
  individual_extended: "Extended Session",
};

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-teal-50 text-teal-700",
  completed: "bg-sage-100 text-sage-700",
  cancelled: "bg-warm-200 text-warm-500",
  no_show: "bg-red-50 text-red-700",
  released: "bg-warm-200 text-warm-500",
};

type TabKey = "upcoming" | "past" | "book" | "recurring";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClientAppointmentsPage() {
  const { user } = useAuth();
  const api = useApi();
  const [searchParams] = useSearchParams();

  const [tab, setTab] = useState<TabKey>("upcoming");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [reconfirmations, setReconfirmations] = useState<PendingReconfirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [practice, setPractice] = useState<PracticeProfile | null>(null);
  useMinuteTick();

  // Booking state
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [bookingType, setBookingType] = useState<"individual" | "assessment">("individual");
  const [cadence, setCadence] = useState<"once" | "weekly" | "biweekly" | "monthly">("once");
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [error, setError] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null);

  const isDischarged = clientProfile?.exists && clientProfile.status === "discharged";

  // Load practice profile + appointments
  const loadData = useCallback(async () => {
    try {
      // Load client profile to check discharge status
      try {
        const profile = await api.get<ClientProfile>("/api/clients/me");
        setClientProfile(profile);
      } catch {
        // Profile may not exist yet
      }

      // Get practice profile for clinician info
      const p = await api.get<PracticeProfile>("/api/practice-profile");
      setPractice(p);

      // Get appointments (past 90 days + future 90 days)
      const start = new Date();
      start.setDate(start.getDate() - 90);
      const end = new Date();
      end.setDate(end.getDate() + 90);
      const data = await api.get<{ appointments: Appointment[] }>(
        `/api/schedule?start=${start.toISOString()}&end=${end.toISOString()}`
      );
      setAppointments(data.appointments || []);

      // Get pending reconfirmations
      try {
        const reconf = await api.get<{ appointments: PendingReconfirmation[] }>(
          `/api/appointments/my/pending-reconfirmations`
        );
        setReconfirmations(reconf.appointments || []);
      } catch {
        // No pending
      }
    } catch (err) {
      console.error("Failed to load appointments:", err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle URL params for cancel/change action from dashboard
  useEffect(() => {
    const action = searchParams.get("action");
    if (action === "cancel") {
      setTab("upcoming");
    }
  }, [searchParams]);

  // Separate upcoming and past
  const now = new Date();
  const upcoming = useMemo(
    () =>
      appointments
        .filter((a) => a.status === "scheduled" && new Date(a.scheduled_at) > now)
        .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()),
    [appointments]
  );

  const past = useMemo(
    () =>
      appointments
        .filter((a) => a.status !== "scheduled" || new Date(a.scheduled_at) <= now)
        .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())
        .slice(0, 10),
    [appointments]
  );

  // Load slots for booking
  async function loadSlots() {
    if (!practice?.clinician_uid) return;
    setSlotsLoading(true);
    setError("");
    try {
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 28);
      const params = new URLSearchParams({
        clinician_id: practice.clinician_uid,
        start: start.toISOString(),
        end: end.toISOString(),
        type: bookingType,
      });
      const data = await api.get<{ slots: TimeSlot[] }>(`/api/appointments/slots?${params}`);
      setSlots(data.slots || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSlotsLoading(false);
    }
  }

  // Book appointment
  async function handleBook() {
    if (!selectedSlot || !practice?.clinician_uid || !user) return;
    setBooking(true);
    setError("");
    try {
      await api.post("/api/appointments", {
        client_id: user.uid,
        client_email: user.email || "",
        client_name: user.displayName || user.email || "",
        clinician_id: practice.clinician_uid,
        clinician_email: practice.email || "",
        type: bookingType,
        scheduled_at: selectedSlot.start,
        duration_minutes: practice.default_session_duration || 60,
        ...(bookingType === "individual" && cadence !== "once" ? { cadence } : {}),
      });
      setBookingSuccess(true);
      setSelectedSlot(null);
      setSlots([]);
      // Reload appointments
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBooking(false);
    }
  }

  // Confirm reconfirmation
  async function handleConfirm(appointmentId: string) {
    setConfirmingId(appointmentId);
    try {
      await api.post(`/api/appointments/my/${appointmentId}/confirm`, {});
      setReconfirmations((prev) => prev.filter((r) => r.id !== appointmentId));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setConfirmingId(null);
    }
  }

  // Cancel appointment
  async function handleCancel(appointmentId: string) {
    setCancellingId(appointmentId);
    try {
      await api.post(`/api/appointments/my/${appointmentId}/cancel`, {});
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCancellingId(null);
    }
  }

  // Group slots by date for display
  const slotsByDate = useMemo(() => {
    const groups: Record<string, TimeSlot[]> = {};
    for (const s of slots) {
      const date = formatDateLong(s.start);
      if (!groups[date]) groups[date] = [];
      groups[date].push(s);
    }
    return groups;
  }, [slots]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-3xl mx-auto">
      <h1 className="font-display text-2xl md:text-3xl font-bold text-warm-800 mb-6">
        Appointments
      </h1>

      {/* Discharged banner */}
      {isDischarged && (
        <div className="mb-6 bg-warm-50 border border-warm-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-warm-400 mt-0.5 shrink-0">
              <path
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-warm-700">Your treatment has concluded</p>
              <p className="text-xs text-warm-500 mt-0.5">
                Scheduling is no longer available. Your past appointment history is below for your records.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-warm-100 rounded-xl p-1 mb-6 overflow-x-auto">
        {(
          [
            { key: "upcoming" as TabKey, label: "Upcoming" },
            { key: "past" as TabKey, label: "Past" },
            ...(!isDischarged
              ? [
                  { key: "book" as TabKey, label: "Book Session" },
                  { key: "recurring" as TabKey, label: "Recurring" },
                ]
              : []),
          ]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setBookingSuccess(false);
              setError("");
            }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
              tab === t.key
                ? "bg-white text-warm-800 shadow-sm"
                : "text-warm-500 hover:text-warm-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* Pending Reconfirmations (shown in upcoming tab) */}
      {tab === "upcoming" && reconfirmations.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wide mb-3">
            Needs Your Response
          </h2>
          <div className="space-y-3">
            {reconfirmations.map((r) => (
              <div
                key={r.id}
                className="bg-amber-50 border border-amber-200 rounded-xl p-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-warm-800">
                      {formatDate(r.scheduled_at)} at {formatTime(r.scheduled_at)}
                    </p>
                    <p className="text-xs text-warm-500">
                      {TYPE_LABELS[r.type] || r.type} -- {r.duration_minutes} min
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirm(r.id)}
                      disabled={confirmingId === r.id}
                      className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 active:bg-teal-800"
                    >
                      {confirmingId === r.id ? "..." : "Confirm"}
                    </button>
                    <button
                      onClick={() => handleCancel(r.id)}
                      disabled={cancellingId === r.id}
                      className="px-4 py-2 border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {cancellingId === r.id ? "..." : "Skip"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming tab */}
      {tab === "upcoming" && (
        <div>
          {upcoming.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-2xl border border-warm-200">
              <p className="text-warm-400 mb-3">No upcoming appointments.</p>
              {!isDischarged && (
                <button
                  onClick={() => setTab("book")}
                  className="text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
                >
                  Book a session &rarr;
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {upcoming.map((a) => (
                <div
                  key={a.id}
                  className="bg-white rounded-xl border border-warm-200 p-4 hover:shadow-sm transition-shadow"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700">
                          {TYPE_LABELS[a.type] || a.type}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-warm-800">
                        {formatDate(a.scheduled_at)}
                      </p>
                      <p className="text-sm text-warm-500">
                        {formatTime(a.scheduled_at)} -- {a.duration_minutes} min
                      </p>
                    </div>
                    <div className="flex gap-2 items-center">
                      {a.meet_link && isInSessionWindow(a.scheduled_at, a.duration_minutes) ? (
                        <a
                          href={a.meet_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors active:bg-teal-800"
                        >
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                            <path d="M3.25 4A2.25 2.25 0 001 6.25v7.5A2.25 2.25 0 003.25 16h7.5A2.25 2.25 0 0013 13.75v-1.964l3.914 2.349A.75.75 0 0018 13.5V6.5a.75.75 0 00-1.086-.635L13 8.214V6.25A2.25 2.25 0 0010.75 4h-7.5z" />
                          </svg>
                          Join
                        </a>
                      ) : a.meet_link ? (
                        <span className="text-xs text-teal-600 font-medium px-2 py-1 bg-teal-50 rounded-lg">
                          Meet link ready
                        </span>
                      ) : (
                        <span className="text-xs text-warm-400 px-2 py-1">
                          No Meet link
                        </span>
                      )}
                      <button
                        onClick={() => handleCancel(a.id)}
                        disabled={cancellingId === a.id}
                        className="text-xs text-warm-400 hover:text-red-500 transition-colors p-2"
                        title="Cancel appointment"
                      >
                        {cancellingId === a.id ? (
                          <span className="text-warm-400">...</span>
                        ) : (
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                            <path
                              fillRule="evenodd"
                              d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Past tab */}
      {tab === "past" && (
        <div>
          {past.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-2xl border border-warm-200">
              <p className="text-warm-400">No past appointments.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {past.map((a) => (
                <div
                  key={a.id}
                  className="bg-white rounded-xl border border-warm-200 p-4 opacity-80"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-warm-100 text-warm-500">
                      {TYPE_LABELS[a.type] || a.type}
                    </span>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        STATUS_STYLES[a.status] || ""
                      }`}
                    >
                      {a.status}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-warm-700">
                    {formatDate(a.scheduled_at)}
                  </p>
                  <p className="text-sm text-warm-400">
                    {formatTime(a.scheduled_at)} -- {a.duration_minutes} min
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Book session tab */}
      {tab === "book" && (
        <div className="bg-white rounded-2xl border border-warm-200 shadow-sm p-5 md:p-6">
          {bookingSuccess ? (
            <div className="text-center py-8">
              <div className="w-14 h-14 mx-auto mb-4 bg-teal-100 rounded-full flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-teal-600">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-warm-800 mb-2">Appointment Booked</h3>
              <p className="text-warm-500 mb-1">
                {bookingType === "individual"
                  ? cadence === "once"
                    ? "Your session has been scheduled."
                    : `${cadence === "weekly" ? "4 weekly" : cadence === "biweekly" ? "4 biweekly" : "4 monthly"} sessions have been scheduled.`
                  : "Your assessment has been scheduled."}
              </p>
              <p className="text-sm text-warm-400">Calendar invites have been sent.</p>
              <button
                onClick={() => {
                  setBookingSuccess(false);
                  setSlots([]);
                  setSelectedSlot(null);
                  setTab("upcoming");
                }}
                className="mt-6 px-4 py-2 border border-warm-300 text-warm-600 text-sm font-medium rounded-lg hover:bg-warm-50 transition-colors"
              >
                View Appointments
              </button>
            </div>
          ) : !selectedSlot ? (
            <div>
              <h2 className="text-lg font-semibold text-warm-800 mb-4">Book a Session</h2>

              {/* Type selection */}
              <div className="mb-5">
                <label className="block text-sm font-medium text-warm-700 mb-2">
                  Session Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      { value: "assessment" as const, label: "Assessment", desc: "Initial evaluation" },
                      { value: "individual" as const, label: "Individual", desc: "Recurring sessions" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setBookingType(opt.value)}
                      className={`text-left p-4 rounded-xl border-2 transition-all ${
                        bookingType === opt.value
                          ? "border-teal-500 bg-teal-50"
                          : "border-warm-200 hover:border-teal-300"
                      }`}
                    >
                      <p className="text-sm font-semibold text-warm-800">{opt.label}</p>
                      <p className="text-xs text-warm-500 mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Cadence selection (only for individual) */}
              {bookingType === "individual" && (
                <div className="mb-5">
                  <label className="block text-sm font-medium text-warm-700 mb-2">
                    Frequency
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {(
                      [
                        { value: "once" as const, label: "Once" },
                        { value: "weekly" as const, label: "Weekly" },
                        { value: "biweekly" as const, label: "Every 2 Weeks" },
                        { value: "monthly" as const, label: "Monthly" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setCadence(opt.value)}
                        className={`px-4 py-2 text-sm font-medium rounded-lg border transition-all ${
                          cadence === opt.value
                            ? "border-teal-500 bg-teal-50 text-teal-700"
                            : "border-warm-200 text-warm-600 hover:border-teal-300"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={loadSlots}
                disabled={slotsLoading || !practice?.clinician_uid}
                className="w-full sm:w-auto px-6 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 active:bg-teal-800"
              >
                {slotsLoading ? "Loading..." : "Find Available Slots"}
              </button>

              {/* Slot selection */}
              {slots.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-warm-600 uppercase tracking-wide mb-3">
                    Available Times
                  </h3>
                  <div className="space-y-4 max-h-[400px] overflow-y-auto">
                    {Object.entries(slotsByDate).map(([date, daySlots]) => (
                      <div key={date}>
                        <h4 className="text-sm font-semibold text-warm-700 mb-2 sticky top-0 bg-white py-1">
                          {date}
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {daySlots.map((s) => {
                            const t = new Date(s.start);
                            const label = t.toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            });
                            return (
                              <button
                                key={s.start}
                                onClick={() => setSelectedSlot(s)}
                                className="px-4 py-2.5 rounded-lg text-sm font-medium border border-warm-200 text-warm-700 hover:border-teal-400 hover:bg-teal-50 transition-all active:bg-teal-100"
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {slots.length === 0 && !slotsLoading && practice?.clinician_uid && (
                <p className="mt-4 text-sm text-warm-400">
                  Click "Find Available Slots" to see open times.
                </p>
              )}
            </div>
          ) : (
            /* Confirm booking */
            <div>
              <h2 className="text-lg font-semibold text-warm-800 mb-4">Confirm Booking</h2>
              <div className="bg-warm-50 rounded-xl p-5 space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-warm-500">Type</span>
                  <span className="font-medium text-warm-800">
                    {TYPE_LABELS[bookingType] || bookingType}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-warm-500">Date & Time</span>
                  <span className="font-medium text-warm-800">
                    {formatDateLong(selectedSlot.start)} at {formatTime(selectedSlot.start)}
                  </span>
                </div>
                {bookingType === "individual" && (
                  <div className="flex justify-between text-sm">
                    <span className="text-warm-500">Frequency</span>
                    <span className="font-medium text-warm-800 capitalize">{cadence === "once" ? "One-time" : cadence}</span>
                  </div>
                )}
                {practice?.clinician_name && (
                  <div className="flex justify-between text-sm">
                    <span className="text-warm-500">Clinician</span>
                    <span className="font-medium text-warm-800">{practice.clinician_name}</span>
                  </div>
                )}
                {bookingType === "individual" && cadence !== "once" && (
                  <div className="border-t border-warm-200 pt-3 mt-3">
                    <p className="text-sm text-teal-700 font-medium">
                      This will create 4 {cadence} sessions at this time.
                    </p>
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setSelectedSlot(null)}
                  className="px-5 py-2.5 text-sm font-medium text-warm-600 hover:bg-warm-100 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleBook}
                  disabled={booking}
                  className="px-6 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 active:bg-teal-800"
                >
                  {booking ? "Booking..." : "Confirm Booking"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recurring series tab */}
      {tab === "recurring" && (
        <div className="bg-white rounded-2xl border border-warm-200 shadow-sm p-5 md:p-6">
          <h2 className="text-lg font-semibold text-warm-800 mb-2">Set Up Recurring Sessions</h2>
          <p className="text-sm text-warm-500 mb-6">
            After your first session, set up a regular recurring appointment at a time that works for you.
          </p>

          <div className="space-y-5">
            {/* Cadence */}
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-2">
                How often?
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { value: "weekly" as const, label: "Weekly" },
                    { value: "biweekly" as const, label: "Every 2 Weeks" },
                    { value: "monthly" as const, label: "Monthly" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setCadence(opt.value)}
                    className={`px-4 py-3 text-sm font-medium rounded-lg border transition-all ${
                      cadence === opt.value
                        ? "border-teal-500 bg-teal-50 text-teal-700"
                        : "border-warm-200 text-warm-600 hover:border-teal-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Load slots */}
            <div>
              <button
                onClick={() => {
                  setBookingType("individual");
                  loadSlots();
                }}
                disabled={slotsLoading || !practice?.clinician_uid}
                className="w-full sm:w-auto px-6 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 active:bg-teal-800"
              >
                {slotsLoading ? "Loading..." : "See Available Times"}
              </button>
            </div>

            {/* Slot selection */}
            {slots.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-warm-600 uppercase tracking-wide mb-3">
                  Pick Your Preferred Time
                </h3>
                <div className="space-y-4 max-h-[400px] overflow-y-auto">
                  {Object.entries(slotsByDate).map(([date, daySlots]) => (
                    <div key={date}>
                      <h4 className="text-sm font-semibold text-warm-700 mb-2 sticky top-0 bg-white py-1">
                        {date}
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {daySlots.map((s) => {
                          const t = new Date(s.start);
                          const label = t.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          });
                          const selected = selectedSlot?.start === s.start;
                          return (
                            <button
                              key={s.start}
                              onClick={() => setSelectedSlot(s)}
                              className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                                selected
                                  ? "border-teal-500 bg-teal-50 text-teal-700"
                                  : "border-warm-200 text-warm-700 hover:border-teal-400 hover:bg-teal-50"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {selectedSlot && (
                  <div className="mt-6 bg-warm-50 rounded-xl p-4">
                    <p className="text-sm text-warm-700">
                      <strong>Selected:</strong> {formatDateLong(selectedSlot.start)} at{" "}
                      {formatTime(selectedSlot.start)} ({cadence})
                    </p>
                    <p className="text-xs text-warm-500 mt-1">
                      This will create 4 {cadence} sessions starting at this time.
                    </p>
                    <button
                      onClick={handleBook}
                      disabled={booking}
                      className="mt-3 px-6 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 active:bg-teal-800"
                    >
                      {booking ? "Booking..." : "Set Up Recurring Sessions"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
