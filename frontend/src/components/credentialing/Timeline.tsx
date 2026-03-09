import type { TimelineEvent } from "../../pages/CredentialingPage";

const EVENT_ICONS: Record<string, { bg: string; icon: string }> = {
  status_change: { bg: "bg-blue-100", icon: "text-blue-600" },
  approval_received: { bg: "bg-emerald-100", icon: "text-emerald-600" },
  denial_received: { bg: "bg-red-100", icon: "text-red-600" },
  application_sent: { bg: "bg-blue-100", icon: "text-blue-600" },
  note: { bg: "bg-warm-100", icon: "text-warm-500" },
  follow_up_call: { bg: "bg-purple-100", icon: "text-purple-600" },
  follow_up_email: { bg: "bg-purple-100", icon: "text-purple-600" },
  document_uploaded: { bg: "bg-teal-100", icon: "text-teal-600" },
  document_requested: { bg: "bg-amber-100", icon: "text-amber-600" },
  recredential_started: { bg: "bg-orange-100", icon: "text-orange-600" },
  other: { bg: "bg-warm-100", icon: "text-warm-500" },
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-warm-400 text-center py-4">No activity yet.</p>;
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-warm-100" />

      <div className="space-y-4">
        {events.map((event) => {
          const style = EVENT_ICONS[event.event_type] ?? EVENT_ICONS.other!;
          return (
            <div key={event.id} className="relative flex gap-3 pl-0">
              {/* Dot */}
              <div className={`w-[23px] h-[23px] rounded-full ${style.bg} flex items-center justify-center shrink-0 z-10`}>
                <div className={`w-2 h-2 rounded-full ${style.icon.replace("text-", "bg-")}`} />
              </div>
              {/* Content */}
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-xs text-warm-700 leading-relaxed">{event.description}</p>
                <p className="text-[10px] text-warm-400 mt-0.5">
                  {formatRelativeTime(event.created_at)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
