import { useState } from "react";
import { useAuth } from "../hooks/useAuth";

export function RoleSelector() {
  const { user, registerRole } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const displayName = user?.displayName?.split(" ")[0] || "there";

  async function handleSelect(role: "clinician" | "client") {
    setLoading(true);
    setError("");
    try {
      await registerRole(role);
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-warm-50 flex items-center justify-center px-6">
      <div className="max-w-lg w-full text-center">
        <div className="w-16 h-16 mx-auto mb-6 bg-teal-50 rounded-full flex items-center justify-center">
          <span className="text-2xl font-display font-bold text-teal-600">
            {displayName.charAt(0).toUpperCase()}
          </span>
        </div>
        <h1 className="font-display text-2xl font-bold text-warm-800 mb-2">
          Welcome, {displayName}
        </h1>
        <p className="text-warm-500 mb-10">
          How will you be using Trellis?
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <button
            onClick={() => handleSelect("clinician")}
            disabled={loading}
            className="group bg-white rounded-2xl p-6 border-2 border-teal-200 hover:border-teal-400 hover:shadow-lg hover:shadow-teal-100 transition-all duration-300 text-left disabled:opacity-50"
          >
            <div className="w-12 h-12 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-teal-100 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
                <path d="M16 3l2 2-2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-warm-800 mb-1">
              I'm a Clinician
            </h3>
            <p className="text-warm-500 text-sm">
              Set up your practice and manage clients.
            </p>
          </button>

          <button
            onClick={() => handleSelect("client")}
            disabled={loading}
            className="group bg-white rounded-2xl p-6 border-2 border-sage-200 hover:border-sage-400 hover:shadow-lg hover:shadow-sage-50 transition-all duration-300 text-left disabled:opacity-50"
          >
            <div className="w-12 h-12 bg-sage-50 text-sage-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-sage-100 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-warm-800 mb-1">
              I'm a Client
            </h3>
            <p className="text-warm-500 text-sm">
              Complete your intake and begin treatment.
            </p>
          </button>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
