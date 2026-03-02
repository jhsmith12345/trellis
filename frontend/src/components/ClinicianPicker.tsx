import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { API_BASE } from "../lib/api-config";
import { LoadingSpinner } from "./LoadingSpinner";

interface ClinicianOption {
  id: string;
  firebase_uid: string;
  clinician_name: string | null;
  credentials: string | null;
  specialties: string[] | null;
  bio: string | null;
}

export function ClinicianPicker() {
  const { completeRegistration } = useAuth();
  const [clinicians, setClinicians] = useState<ClinicianOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/practice/clinicians`);
        if (res.ok) {
          const data = await res.json();
          setClinicians(data.clinicians || []);
        }
      } catch {
        setError("Unable to load providers");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSelect(c: ClinicianOption) {
    setSelecting(c.id);
    setError("");
    try {
      await completeRegistration(c.firebase_uid);
    } catch (e: any) {
      setError(e.message || "Registration failed");
      setSelecting(null);
    }
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-warm-50 flex items-center justify-center px-6 py-12">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-10">
          <div className="w-14 h-14 mx-auto mb-4 bg-teal-50 rounded-full flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-teal-600">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="font-display text-2xl font-bold text-warm-800 mb-2">
            Choose Your Provider
          </h1>
          <p className="text-warm-500">
            Select the clinician you'd like to work with.
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-6 text-center">
            {error}
          </p>
        )}

        {clinicians.length === 0 ? (
          <p className="text-center text-warm-400">No providers available at this time.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {clinicians.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSelect(c)}
                disabled={selecting !== null}
                className={`bg-white rounded-2xl p-6 border-2 text-left transition-all duration-200 ${
                  selecting === c.id
                    ? "border-teal-400 shadow-lg shadow-teal-100"
                    : "border-warm-100 hover:border-teal-300 hover:shadow-md"
                } disabled:opacity-60`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-teal-50 rounded-full flex items-center justify-center shrink-0">
                    <span className="text-lg font-display font-bold text-teal-600">
                      {(c.clinician_name || "?").charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-warm-800">
                      {c.clinician_name || "Provider"}
                      {c.credentials && (
                        <span className="text-warm-400 font-normal text-sm ml-1">
                          , {c.credentials}
                        </span>
                      )}
                    </h3>
                    {c.specialties && c.specialties.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {c.specialties.slice(0, 3).map((s) => (
                          <span
                            key={s}
                            className="inline-flex px-2 py-0.5 bg-teal-50 text-teal-700 rounded-full text-xs font-medium"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                    {c.bio && (
                      <p className="text-sm text-warm-500 mt-2 line-clamp-2">
                        {c.bio}
                      </p>
                    )}
                  </div>
                </div>
                {selecting === c.id && (
                  <div className="flex items-center justify-center mt-4">
                    <div className="w-5 h-5 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
