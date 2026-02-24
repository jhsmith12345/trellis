import { useState, useEffect, useCallback } from "react";
import type { RecurringGroup, GroupEnrollment, GroupSession } from "../../types";
import { Button } from "../Button";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface GroupManagerProps {
  getGroups: () => Promise<RecurringGroup[]>;
  createGroup: (body: {
    title: string;
    clinician_id: string;
    clinician_email: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    duration_minutes: number;
    max_capacity?: number;
  }) => Promise<{ group_id: string }>;
  enrollClient: (
    groupId: string,
    body: { client_id: string; client_email: string; client_name: string },
  ) => Promise<{ enrollment_id: string }>;
  dischargeClient: (groupId: string, clientId: string) => Promise<unknown>;
  generateSessions: (groupId: string, weeks?: number) => Promise<{
    sessions: { id: string; scheduled_at: string; meet_link: string | null }[];
  }>;
  getGroupSessions: (groupId: string) => Promise<GroupSession[]>;
  updateAttendance: (
    sessionId: string,
    updates: { client_id: string; status: string; notes?: string }[],
  ) => Promise<unknown>;
  // For fetching enrollments
  getEnrollmentsForGroup: (groupId: string) => Promise<GroupEnrollment[]>;
}

export function GroupManager({
  getGroups,
  createGroup,
  enrollClient,
  dischargeClient,
  generateSessions,
  getGroupSessions,
  updateAttendance,
  getEnrollmentsForGroup,
}: GroupManagerProps) {
  const [groups, setGroups] = useState<RecurringGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setGroups(await getGroups());
    } finally {
      setLoading(false);
    }
  }, [getGroups]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-warm-800">Groups</h3>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Cancel" : "New Group"}
        </Button>
      </div>

      {showCreate && (
        <CreateGroupForm
          onCreate={async (data) => {
            await createGroup(data);
            setShowCreate(false);
            await refresh();
          }}
        />
      )}

      {loading ? (
        <p className="text-warm-500 text-sm">Loading groups...</p>
      ) : groups.length === 0 ? (
        <p className="text-warm-500 text-sm text-center py-8">
          No groups yet. Create one to get started.
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              expanded={expandedId === g.id}
              onToggle={() => setExpandedId(expandedId === g.id ? null : g.id)}
              enrollClient={enrollClient}
              dischargeClient={dischargeClient}
              generateSessions={generateSessions}
              getGroupSessions={getGroupSessions}
              updateAttendance={updateAttendance}
              getEnrollments={() => getEnrollmentsForGroup(g.id)}
              onRefresh={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Group Form
// ---------------------------------------------------------------------------

function CreateGroupForm({
  onCreate,
}: {
  onCreate: (data: {
    title: string;
    clinician_id: string;
    clinician_email: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    duration_minutes: number;
    max_capacity: number;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [clinicianId, setClinicianId] = useState("");
  const [clinicianEmail, setClinicianEmail] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [duration, setDuration] = useState(180);
  const [capacity, setCapacity] = useState(12);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onCreate({
        title,
        clinician_id: clinicianId,
        clinician_email: clinicianEmail,
        day_of_week: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
        duration_minutes: duration,
        max_capacity: capacity,
      });
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full px-3 py-2 border border-warm-300 rounded-lg text-sm text-warm-800 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent";

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-warm-50 rounded-xl p-5 mb-6 space-y-4"
    >
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-warm-600 mb-1">Title</label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="IOP Morning Group" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-warm-600 mb-1">Day</label>
          <select className={inputClass} value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
            {DAY_NAMES.map((d, i) => (
              <option key={i} value={i}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-warm-600 mb-1">Clinician ID</label>
          <input className={inputClass} value={clinicianId} onChange={(e) => setClinicianId(e.target.value)} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-warm-600 mb-1">Clinician Email</label>
          <input className={inputClass} type="email" value={clinicianEmail} onChange={(e) => setClinicianEmail(e.target.value)} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-warm-600 mb-1">Start Time</label>
          <input className={inputClass} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-warm-600 mb-1">End Time</label>
          <input className={inputClass} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-warm-600 mb-1">Duration (min)</label>
          <input className={inputClass} type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} min={30} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-warm-600 mb-1">Max Capacity</label>
          <input className={inputClass} type="number" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} min={1} required />
        </div>
      </div>
      <Button size="sm" type="submit" disabled={saving}>
        {saving ? "Creating..." : "Create Group"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Group Card
// ---------------------------------------------------------------------------

function GroupCard({
  group,
  expanded,
  onToggle,
  enrollClient,
  dischargeClient,
  generateSessions,
  getGroupSessions,
  updateAttendance,
  getEnrollments,
  onRefresh,
}: {
  group: RecurringGroup;
  expanded: boolean;
  onToggle: () => void;
  enrollClient: GroupManagerProps["enrollClient"];
  dischargeClient: GroupManagerProps["dischargeClient"];
  generateSessions: GroupManagerProps["generateSessions"];
  getGroupSessions: GroupManagerProps["getGroupSessions"];
  updateAttendance: GroupManagerProps["updateAttendance"];
  getEnrollments: () => Promise<GroupEnrollment[]>;
  onRefresh: () => void;
}) {
  const [enrollments, setEnrollments] = useState<GroupEnrollment[]>([]);
  const [sessions, setSessions] = useState<GroupSession[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Enroll form state
  const [enrollForm, setEnrollForm] = useState({ client_id: "", client_email: "", client_name: "" });
  const [enrolling, setEnrolling] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (expanded) {
      setLoadingDetail(true);
      Promise.all([getEnrollments(), getGroupSessions(group.id)])
        .then(([e, s]) => {
          setEnrollments(e);
          setSessions(s);
        })
        .finally(() => setLoadingDetail(false));
    }
  }, [expanded, group.id, getEnrollments, getGroupSessions]);

  async function handleEnroll(e: React.FormEvent) {
    e.preventDefault();
    setEnrolling(true);
    try {
      await enrollClient(group.id, enrollForm);
      setEnrollForm({ client_id: "", client_email: "", client_name: "" });
      setEnrollments(await getEnrollments());
      onRefresh();
    } finally {
      setEnrolling(false);
    }
  }

  async function handleDischarge(clientId: string) {
    await dischargeClient(group.id, clientId);
    setEnrollments(await getEnrollments());
    onRefresh();
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateSessions(group.id, 4);
      setSessions(await getGroupSessions(group.id));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-warm-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-warm-50 transition-colors text-left"
      >
        <div>
          <h4 className="font-semibold text-warm-800">{group.title}</h4>
          <p className="text-sm text-warm-500">
            {DAY_NAMES[group.day_of_week]}s, {group.start_time} – {group.end_time}
            {" "}&middot;{" "}
            <span className="text-warm-600 font-medium">
              {group.enrolled_count}/{group.max_capacity}
            </span>{" "}
            enrolled
          </p>
        </div>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`w-5 h-5 text-warm-400 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-warm-100 p-4 space-y-5">
          {loadingDetail ? (
            <p className="text-sm text-warm-500">Loading...</p>
          ) : (
            <>
              {/* Enrolled clients */}
              <div>
                <h5 className="text-sm font-semibold text-warm-700 mb-2">
                  Enrolled Clients ({enrollments.length})
                </h5>
                {enrollments.length === 0 ? (
                  <p className="text-sm text-warm-400">No clients enrolled yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {enrollments.map((en) => (
                      <div
                        key={en.id}
                        className="flex items-center justify-between bg-warm-50 rounded-lg px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium text-warm-800">
                            {en.client_name}
                          </p>
                          <p className="text-xs text-warm-500">{en.client_email}</p>
                        </div>
                        <button
                          onClick={() => handleDischarge(en.client_id)}
                          className="text-xs text-warm-400 hover:text-red-500 transition-colors"
                        >
                          Discharge
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Enroll form */}
                <form onSubmit={handleEnroll} className="mt-3 flex flex-wrap gap-2 items-end">
                  <input
                    placeholder="Client ID"
                    value={enrollForm.client_id}
                    onChange={(e) => setEnrollForm({ ...enrollForm, client_id: e.target.value })}
                    className="flex-1 min-w-[120px] px-3 py-1.5 border border-warm-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    required
                  />
                  <input
                    placeholder="Email"
                    type="email"
                    value={enrollForm.client_email}
                    onChange={(e) => setEnrollForm({ ...enrollForm, client_email: e.target.value })}
                    className="flex-1 min-w-[140px] px-3 py-1.5 border border-warm-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    required
                  />
                  <input
                    placeholder="Name"
                    value={enrollForm.client_name}
                    onChange={(e) => setEnrollForm({ ...enrollForm, client_name: e.target.value })}
                    className="flex-1 min-w-[120px] px-3 py-1.5 border border-warm-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    required
                  />
                  <Button size="sm" type="submit" disabled={enrolling}>
                    {enrolling ? "..." : "Enroll"}
                  </Button>
                </form>
              </div>

              {/* Sessions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h5 className="text-sm font-semibold text-warm-700">
                    Sessions ({sessions.length})
                  </h5>
                  <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating}>
                    {generating ? "Generating..." : "Generate 4 Weeks"}
                  </Button>
                </div>
                {sessions.length === 0 ? (
                  <p className="text-sm text-warm-400">
                    No sessions generated yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {sessions.map((s) => (
                      <SessionRow
                        key={s.id}
                        session={s}
                        updateAttendance={updateAttendance}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session Row
// ---------------------------------------------------------------------------

const ATTENDANCE_STATUSES = ["expected", "present", "absent", "late", "excused"] as const;

const attendanceBadge: Record<string, string> = {
  expected: "bg-warm-100 text-warm-600",
  present: "bg-teal-100 text-teal-700",
  absent: "bg-red-100 text-red-700",
  late: "bg-amber-100 text-amber-700",
  excused: "bg-sage-100 text-sage-700",
};

function SessionRow({
  session,
  updateAttendance,
}: {
  session: GroupSession;
  updateAttendance: GroupManagerProps["updateAttendance"];
}) {
  const [expanded, setExpanded] = useState(false);
  const [localAttendance, setLocalAttendance] = useState(session.attendance);
  const [saving, setSaving] = useState(false);

  const dt = new Date(session.scheduled_at);

  async function handleSave() {
    setSaving(true);
    try {
      await updateAttendance(
        session.id,
        localAttendance.map((a) => ({
          client_id: a.client_id,
          status: a.status,
          notes: a.notes || undefined,
        })),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-warm-50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-warm-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-warm-800">
            {dt.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
          <span className="text-xs text-warm-500">
            {dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              session.status === "completed"
                ? "bg-teal-100 text-teal-700"
                : session.status === "cancelled"
                  ? "bg-warm-200 text-warm-500"
                  : "bg-sage-100 text-sage-700"
            }`}
          >
            {session.status}
          </span>
        </div>
        {session.meet_link && (
          <a
            href={session.meet_link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-teal-600 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Meet link
          </a>
        )}
      </button>

      {expanded && localAttendance.length > 0 && (
        <div className="px-3 pb-3">
          <div className="space-y-1.5 mt-2">
            {localAttendance.map((a, i) => (
              <div key={a.client_id} className="flex items-center gap-2">
                <span className="text-sm text-warm-700 flex-1 truncate">
                  {a.client_name || a.client_id}
                </span>
                <select
                  value={a.status}
                  onChange={(e) => {
                    const updated = [...localAttendance];
                    updated[i] = { ...a, status: e.target.value as any };
                    setLocalAttendance(updated);
                  }}
                  className={`text-xs px-2 py-1 rounded-lg border-0 font-medium ${attendanceBadge[a.status] || ""}`}
                >
                  {ATTENDANCE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Attendance"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
