import type { Appointment } from "../../types";

const typeBadge: Record<string, string> = {
  assessment: "bg-amber-100 text-amber-700",
  individual: "bg-teal-100 text-teal-700",
};

const statusBadge: Record<string, string> = {
  scheduled: "bg-sage-100 text-sage-700",
  completed: "bg-teal-100 text-teal-700",
  cancelled: "bg-warm-200 text-warm-500",
  no_show: "bg-red-100 text-red-700",
};

interface AppointmentCardProps {
  appointment: Appointment;
  showClient?: boolean;
  onCancel?: (id: string) => void;
}

export function AppointmentCard({
  appointment: a,
  showClient = true,
  onCancel,
}: AppointmentCardProps) {
  const dt = new Date(a.scheduled_at);
  const time = dt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const date = dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="bg-white rounded-xl border border-warm-200 p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeBadge[a.type] || ""}`}
            >
              {a.type === "assessment" ? "Assessment" : "Individual"}
            </span>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadge[a.status] || ""}`}
            >
              {a.status}
            </span>
          </div>
          <p className="text-sm font-semibold text-warm-800 truncate">
            {showClient ? a.client_name : a.clinician_email}
          </p>
          <p className="text-sm text-warm-500">
            {date} at {time} &middot; {a.duration_minutes}min
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {a.meet_link && a.status === "scheduled" && (
            <a
              href={a.meet_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M3.25 4A2.25 2.25 0 001 6.25v7.5A2.25 2.25 0 003.25 16h7.5A2.25 2.25 0 0013 13.75v-1.964l3.914 2.349A.75.75 0 0018 13.5V6.5a.75.75 0 00-1.086-.635L13 8.214V6.25A2.25 2.25 0 0010.75 4h-7.5z" />
              </svg>
              Meet
            </a>
          )}
          {a.status === "scheduled" && onCancel && (
            <button
              onClick={() => onCancel(a.id)}
              className="text-xs text-warm-400 hover:text-red-500 transition-colors p-1.5"
              title="Cancel"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path
                  fillRule="evenodd"
                  d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
