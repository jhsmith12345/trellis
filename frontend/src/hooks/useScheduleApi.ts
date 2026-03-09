import { useCallback } from "react";
import { useAuth } from "./useAuth";
import { API_BASE } from "../lib/api-config";
import type {
  AvailabilityWindow,
  TimeSlot,
  Appointment,
  RecurringGroup,
  GroupEnrollment,
  GroupSession,
} from "../types";

async function api<T>(
  path: string,
  token: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function useScheduleApi() {
  const { getIdToken } = useAuth();

  const getAvailability = useCallback(async () => {
    const token = await getIdToken();
    const data = await api<{ windows: AvailabilityWindow[] }>(
      "/api/availability",
      token,
    );
    return data.windows;
  }, [getIdToken]);

  const setAvailability = useCallback(
    async (windows: AvailabilityWindow[]) => {
      const token = await getIdToken();
      return api("/api/availability", token, {
        method: "PUT",
        body: JSON.stringify({ windows }),
      });
    },
    [getIdToken],
  );

  const getSlots = useCallback(
    async (
      clinicianId: string,
      start: string,
      end: string,
      type = "assessment",
    ) => {
      const token = await getIdToken();
      const params = new URLSearchParams({
        clinician_id: clinicianId,
        start,
        end,
        type,
      });
      const data = await api<{ slots: TimeSlot[] }>(
        `/api/appointments/slots?${params}`,
        token,
      );
      return data.slots;
    },
    [getIdToken],
  );

  const bookAppointment = useCallback(
    async (body: {
      client_id: string;
      client_email: string;
      client_name: string;
      clinician_id: string;
      clinician_email: string;
      type: string;
      scheduled_at: string;
      duration_minutes?: number;
      modality?: string;
    }) => {
      const token = await getIdToken();
      return api<{
        appointments: { id: string; scheduled_at: string; meet_link: string | null }[];
        recurrence_id: string | null;
      }>("/api/appointments", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    [getIdToken],
  );

  const getAppointments = useCallback(
    async (start: string, end: string, clientId?: string, clinicianId?: string) => {
      const token = await getIdToken();
      const params = new URLSearchParams({ start, end });
      if (clientId) params.set("client_id", clientId);
      if (clinicianId) params.set("clinician_id", clinicianId);
      const data = await api<{ appointments: Appointment[] }>(
        `/api/appointments?${params}`,
        token,
      );
      return data.appointments;
    },
    [getIdToken],
  );

  const updateAppointment = useCallback(
    async (id: string, status: string, cancelledReason?: string) => {
      const token = await getIdToken();
      return api(`/api/appointments/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ status, cancelled_reason: cancelledReason }),
      });
    },
    [getIdToken],
  );

  const endSeries = useCallback(
    async (recurrenceId: string) => {
      const token = await getIdToken();
      return api<{ cancelled_count: number }>(
        `/api/appointments/series/${recurrenceId}/end`,
        token,
        { method: "POST" },
      );
    },
    [getIdToken],
  );

  const createGroup = useCallback(
    async (body: {
      title: string;
      clinician_id: string;
      clinician_email: string;
      day_of_week: number;
      start_time: string;
      end_time: string;
      duration_minutes: number;
      max_capacity?: number;
    }) => {
      const token = await getIdToken();
      return api<{ group_id: string }>("/api/groups", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    [getIdToken],
  );

  const getGroups = useCallback(async () => {
    const token = await getIdToken();
    const data = await api<{ groups: RecurringGroup[] }>("/api/groups", token);
    return data.groups;
  }, [getIdToken]);

  const getGroupEnrollments = useCallback(
    async (groupId: string) => {
      const token = await getIdToken();
      const data = await api<{ enrollments: GroupEnrollment[] }>(
        `/api/groups/${groupId}/enrollments`,
        token,
      );
      return data.enrollments;
    },
    [getIdToken],
  );

  const enrollClient = useCallback(
    async (
      groupId: string,
      body: { client_id: string; client_email: string; client_name: string },
    ) => {
      const token = await getIdToken();
      return api<{ enrollment_id: string }>(
        `/api/groups/${groupId}/enroll`,
        token,
        { method: "POST", body: JSON.stringify(body) },
      );
    },
    [getIdToken],
  );

  const dischargeClient = useCallback(
    async (groupId: string, clientId: string) => {
      const token = await getIdToken();
      return api(
        `/api/groups/${groupId}/discharge/${clientId}`,
        token,
        { method: "POST" },
      );
    },
    [getIdToken],
  );

  const generateSessions = useCallback(
    async (groupId: string, weeks = 4) => {
      const token = await getIdToken();
      return api<{
        sessions: { id: string; scheduled_at: string; meet_link: string | null }[];
      }>(`/api/groups/${groupId}/sessions/generate`, token, {
        method: "POST",
        body: JSON.stringify({ weeks }),
      });
    },
    [getIdToken],
  );

  const getGroupSessions = useCallback(
    async (groupId: string, start?: string, end?: string) => {
      const token = await getIdToken();
      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      const qs = params.toString();
      const data = await api<{ sessions: GroupSession[] }>(
        `/api/groups/${groupId}/sessions${qs ? `?${qs}` : ""}`,
        token,
      );
      return data.sessions;
    },
    [getIdToken],
  );

  const updateAttendance = useCallback(
    async (
      sessionId: string,
      updates: { client_id: string; status: string; notes?: string }[],
    ) => {
      const token = await getIdToken();
      return api(
        `/api/groups/sessions/${sessionId}/attendance`,
        token,
        { method: "PATCH", body: JSON.stringify({ updates }) },
      );
    },
    [getIdToken],
  );

  const getSchedule = useCallback(
    async (start: string, end: string) => {
      const token = await getIdToken();
      const params = new URLSearchParams({ start, end });
      const data = await api<{
        appointments: Appointment[];
        group_sessions?: GroupSession[];
      }>(`/api/schedule?${params}`, token);
      // Backend currently returns only { appointments }; default group_sessions
      return {
        appointments: data.appointments,
        group_sessions: data.group_sessions ?? [],
      };
    },
    [getIdToken],
  );

  return {
    getAvailability,
    setAvailability,
    getSlots,
    bookAppointment,
    getAppointments,
    updateAppointment,
    endSeries,
    createGroup,
    getGroups,
    getGroupEnrollments,
    enrollClient,
    dischargeClient,
    generateSessions,
    getGroupSessions,
    updateAttendance,
    getSchedule,
  };
}
