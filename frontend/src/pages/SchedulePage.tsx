import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../hooks/useAuth";
import { useApi } from "../hooks/useApi";
import { useScheduleApi } from "../hooks/useScheduleApi";
import { WeekCalendar } from "../components/scheduling/WeekCalendar";
import { AvailabilityEditor } from "../components/scheduling/AvailabilityEditor";
import { BookingFlow } from "../components/scheduling/BookingFlow";
import { AppointmentCard } from "../components/scheduling/AppointmentCard";
import { LoadingSpinner } from "../components/LoadingSpinner";
import type { Appointment, GroupSession, AvailabilityWindow, Clinician } from "../types";

const TABS = [
  { key: "schedule", label: "Schedule" },
  { key: "book", label: "Book Appointment" },
  { key: "availability", label: "Set Availability" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function getWeekRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

export default function SchedulePage() {
  const { user, isOwner, practiceType } = useAuth();
  const genApi = useApi();
  const api = useScheduleApi();
  const isGroup = practiceType === "group";

  const [tab, setTab] = useState<TabKey>("schedule");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [groupSessions, setGroupSessions] = useState<GroupSession[]>([]);
  const [availabilityWindows, setAvailabilityWindows] = useState<AvailabilityWindow[]>([]);
  const [clinicians, setClinicians] = useState<Clinician[]>([]);
  const [selectedClinicianId, setSelectedClinicianId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekRange, setWeekRange] = useState(getWeekRange);

  const loadSchedule = useCallback(
    async (start?: string, end?: string) => {
      const s = start || weekRange.start;
      const e = end || weekRange.end;
      try {
        let url = `/api/schedule?start=${encodeURIComponent(s)}&end=${encodeURIComponent(e)}`;
        if (isGroup && isOwner && selectedClinicianId) {
          url += `&clinician_id=${encodeURIComponent(selectedClinicianId)}`;
        }
        const data = await genApi.get<{ appointments: Appointment[]; group_sessions?: GroupSession[] }>(url);
        setAppointments(data.appointments || []);
        setGroupSessions(data.group_sessions || []);
      } catch (err) {
        console.error("Failed to load schedule:", err);
      }
    },
    [genApi, weekRange, isGroup, isOwner, selectedClinicianId],
  );

  const loadAvailability = useCallback(async () => {
    try {
      const w = await api.getAvailability();
      setAvailabilityWindows(w);
    } catch (err) {
      console.error("Failed to load availability:", err);
    }
  }, [api]);

  useEffect(() => {
    async function init() {
      if (isGroup && isOwner) {
        try {
          const team = await genApi.get<{ clinicians: Clinician[] }>("/api/practice/team");
          setClinicians(team.clinicians.filter((c) => c.status === "active"));
        } catch {
          // ignore
        }
      }
      await Promise.all([loadSchedule(), loadAvailability()]);
      setLoading(false);
    }
    init();
  }, [loadSchedule, loadAvailability, isGroup, isOwner, genApi]);

  function handleWeekChange(start: string, end: string) {
    setWeekRange({ start, end });
    loadSchedule(start, end);
  }

  async function handleCancel(id: string) {
    await api.updateAppointment(id, "cancelled");
    await loadSchedule();
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="px-8 py-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl font-bold text-warm-800">Schedule</h1>
        {isGroup && isOwner && clinicians.length > 0 && (
          <select
            value={selectedClinicianId || ""}
            onChange={(e) => {
              setSelectedClinicianId(e.target.value || null);
            }}
            className="px-4 py-2 rounded-xl border border-warm-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-warm-800 text-sm bg-white"
          >
            <option value="">All Clinicians</option>
            {clinicians.map((c) => (
              <option key={c.firebase_uid} value={c.firebase_uid}>
                {c.clinician_name || c.email}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-warm-100 rounded-xl p-1 mb-8 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              tab === t.key
                ? "bg-white text-warm-800 shadow-sm"
                : "text-warm-500 hover:text-warm-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Schedule tab */}
      {tab === "schedule" && (
        <div className="space-y-6">
          <WeekCalendar
            appointments={appointments}
            groupSessions={groupSessions}
            onWeekChange={handleWeekChange}
          />

          <div>
            <h3 className="text-sm font-semibold text-warm-600 uppercase tracking-wide mb-3">
              Upcoming Appointments
            </h3>
            {appointments.length === 0 ? (
              <p className="text-sm text-warm-400 py-4">
                No appointments this week.
              </p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {appointments
                  .filter((a) => a.status === "scheduled")
                  .sort(
                    (a, b) =>
                      new Date(a.scheduled_at).getTime() -
                      new Date(b.scheduled_at).getTime(),
                  )
                  .map((a) => (
                    <AppointmentCard
                      key={a.id}
                      appointment={a}
                      onCancel={handleCancel}
                    />
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Book appointment tab */}
      {tab === "book" && (
        <div className="max-w-2xl">
          <div className="bg-white rounded-2xl border border-warm-200 shadow-sm p-6">
            <h2 className="text-xl font-semibold text-warm-800 mb-6">
              Book an Appointment
            </h2>
            <BookingFlow
              clinicianId={user?.uid || ""}
              clinicianEmail={user?.email || ""}
              getSlots={api.getSlots}
              onBook={async (data) => {
                await api.bookAppointment(data);
                await loadSchedule();
              }}
            />
          </div>
        </div>
      )}

      {/* Availability tab */}
      {tab === "availability" && (
        <div>
          <h2 className="text-xl font-semibold text-warm-800 mb-4">
            Your Availability
          </h2>
          <AvailabilityEditor
            initialWindows={availabilityWindows}
            onSave={async (windows) => {
              await api.setAvailability(windows);
              setAvailabilityWindows(windows);
            }}
          />
        </div>
      )}
    </div>
  );
}
