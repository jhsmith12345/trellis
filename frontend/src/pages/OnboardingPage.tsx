import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { VoiceIntake } from "../components/VoiceIntake";
import { IntakeForm } from "../components/IntakeForm";
import { InsuranceCardUpload } from "../components/InsuranceCardUpload";
import { logOut } from "../lib/firebase";
import { useNavigate } from "react-router-dom";
import type { IntakeMode } from "../components/AuthProvider";

type View = "insurance" | "choice" | "voice" | "form";

export default function OnboardingPage() {
  const { user, inviteInfo, cashOnly } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<View>(cashOnly ? "choice" : "insurance");

  const intakeMode: IntakeMode = inviteInfo?.intake_mode ?? "standard";
  const isIop = intakeMode === "iop";
  const displayName = user?.displayName?.split(" ")[0] || "there";

  async function handleSignOut() {
    await logOut();
    navigate("/");
  }

  if (view === "insurance") {
    return (
      <div className="min-h-screen bg-warm-50">
        <nav className="flex items-center justify-between px-6 py-4 border-b border-warm-100">
          <p className="font-display text-lg font-semibold text-warm-800">
            Trellis
          </p>
          <span className="text-sm text-warm-400">Step 1 of 2</span>
        </nav>
        <InsuranceCardUpload
          onComplete={() => setView("choice")}
          onSkip={() => setView("choice")}
        />
      </div>
    );
  }

  if (view === "voice") {
    return (
      <div className="min-h-screen bg-warm-50">
        <nav className="flex items-center justify-between px-6 py-4 border-b border-warm-100">
          <p className="font-display text-lg font-semibold text-warm-800">
            Trellis
          </p>
          <button
            onClick={() => setView("choice")}
            className="text-sm text-warm-500 hover:text-warm-700 transition-colors"
          >
            &larr; Back
          </button>
        </nav>
        <VoiceIntake intakeMode={intakeMode} />
      </div>
    );
  }

  if (view === "form") {
    return (
      <div className="min-h-screen bg-warm-50">
        <nav className="flex items-center justify-between px-6 py-4 border-b border-warm-100">
          <p className="font-display text-lg font-semibold text-warm-800">
            Trellis
          </p>
          <button
            onClick={() => setView("choice")}
            className="text-sm text-warm-500 hover:text-warm-700 transition-colors"
          >
            &larr; Back
          </button>
        </nav>
        <IntakeForm intakeMode={intakeMode} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-warm-50 flex flex-col">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-warm-100">
        <p className="font-display text-lg font-semibold text-warm-800">
          Trellis
        </p>
        <div className="flex items-center gap-4">
          <span className="text-sm text-warm-400">Step 2 of 2</span>
          <button
            onClick={handleSignOut}
            className="text-sm text-warm-500 hover:text-warm-700 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-2xl w-full text-center">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-warm-800 mb-3">
            Welcome, {displayName}
          </h1>
          <p className="text-warm-500 text-lg mb-12 max-w-md mx-auto">
            {isIop
              ? "Let's get started with your admissions process. Choose how you'd like to begin — there's no wrong answer."
              : "Let's get to know you. Choose how you'd like to complete your intake — there's no wrong answer."}
          </p>

          <div className="grid sm:grid-cols-2 gap-6">
            {/* Voice card */}
            <button
              onClick={() => setView("voice")}
              className="group bg-white rounded-2xl p-8 border-2 border-teal-200 hover:border-teal-400 hover:shadow-lg hover:shadow-teal-100 transition-all duration-300 text-left"
            >
              <div className="w-14 h-14 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center mb-5 group-hover:bg-teal-100 transition-colors">
                <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7">
                  <path
                    d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4m-3 0h6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-warm-800 mb-2">
                Voice Conversation
              </h3>
              <p className="text-warm-500 text-sm leading-relaxed">
                Talk through your intake with our AI assistant. It's like
                chatting with a caring counselor — just use your voice.
              </p>
              <span className="inline-block mt-4 text-teal-600 font-medium text-sm group-hover:translate-x-1 transition-transform">
                Start talking &rarr;
              </span>
            </button>

            {/* Form card */}
            <button
              onClick={() => setView("form")}
              className="group bg-white rounded-2xl p-8 border-2 border-warm-200 hover:border-sage-400 hover:shadow-lg hover:shadow-sage-50 transition-all duration-300 text-left"
            >
              <div className="w-14 h-14 bg-sage-50 text-sage-600 rounded-xl flex items-center justify-center mb-5 group-hover:bg-sage-100 transition-colors">
                <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7">
                  <rect
                    x="4"
                    y="2"
                    width="16"
                    height="20"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M8 6h8M8 10h8M8 14h5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-warm-800 mb-2">
                Written Form
              </h3>
              <p className="text-warm-500 text-sm leading-relaxed">
                Prefer to type? Fill out a short intake form at your own pace.
                You can save and come back anytime.
              </p>
              <span className="inline-block mt-4 text-sage-600 font-medium text-sm group-hover:translate-x-1 transition-transform">
                Fill out form &rarr;
              </span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
