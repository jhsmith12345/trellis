const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  not_started: { label: "Not Started", bg: "bg-warm-100", text: "text-warm-600", dot: "bg-warm-400" },
  gathering_docs: { label: "Gathering Docs", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-400" },
  application_submitted: { label: "Submitted", bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-400" },
  pending: { label: "Pending", bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-400" },
  credentialed: { label: "Credentialed", bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-400" },
  denied: { label: "Denied", bg: "bg-red-50", text: "text-red-700", dot: "bg-red-400" },
};

export function StatusBadge({ status, size = "sm" }: { status: string; size?: "sm" | "md" }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.not_started!;
  const sizeClass = size === "md" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${config.bg} ${config.text} ${sizeClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

export const ALL_STATUSES = Object.keys(STATUS_CONFIG);
export const STATUS_LABELS = Object.fromEntries(
  Object.entries(STATUS_CONFIG).map(([k, v]) => [k, v.label])
);
