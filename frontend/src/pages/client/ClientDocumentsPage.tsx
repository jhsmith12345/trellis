import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useApi } from "../../hooks/useApi";

interface ClientProfile {
  exists: boolean;
  status?: "active" | "discharged" | "inactive";
  discharged_at?: string | null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocPackage {
  package_id: string;
  package_status: string;
  total: number;
  signed: number;
  pending: number;
  created_at: string;
}

interface DocStatus {
  total: number;
  signed: number;
  pending: number;
  packages: DocPackage[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_FALLBACK = { bg: "bg-amber-50", text: "text-amber-700", label: "Awaiting Signature" };

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  sent: { bg: "bg-amber-50", text: "text-amber-700", label: "Awaiting Signature" },
  partially_signed: { bg: "bg-amber-50", text: "text-amber-700", label: "Partially Signed" },
  completed: { bg: "bg-teal-50", text: "text-teal-700", label: "Completed" },
  created: { bg: "bg-warm-100", text: "text-warm-500", label: "Pending" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClientDocumentsPage() {
  const { user } = useAuth();
  const api = useApi();

  const [docStatus, setDocStatus] = useState<DocStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null);

  const isDischarged = clientProfile?.exists && clientProfile.status === "discharged";

  useEffect(() => {
    async function load() {
      if (!user?.uid) return;
      try {
        // Load client profile to check discharge status
        try {
          const profile = await api.get<ClientProfile>("/api/clients/me");
          setClientProfile(profile);
        } catch {
          // Profile may not exist yet
        }

        const data = await api.get<DocStatus>(`/api/documents/status/${user.uid}`);
        setDocStatus(data);
      } catch (err: any) {
        console.error("Failed to load documents:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api, user?.uid]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  const pendingPackages = (docStatus?.packages || []).filter(
    (p) => p.pending > 0
  );
  const signedPackages = (docStatus?.packages || []).filter(
    (p) => p.pending === 0 && p.signed > 0
  );

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-3xl mx-auto">
      <h1 className="font-display text-2xl md:text-3xl font-bold text-warm-800 mb-2">
        Documents
      </h1>
      <p className="text-warm-500 mb-6">
        {isDischarged
          ? "View your signed consent forms and documents."
          : "Review and sign your consent forms and view signed documents."}
      </p>

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
            <p className="text-sm text-warm-600">
              Your treatment has concluded. Documents are available in read-only mode for your records.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* Summary */}
      {docStatus && docStatus.total > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-warm-200 p-4 text-center">
            <p className="text-2xl font-bold text-warm-800">{docStatus.total}</p>
            <p className="text-xs text-warm-500 mt-0.5">Total</p>
          </div>
          <div className="bg-white rounded-xl border border-warm-200 p-4 text-center">
            <p className="text-2xl font-bold text-teal-600">{docStatus.signed}</p>
            <p className="text-xs text-warm-500 mt-0.5">Signed</p>
          </div>
          <div className="bg-white rounded-xl border border-warm-200 p-4 text-center">
            <p className={`text-2xl font-bold ${docStatus.pending > 0 ? "text-amber-600" : "text-warm-400"}`}>
              {docStatus.pending}
            </p>
            <p className="text-xs text-warm-500 mt-0.5">Pending</p>
          </div>
        </div>
      )}

      {/* Pending documents */}
      {pendingPackages.length > 0 && !isDischarged && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wide mb-3">
            Needs Your Signature
          </h2>
          <div className="space-y-3">
            {pendingPackages.map((pkg) => {
              const status = STATUS_STYLES[pkg.package_status] ?? STATUS_FALLBACK;
              return (
                <div
                  key={pkg.package_id}
                  className="bg-white rounded-xl border border-amber-200 p-4 md:p-5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.bg} ${status.text}`}
                        >
                          {status.label}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-warm-800">
                        Consent Documents
                      </p>
                      <p className="text-sm text-warm-500">
                        {pkg.signed} of {pkg.total} signed -- {pkg.pending} remaining
                      </p>
                      <p className="text-xs text-warm-400 mt-1">
                        Created {formatDate(pkg.created_at)}
                      </p>
                    </div>
                    <Link
                      to={`/sign/${pkg.package_id}`}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 transition-colors active:bg-amber-700 shrink-0"
                    >
                      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
                        <path
                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Sign Now
                    </Link>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-3">
                    <div className="h-2 bg-warm-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-500 rounded-full transition-all"
                        style={{
                          width: `${pkg.total > 0 ? (pkg.signed / pkg.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Signed documents archive */}
      <div>
        <h2 className="text-sm font-semibold text-warm-600 uppercase tracking-wide mb-3">
          Signed Documents
        </h2>
        {signedPackages.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-2xl border border-warm-200">
            <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 mx-auto text-warm-300 mb-3">
              <path
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="text-warm-400 text-sm">No signed documents yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {signedPackages.map((pkg) => (
              <div
                key={pkg.package_id}
                className="bg-white rounded-xl border border-warm-200 p-4 md:p-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700">
                        Completed
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-warm-800">
                      Consent Documents
                    </p>
                    <p className="text-sm text-warm-500">
                      {pkg.signed} of {pkg.total} signed
                    </p>
                    <p className="text-xs text-warm-400 mt-1">
                      Created {formatDate(pkg.created_at)}
                    </p>
                  </div>
                  <Link
                    to={`/sign/${pkg.package_id}`}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-warm-300 text-warm-600 text-sm font-medium rounded-lg hover:bg-warm-50 transition-colors shrink-0"
                  >
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
                      <path
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                    View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Empty state when no docs at all */}
      {(!docStatus || docStatus.total === 0) && !error && (
        <div className="text-center py-12 bg-white rounded-2xl border border-warm-200">
          <svg viewBox="0 0 24 24" fill="none" className="w-12 h-12 mx-auto text-warm-300 mb-4">
            <path
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <h3 className="text-lg font-semibold text-warm-700 mb-1">No Documents Yet</h3>
          <p className="text-warm-400 text-sm max-w-xs mx-auto">
            Your consent documents will appear here once your clinician prepares them.
          </p>
        </div>
      )}
    </div>
  );
}
