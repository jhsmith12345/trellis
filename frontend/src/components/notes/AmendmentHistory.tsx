/**
 * Amendment history display for a signed clinical note.
 *
 * Shows a chronological list of amendments with links to each.
 */
import { Link } from "react-router-dom";

interface Amendment {
  id: string;
  status: string;
  signed_at: string | null;
  signed_by: string | null;
  created_at: string;
}

interface AmendmentHistoryProps {
  amendments: Amendment[];
  originalNoteId?: string | null;
  currentNoteId: string;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  review: "bg-blue-50 text-blue-700 border-blue-200",
  signed: "bg-teal-50 text-teal-700 border-teal-200",
  amended: "bg-purple-50 text-purple-700 border-purple-200",
};

export function AmendmentHistory({
  amendments,
  originalNoteId,
  currentNoteId,
}: AmendmentHistoryProps) {
  if (!amendments.length && !originalNoteId) return null;

  return (
    <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-warm-700 mb-3 flex items-center gap-2">
        <AmendmentIcon />
        Amendment History
      </h3>

      {originalNoteId && (
        <div className="mb-3 pb-3 border-b border-warm-100">
          <p className="text-xs text-warm-500 mb-1">This is an amendment of:</p>
          <Link
            to={`/notes/${originalNoteId}`}
            className="text-sm text-teal-600 hover:text-teal-800 underline"
          >
            View Original Note
          </Link>
        </div>
      )}

      {amendments.length > 0 && (
        <div className="space-y-2">
          {amendments.map((amendment, index) => (
            <div
              key={amendment.id}
              className={`flex items-center justify-between py-2 ${
                index < amendments.length - 1 ? "border-b border-warm-50" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-xs text-warm-400 font-mono w-6">
                  #{index + 1}
                </span>
                <div>
                  {amendment.id === currentNoteId ? (
                    <span className="text-sm font-medium text-warm-700">
                      Current Amendment
                    </span>
                  ) : (
                    <Link
                      to={`/notes/${amendment.id}`}
                      className="text-sm text-teal-600 hover:text-teal-800 underline"
                    >
                      Amendment #{index + 1}
                    </Link>
                  )}
                  <p className="text-xs text-warm-400">
                    {formatDateTime(amendment.created_at)}
                  </p>
                </div>
              </div>
              <span
                className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${
                  STATUS_BADGE[amendment.status] || ""
                }`}
              >
                {amendment.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {!amendments.length && !originalNoteId && (
        <p className="text-sm text-warm-400 italic">No amendments</p>
      )}
    </div>
  );
}

function AmendmentIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-warm-400">
      <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
      <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
    </svg>
  );
}
