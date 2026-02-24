/**
 * HIPAA Session Timeout Warning Modal
 *
 * Displayed when the user has been inactive for 13 minutes. Shows a countdown
 * to auto-logout at 15 minutes. User can click "Stay Signed In" to reset the
 * timer or "Sign Out Now" to immediately log out.
 */
import { useSessionTimeout } from "../hooks/useSessionTimeout";

export function SessionTimeoutWarning() {
  const { showWarning, dismissWarning, remainingSeconds, logoutNow } =
    useSessionTimeout();

  if (!showWarning) return null;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeDisplay =
    minutes > 0
      ? `${minutes}:${seconds.toString().padStart(2, "0")}`
      : `${seconds}s`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="w-5 h-5 text-amber-600"
            >
              <path
                d="M12 9v4m0 4h.01M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-warm-800">
            Session Timeout Warning
          </h2>
        </div>

        <p className="text-warm-600 text-sm mb-2">
          Your session will expire due to inactivity. For the security of
          protected health information, you will be signed out automatically.
        </p>

        <p className="text-center text-2xl font-mono font-bold text-amber-600 my-4">
          {timeDisplay}
        </p>

        <p className="text-warm-500 text-xs text-center mb-6">
          Click "Stay Signed In" to continue your session.
        </p>

        <div className="flex gap-3">
          <button
            onClick={logoutNow}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl border border-warm-200 text-warm-600 hover:bg-warm-50 transition-colors"
          >
            Sign Out Now
          </button>
          <button
            onClick={dismissWarning}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl bg-teal-600 text-white hover:bg-teal-700 transition-colors"
          >
            Stay Signed In
          </button>
        </div>
      </div>
    </div>
  );
}
