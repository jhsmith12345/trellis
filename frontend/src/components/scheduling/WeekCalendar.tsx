import { useState, useMemo } from "react";
import type { Appointment, GroupSession } from "../../types";

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7AM - 8PM
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface WeekCalendarProps {
  appointments: Appointment[];
  groupSessions: GroupSession[];
  onWeekChange?: (start: string, end: string) => void;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekEnd(start: Date): Date {
  const d = new Date(start);
  d.setDate(d.getDate() + 7);
  return d;
}

export function WeekCalendar({
  appointments,
  groupSessions,
  onWeekChange,
}: WeekCalendarProps) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  function navigate(dir: -1 | 1) {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + dir * 7);
    setWeekStart(next);
    if (onWeekChange) {
      onWeekChange(next.toISOString(), getWeekEnd(next).toISOString());
    }
  }

  // Map events to day/hour
  const eventsByDay = useMemo(() => {
    const map: Record<number, { type: "appt" | "group"; label: string; hour: number; minutes: number; duration: number; meetLink?: string | null }[]> = {};
    for (let i = 0; i < 7; i++) map[i] = [];

    for (const a of appointments) {
      const dt = new Date(a.scheduled_at);
      const dayIdx = dt.getDay();
      const dayStart = weekDays[dayIdx];
      if (dayStart && dt.toDateString() === dayStart.toDateString() && map[dayIdx]) {
        map[dayIdx].push({
          type: "appt",
          label: `${a.type === "assessment" ? "Assess" : "Indiv"}: ${a.client_name}`,
          hour: dt.getHours(),
          minutes: dt.getMinutes(),
          duration: a.duration_minutes,
          meetLink: a.meet_link,
        });
      }
    }

    for (const s of (groupSessions || [])) {
      const dt = new Date(s.scheduled_at);
      const dayIdx = dt.getDay();
      const dayStart = weekDays[dayIdx];
      if (dayStart && dt.toDateString() === dayStart.toDateString() && map[dayIdx]) {
        map[dayIdx].push({
          type: "group",
          label: s.group_title || "Group Session",
          hour: dt.getHours(),
          minutes: dt.getMinutes(),
          duration: s.duration_minutes,
          meetLink: s.meet_link,
        });
      }
    }

    return map;
  }, [appointments, groupSessions, weekDays]);

  const today = new Date();

  return (
    <div className="bg-white rounded-2xl border border-warm-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-warm-100">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-warm-100 rounded-lg transition-colors text-warm-500"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
          </svg>
        </button>
        <h3 className="text-sm font-semibold text-warm-700">
          {weekDays[0]?.toLocaleDateString("en-US", { month: "long", day: "numeric" })}
          {" — "}
          {weekDays[6]?.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </h3>
        <button
          onClick={() => navigate(1)}
          className="p-2 hover:bg-warm-100 rounded-lg transition-colors text-warm-500"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-warm-100">
        <div />
        {weekDays.map((d, i) => {
          const isToday = d.toDateString() === today.toDateString();
          return (
            <div
              key={i}
              className={`text-center py-3 text-xs font-medium border-l border-warm-100 ${
                isToday ? "bg-teal-50" : ""
              }`}
            >
              <span className="text-warm-500">{DAY_NAMES[i]}</span>
              <br />
              <span
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm ${
                  isToday
                    ? "bg-teal-600 text-white font-semibold"
                    : "text-warm-700"
                }`}
              >
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div className="max-h-[600px] overflow-y-auto">
        <div className="grid grid-cols-[60px_repeat(7,1fr)]">
          {HOURS.map((hour) => (
            <div key={hour} className="contents">
              <div className="h-16 flex items-start justify-end pr-2 pt-1 text-[11px] text-warm-400 border-t border-warm-50">
                {hour % 12 || 12}
                {hour < 12 ? "a" : "p"}
              </div>
              {weekDays.map((_, dayIdx) => {
                const events = eventsByDay[dayIdx]?.filter(
                  (e) => e.hour === hour
                );
                return (
                  <div
                    key={dayIdx}
                    className="h-16 border-l border-t border-warm-50 relative"
                  >
                    {events?.map((ev, j) => {
                      const topOffset = (ev.minutes / 60) * 64; // 64px = h-16
                      const height = (ev.duration / 60) * 64;
                      return (
                        <div
                          key={j}
                          className={`absolute left-0.5 right-0.5 rounded px-1.5 py-0.5 text-[11px] leading-tight overflow-hidden z-10 ${
                            ev.type === "appt"
                              ? "bg-teal-100 text-teal-800 border border-teal-200"
                              : "bg-sage-100 text-sage-800 border border-sage-200"
                          }`}
                          style={{
                            top: `${topOffset}px`,
                            minHeight: `${Math.max(height, 20)}px`,
                          }}
                          title={ev.label}
                        >
                          <span className="font-medium truncate block">
                            {ev.label}
                          </span>
                          {ev.meetLink && (
                            <a
                              href={ev.meetLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-teal-600 underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Meet
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
