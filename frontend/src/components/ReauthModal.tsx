/**
 * Re-authentication Modal
 *
 * Prompts the user to verify their identity before performing a sensitive
 * action on PHI. Supports both Google and email/password re-authentication
 * based on the user's original sign-in method.
 *
 * HIPAA Technical Safeguard: Access Control — requires identity verification
 * for actions that modify, sign, or delete protected health information.
 */
import { useState } from "react";
import { useReauthContext } from "./ReauthProvider";
import { auth } from "../lib/firebase";

export function ReauthModal() {
  const {
    showModal,
    error,
    loading,
    reauthWithGoogle,
    reauthWithPassword,
    cancel,
  } = useReauthContext();

  const [password, setPassword] = useState("");

  if (!showModal) return null;

  // Determine auth method from current user's provider data
  const user = auth.currentUser;
  const providers = user?.providerData.map((p) => p.providerId) || [];
  const hasGoogle = providers.includes("google.com");
  const hasPassword = providers.includes("password");

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.trim()) {
      reauthWithPassword(password);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center shrink-0">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="w-5 h-5 text-teal-600"
            >
              <rect
                x="5"
                y="11"
                width="14"
                height="10"
                rx="2"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M12 15v2m-4-6V8a4 4 0 118 0v3"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-warm-800">
              Verify Your Identity
            </h2>
            <p className="text-warm-500 text-xs">
              Required for this sensitive action
            </p>
          </div>
        </div>

        <p className="text-warm-600 text-sm mb-5">
          To protect patient information, please confirm your identity before
          continuing.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        <div className="space-y-3">
          {hasGoogle && (
            <button
              onClick={reauthWithGoogle}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 text-sm font-medium rounded-xl border border-warm-200 text-warm-700 hover:bg-warm-50 transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              {loading ? "Verifying..." : "Continue with Google"}
            </button>
          )}

          {hasPassword && (
            <form onSubmit={handlePasswordSubmit}>
              <div className="mb-3">
                <label className="block text-xs font-medium text-warm-500 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoFocus
                  className="w-full rounded-xl border border-warm-200 px-4 py-2.5 text-sm text-warm-700 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !password.trim()}
                className="w-full px-4 py-2.5 text-sm font-medium rounded-xl bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Verify Password"}
              </button>
            </form>
          )}

          {!hasGoogle && !hasPassword && (
            <p className="text-warm-500 text-sm text-center">
              Unable to determine sign-in method. Please sign out and sign in
              again.
            </p>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-warm-100">
          <button
            onClick={cancel}
            disabled={loading}
            className="w-full px-4 py-2 text-sm text-warm-500 hover:text-warm-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
