import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { logOut } from "../lib/firebase";
import { AssistantPanel } from "./AssistantPanel";
import { SessionTimeoutWarning } from "./SessionTimeoutWarning";

const NAV_ITEMS = [
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
        <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
  {
    to: "/clients",
    label: "Clients",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: "/schedule",
    label: "Schedule",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
        <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
        <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: "/billing",
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
  {
    to: "/settings/practice",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
];

export function ClinicianShell() {
  const { user, practiceType, isOwner } = useAuth();
  const navigate = useNavigate();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const canSeeAdmin = practiceType === "solo" || isOwner;

  async function handleSignOut() {
    await logOut();
    navigate("/");
  }

  const displayName = user?.displayName || user?.email || "Clinician";

  return (
    <div className="min-h-screen bg-warm-50 flex flex-col md:flex-row">
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="hidden md:flex w-64 bg-white border-r border-warm-100 flex-col shrink-0">
        <div className="px-6 py-5 border-b border-warm-100">
          <p className="font-display text-lg font-semibold text-warm-800">
            Trellis
          </p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.filter((item) => item.to !== "/billing" || canSeeAdmin).map((item) => (
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
          {practiceType === "group" && isOwner && (
            <NavLink
              to="/settings/team"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-teal-50 text-teal-700"
                    : "text-warm-500 hover:text-warm-700 hover:bg-warm-50"
                }`
              }
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Team
            </NavLink>
          )}
          {canSeeAdmin && (
            <NavLink
              to="/settings/billing-service"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-teal-50 text-teal-700"
                    : "text-warm-500 hover:text-warm-700 hover:bg-warm-50"
                }`
              }
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                <path d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Billing Service
            </NavLink>
          )}
          {canSeeAdmin && (
            <NavLink
              to="/settings/credentialing"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-teal-50 text-teal-700"
                    : "text-warm-500 hover:text-warm-700 hover:bg-warm-50"
                }`
              }
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Credentialing
            </NavLink>
          )}
        </nav>

        {/* AI Assistant button */}
        <div className="px-3 pb-2">
          <button
            onClick={() => setAssistantOpen(true)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full ${
              assistantOpen
                ? "bg-teal-50 text-teal-700"
                : "text-warm-500 hover:text-warm-700 hover:bg-warm-50"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <path
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            AI Assistant
          </button>
        </div>

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
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 text-warm-500 hover:text-warm-700 transition-colors"
            aria-label="Menu"
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              {mobileMenuOpen ? (
                <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </header>

      {/* Mobile slide-out menu overlay */}
      {mobileMenuOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/20 z-40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="md:hidden fixed top-0 right-0 bottom-0 w-64 bg-white z-50 shadow-xl flex flex-col">
            <div className="px-4 py-3 border-b border-warm-100 flex items-center justify-between">
              <p className="font-display text-lg font-semibold text-warm-800">
                Menu
              </p>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-warm-400 hover:text-warm-700 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                  <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex-1 px-3 py-4 space-y-1 overflow-auto">
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  setAssistantOpen(true);
                }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full text-warm-500 hover:text-warm-700 hover:bg-warm-50"
              >
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                  <path
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                AI Assistant
              </button>
              {practiceType === "group" && isOwner && (
                <NavLink
                  to="/settings/team"
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-teal-50 text-teal-700"
                        : "text-warm-500 hover:text-warm-700 hover:bg-warm-50"
                    }`
                  }
                >
                  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Team
                </NavLink>
              )}
              {canSeeAdmin && (
                <NavLink
                  to="/settings/billing-service"
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-teal-50 text-teal-700"
                        : "text-warm-500 hover:text-warm-700 hover:bg-warm-50"
                    }`
                  }
                >
                  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                    <path d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Billing Service
                </NavLink>
              )}
            </div>
            <div className="px-4 py-4 border-t border-warm-100">
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleSignOut();
                }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-warm-500 hover:text-red-600 hover:bg-red-50 transition-colors w-full"
              >
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Sign out
              </button>
            </div>
          </div>
        </>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto pb-20 md:pb-0">
        <Outlet />
      </main>

      {/* Mobile bottom navigation — visible only on mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-warm-100 safe-area-pb z-30">
        <div className="flex items-center justify-around px-2 py-1">
          {NAV_ITEMS.filter((item) => item.to !== "/billing" || canSeeAdmin).map((item) => (
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

      {/* AI Assistant Panel */}
      {assistantOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40"
          onClick={() => setAssistantOpen(false)}
        />
      )}
      <AssistantPanel
        isOpen={assistantOpen}
        onClose={() => setAssistantOpen(false)}
      />

      {/* HIPAA: 15-minute inactivity timeout with 13-minute warning */}
      <SessionTimeoutWarning />
    </div>
  );
}
