import { useEffect, useRef } from "react";
import { useVoiceSession, type VoiceStatus } from "../hooks/useVoiceSession";
import { Button } from "./Button";

function StatusBadge({ status }: { status: VoiceStatus }) {
  const config: Record<VoiceStatus, { label: string; color: string }> = {
    idle: { label: "Ready", color: "bg-warm-200 text-warm-600" },
    connecting: { label: "Connecting...", color: "bg-amber-100 text-amber-700" },
    ready: { label: "Starting...", color: "bg-amber-100 text-amber-700" },
    active: { label: "Listening", color: "bg-teal-100 text-teal-700" },
    ended: { label: "Complete", color: "bg-sage-100 text-sage-700" },
    error: { label: "Error", color: "bg-red-100 text-red-700" },
  };
  const { label, color } = config[status];
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${color}`}>
      {status === "active" && (
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-teal-500" />
        </span>
      )}
      {label}
    </span>
  );
}

export function VoiceIntake() {
  const { status, transcript, error, startSession, endSession } =
    useVoiceSession();
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="text-center mb-10">
        <h2 className="font-display text-2xl font-bold text-warm-800 mb-2">
          Voice Intake
        </h2>
        <p className="text-warm-500">
          Our AI assistant will guide you through a brief conversation to
          understand your needs.
        </p>
      </div>

      <div className="flex justify-center mb-8">
        <StatusBadge status={status} />
      </div>

      {status === "idle" && (
        <div className="text-center">
          <div className="w-24 h-24 mx-auto mb-6 bg-teal-50 rounded-full flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-teal-600">
              <path
                d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4m-3 0h6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <p className="text-warm-500 mb-6 max-w-sm mx-auto">
            When you're ready, click below. We'll ask permission to use your
            microphone, then the conversation will begin.
          </p>
          <Button onClick={startSession} size="lg">
            Start Conversation
          </Button>
        </div>
      )}

      {(status === "active" || status === "connecting" || status === "ready") && (
        <div>
          {/* Mic animation */}
          <div className="flex justify-center mb-8">
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 bg-teal-200 rounded-full animate-pulse opacity-50" />
              <div className="absolute inset-2 bg-teal-100 rounded-full animate-pulse opacity-75" style={{ animationDelay: "150ms" }} />
              <div className="absolute inset-4 bg-white rounded-full flex items-center justify-center shadow-sm">
                <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-teal-600">
                  <path
                    d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"
                    fill="currentColor"
                  />
                  <path
                    d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4m-3 0h6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Live transcript */}
          {transcript.length > 0 && (
            <div className="bg-white rounded-2xl border border-warm-100 p-6 mb-6 max-h-64 overflow-y-auto">
              <p className="text-xs uppercase tracking-wider text-warm-400 mb-3 font-medium">
                Transcript
              </p>
              <div className="space-y-1 text-warm-600 leading-relaxed">
                {transcript.map((line, i) => (
                  <span key={i}>{line} </span>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            </div>
          )}

          <div className="text-center">
            <Button onClick={endSession} variant="outline">
              End Conversation
            </Button>
          </div>
        </div>
      )}

      {status === "ended" && (
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6 bg-sage-50 rounded-full flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-sage-600">
              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h3 className="font-display text-xl font-bold text-warm-800 mb-2">
            Intake Complete
          </h3>
          <p className="text-warm-500 max-w-sm mx-auto">
            Thank you for sharing. Your care team will review your information
            and reach out soon.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-6 bg-red-50 border border-red-100 rounded-xl p-4">
          <p className="text-sm text-red-700">{error}</p>
          {status === "error" && (
            <Button onClick={startSession} variant="outline" size="sm" className="mt-3">
              Try Again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
