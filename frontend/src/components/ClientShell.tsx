import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { logOut } from "../lib/firebase";
import { SessionTimeoutWarning } from "./SessionTimeoutWarning";

const NAV_ITEMS = [
  {
    to: "/client/dashboard",
    label: "Home",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
        <path
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    to: "/client/appointments",
    label: "Appointments",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
        <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
        <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: "/client/documents",
    label: "Documents",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
        <path
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    to: "/client/billing",
    label: "Billing",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
        <path
          d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

export function ClientShell() {
  const { user } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await logOut();
    navigate("/");
  }

  const displayName = user?.displayName || user?.email || "Client";

  return (
    <div className="min-h-screen bg-warm-50 flex flex-col md:flex-row">
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="hidden md:flex w-64 bg-white border-r border-warm-100 flex-col shrink-0">
        <div className="px-6 py-5 border-b border-warm-100">
          <p className="font-display text-lg font-semibold text-warm-800">
            Trellis
          </p>
          <p className="text-xs text-warm-400 mt-0.5">Client Portal</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-teal-50 text-teal-700"
                    : "text-warm-500 hover:text-warm-700 hover:bg-warm-50"
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-warm-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-teal-50 rounded-full flex items-center justify-center shrink-0">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full" />
              ) : (
                <span className="text-sm font-semibold text-teal-600">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-warm-700 truncate">
                {displayName.split(" ")[0]}
              </p>
              <button
                onClick={handleSignOut}
                className="text-xs text-warm-400 hover:text-warm-600 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile top bar — visible only on mobile */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-warm-100">
        <p className="font-display text-lg font-semibold text-warm-800">
          Trellis
        </p>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-teal-50 rounded-full flex items-center justify-center">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full" />
            ) : (
              <span className="text-xs font-semibold text-teal-600">
                {displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <button
            onClick={handleSignOut}
            className="text-xs text-warm-400 hover:text-warm-600 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto pb-20 md:pb-0">
        <Outlet />
      </main>

      {/* Mobile bottom navigation — visible only on mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-warm-100 safe-area-pb z-30">
        <div className="flex items-center justify-around px-2 py-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-colors min-w-[60px] ${
                  isActive
                    ? "text-teal-700"
                    : "text-warm-400"
                }`
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* HIPAA: 15-minute inactivity timeout with 13-minute warning */}
      <SessionTimeoutWarning />
    </div>
  );
}
