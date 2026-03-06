import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { AuthModal } from "../components/AuthModal";

const steps = [
  {
    num: "01",
    title: "Create Your Account",
    desc: "Sign up in seconds with Google or email. Your information stays private and secure.",
  },
  {
    num: "02",
    title: "Complete Your Intake",
    desc: "Tell us about yourself through a guided voice conversation or a simple form — whichever feels right.",
  },
  {
    num: "03",
    title: "Begin Your Journey",
    desc: "Your therapist receives your information instantly, so treatment can start from day one.",
  },
];

const features = [
  {
    title: "Voice-First Intake",
    desc: "A guided AI conversation replaces paperwork. Just talk — we'll handle the rest.",
    icon: (
      <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8">
        <path d="M16 4a5 5 0 0 0-5 5v7a5 5 0 0 0 10 0V9a5 5 0 0 0-5-5z" stroke="currentColor" strokeWidth="2" />
        <path d="M24 14v2a8 8 0 0 1-16 0v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M16 24v4m-4 0h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "Automated Scheduling",
    desc: "Book appointments through voice or self-service. Calendar sync, Meet links, and reminders built in.",
    icon: (
      <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8">
        <rect x="4" y="6" width="24" height="22" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M4 13h24M10 3v6M22 3v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="16" cy="20" r="2" fill="currentColor" />
      </svg>
    ),
  },
  {
    title: "Notes & Billing",
    desc: "AI-generated session notes, treatment plans, and superbills — review, sign, and send in minutes.",
    icon: (
      <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8">
        <rect x="6" y="4" width="20" height="24" rx="2" stroke="currentColor" strokeWidth="2" />
        <path d="M11 10h10M11 15h10M11 20h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function LandingPage() {
  const { user, practiceInitialized, inviteInfo } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"client" | "clinician">("client");
  const [prefillEmail, setPrefillEmail] = useState("");

  function openAuth(mode: "client" | "clinician", email?: string) {
    if (user) {
      // Role-aware routing in App.tsx handles redirect via RoleRedirect
      return;
    }
    setAuthMode(mode);
    setPrefillEmail(email || "");
    setAuthOpen(true);
  }

  // Determine which hero variant to show
  const isNotInitialized = practiceInitialized === false;
  const isInvite = practiceInitialized === true && inviteInfo !== null;

  return (
    <div className="min-h-screen overflow-hidden">
      {/* ── Hero ───────────────────────────────────────── */}
      <section className="relative min-h-[92vh] flex items-center">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-900 via-teal-800 to-sage-800" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-teal-400/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-warm-50 to-transparent" />

        <div className="relative z-10 max-w-5xl mx-auto px-6 py-20 text-center">
          {isNotInitialized ? (
            /* ── Not initialized: Setup hero ── */
            <>
              <p className="text-teal-300 font-medium tracking-widest uppercase text-sm mb-6">
                AI-Native Behavioral Health
              </p>
              <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-bold text-white leading-[1.1] mb-6">
                Welcome to
                <br />
                <span className="text-teal-300">Trellis.</span>
              </h1>
              <p className="text-lg sm:text-xl text-teal-100/80 max-w-2xl mx-auto mb-10 leading-relaxed">
                Set up your practice in minutes. Trellis automates intake,
                scheduling, notes, and billing — so you can focus on what you do
                best.
              </p>
              <button
                onClick={() => openAuth("clinician")}
                className="group relative px-8 py-4 bg-amber-400 text-warm-900 font-semibold text-lg rounded-xl hover:bg-amber-300 transition-all duration-200 hover:shadow-lg hover:shadow-amber-400/25 hover:-translate-y-0.5"
              >
                Set Up Your Practice
                <span className="inline-block ml-2 transition-transform group-hover:translate-x-1">
                  &rarr;
                </span>
              </button>
            </>
          ) : isInvite ? (
            /* ── Initialized with invite: Personalized hero ── */
            <>
              <p className="text-teal-300 font-medium tracking-widest uppercase text-sm mb-6">
                You've Been Invited
              </p>
              <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-bold text-white leading-[1.1] mb-6">
                {inviteInfo.clinician_name || "Your provider"}
                <br />
                <span className="text-teal-300">
                  has invited you to {inviteInfo.practice_name}.
                </span>
              </h1>
              <p className="text-lg sm:text-xl text-teal-100/80 max-w-2xl mx-auto mb-10 leading-relaxed">
                Create your account to get started with your care. It only takes
                a moment.
              </p>
              <button
                onClick={() => openAuth("client", inviteInfo.email)}
                className="group relative px-8 py-4 bg-amber-400 text-warm-900 font-semibold text-lg rounded-xl hover:bg-amber-300 transition-all duration-200 hover:shadow-lg hover:shadow-amber-400/25 hover:-translate-y-0.5"
              >
                Client Portal
                <span className="inline-block ml-2 transition-transform group-hover:translate-x-1">
                  &rarr;
                </span>
              </button>
            </>
          ) : (
            /* ── Initialized, no invite: Default client-facing hero ── */
            <>
              <p className="text-teal-300 font-medium tracking-widest uppercase text-sm mb-6">
                AI-Native Behavioral Health
              </p>
              <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-bold text-white leading-[1.1] mb-6">
                Your Practice,
                <br />
                <span className="text-teal-300">On Autopilot.</span>
              </h1>
              <p className="text-lg sm:text-xl text-teal-100/80 max-w-2xl mx-auto mb-10 leading-relaxed">
                Trellis automates intake, scheduling, notes, and billing for solo
                therapists — so you can focus on what you do best.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={() => openAuth("client")}
                  className="group relative px-8 py-4 bg-amber-400 text-warm-900 font-semibold text-lg rounded-xl hover:bg-amber-300 transition-all duration-200 hover:shadow-lg hover:shadow-amber-400/25 hover:-translate-y-0.5"
                >
                  Client Portal
                  <span className="inline-block ml-2 transition-transform group-hover:translate-x-1">
                    &rarr;
                  </span>
                </button>
                <button
                  onClick={() => openAuth("clinician")}
                  className="px-8 py-4 text-teal-200 font-medium text-lg rounded-xl border border-teal-400/30 hover:bg-teal-800/50 hover:border-teal-400/50 transition-all duration-200"
                >
                  Clinician Sign In
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── How It Works (hidden when not initialized) ───────────────────────────────── */}
      {!isNotInitialized && (
        <section className="py-24 px-6 bg-warm-50">
          <div className="max-w-5xl mx-auto">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-warm-800 text-center mb-4">
              How It Works
            </h2>
            <p className="text-warm-500 text-center max-w-xl mx-auto mb-16">
              Getting started is simple. We've removed the barriers so you can
              focus on what matters — your care.
            </p>
            <div className="grid md:grid-cols-3 gap-8">
              {steps.map((s) => (
                <div
                  key={s.num}
                  className="group relative bg-white rounded-2xl p-8 shadow-sm border border-warm-100 hover:shadow-md hover:border-teal-200 transition-all duration-300"
                >
                  <span className="block font-display text-5xl font-bold text-teal-200 group-hover:text-teal-400 transition-colors mb-4">
                    {s.num}
                  </span>
                  <h3 className="text-xl font-semibold text-warm-800 mb-2">
                    {s.title}
                  </h3>
                  <p className="text-warm-500 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Features (hidden when not initialized) ───────────────────────────────── */}
      {!isNotInitialized && (
        <section className="py-24 px-6 bg-sage-50">
          <div className="max-w-5xl mx-auto">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-warm-800 text-center mb-4">
              Everything You Need
            </h2>
            <p className="text-warm-500 text-center max-w-xl mx-auto mb-16">
              One platform that handles the entire workflow — from the first
              conversation to the final superbill.
            </p>
            <div className="grid md:grid-cols-3 gap-8">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="bg-white rounded-2xl p-8 shadow-sm border border-sage-100 hover:shadow-md transition-shadow duration-300"
                >
                  <div className="w-14 h-14 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center mb-5">
                    {f.icon}
                  </div>
                  <h3 className="text-xl font-semibold text-warm-800 mb-2">
                    {f.title}
                  </h3>
                  <p className="text-warm-500 leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Footer CTA ─────────────────────────────────── */}
      {!isNotInitialized && (
        <section className="relative py-24 px-6 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-teal-800 via-teal-700 to-sage-700" />
          <div className="absolute inset-0 opacity-5" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='1' fill-rule='evenodd'%3E%3Cpath d='M0 40L40 0H20L0 20M40 40V20L20 40'/%3E%3C/g%3E%3C/svg%3E")`
          }} />
          <div className="relative z-10 max-w-3xl mx-auto text-center">
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-4">
              Ready to Simplify
              <br />
              Your Practice?
            </h2>
            <p className="text-teal-100/80 text-lg mb-10 max-w-xl mx-auto">
              Join Trellis and let AI handle the busywork. Your clients — and
              your calendar — will thank you.
            </p>
            <button
              onClick={() => openAuth("client")}
              className="group px-10 py-4 bg-amber-400 text-warm-900 font-semibold text-lg rounded-xl hover:bg-amber-300 transition-all duration-200 hover:shadow-lg hover:shadow-amber-400/20 hover:-translate-y-0.5"
            >
              Client Portal
              <span className="inline-block ml-2 transition-transform group-hover:translate-x-1">
                &rarr;
              </span>
            </button>
          </div>
        </section>
      )}

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="bg-warm-800 text-warm-400 py-10 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
          <p className="font-display text-lg text-white font-semibold">
            Trellis
          </p>
          <div className="flex items-center gap-6">
            <Link
              to="/setup-wizard"
              className="text-warm-400 hover:text-teal-300 transition-colors"
            >
              Setting up Trellis? Use our setup wizard
            </Link>
            <p>&copy; {new Date().getFullYear()} Trellis. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* ── Auth Modal ─────────────────────────────────── */}
      {authOpen && (
        <AuthModal
          mode={authMode}
          onClose={() => setAuthOpen(false)}
          prefillEmail={prefillEmail}
        />
      )}
    </div>
  );
}
