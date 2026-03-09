import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClientOption {
  id: string;
  firebase_uid: string;
  full_name: string | null;
  preferred_name: string | null;
  email: string | null;
  status: string;
}

// ---------------------------------------------------------------------------
// Section definitions per format
// ---------------------------------------------------------------------------

const FORMAT_SECTIONS: Record<string, { key: string; label: string; placeholder: string }[]> = {
  SOAP: [
    { key: "subjective", label: "Subjective", placeholder: "Client's self-reported experience, mood, symptoms, stressors..." },
    { key: "objective", label: "Objective", placeholder: "Your clinical observations, interventions used, affect, behavior..." },
    { key: "assessment", label: "Assessment", placeholder: "Diagnostic status, treatment response, progress, risk assessment..." },
    { key: "plan", label: "Plan", placeholder: "Next session focus, homework, referrals, safety planning..." },
  ],
  DAP: [
    { key: "data", label: "Data", placeholder: "Client statements, observations, interventions, topics discussed..." },
    { key: "assessment", label: "Assessment", placeholder: "Diagnostic status, treatment response, progress, risk assessment..." },
    { key: "plan", label: "Plan", placeholder: "Next session plans, homework, referrals, treatment modifications..." },
  ],
  narrative: [
    { key: "identifying_information", label: "Identifying Information", placeholder: "Age, gender identity, referral source..." },
    { key: "presenting_problem", label: "Presenting Problem", placeholder: "Chief complaint, reason for seeking treatment..." },
    { key: "history_of_present_illness", label: "History of Present Illness", placeholder: "Chronological narrative of current symptoms..." },
    { key: "psychiatric_history", label: "Psychiatric History", placeholder: "Past diagnoses, hospitalizations, medication trials..." },
    { key: "substance_use_history", label: "Substance Use History", placeholder: "Current and past substance use..." },
    { key: "medical_history", label: "Medical History", placeholder: "Current conditions, medications, allergies..." },
    { key: "family_history", label: "Family History", placeholder: "Family psychiatric and substance use history..." },
    { key: "social_developmental_history", label: "Social & Developmental History", placeholder: "Education, employment, relationships, trauma..." },
    { key: "mental_status_examination", label: "Mental Status Examination", placeholder: "Appearance, behavior, speech, mood, affect..." },
    { key: "diagnostic_impressions", label: "Diagnostic Impressions", placeholder: "Provisional DSM-5 diagnoses with ICD-10 codes..." },
    { key: "risk_assessment", label: "Risk Assessment", placeholder: "SI/HI, self-harm, protective factors, risk level..." },
    { key: "treatment_recommendations", label: "Treatment Recommendations", placeholder: "Recommended frequency, modality, approach..." },
    { key: "clinical_summary", label: "Clinical Summary", placeholder: "2-3 sentence integrative summary..." },
  ],
};

const FORMAT_LABELS: Record<string, string> = {
  SOAP: "SOAP Progress Note",
  DAP: "DAP Progress Note",
  narrative: "Biopsychosocial Assessment",
};

// ---------------------------------------------------------------------------
// Speech Recognition types
// ---------------------------------------------------------------------------

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult | undefined;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative | undefined;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ManualNotePage() {
  const navigate = useNavigate();
  const api = useApi();
  const [searchParams] = useSearchParams();
  const preselectedClientId = searchParams.get("client");
  const preselectedAppointmentId = searchParams.get("appointment");

  // State
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState(preselectedClientId || "");
  const [noteFormat, setNoteFormat] = useState<"SOAP" | "DAP" | "narrative">("SOAP");
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [durationMinutes, setDurationMinutes] = useState<number>(45);
  const [mode, setMode] = useState<"record" | "dictation" | "form">("record");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Form mode state
  const [formContent, setFormContent] = useState<Record<string, string>>({});

  // Dictation mode state
  const [dictationText, setDictationText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState("");
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Record session state
  const [sessionRecording, setSessionRecording] = useState(false);
  const [sessionPaused, setSessionPaused] = useState(false);
  const [sessionTranscript, setSessionTranscript] = useState("");
  const [sessionInterim, setSessionInterim] = useState("");
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const sessionRecognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionStartTimeRef = useRef<number>(0);

  // Check speech recognition support
  const speechSupported = typeof window !== "undefined" && (
    "SpeechRecognition" in window || "webkitSpeechRecognition" in window
  );

  // Load clients
  useEffect(() => {
    async function load() {
      try {
        const resp = await api.get<{ clients: ClientOption[] }>("/api/clients");
        const active = (resp.clients || []).filter((c) => c.status !== "discharged");
        setClients(active);
        if (!clientId && active.length === 1 && active[0]) {
          setClientId(active[0].firebase_uid);
        }
      } catch (err) {
        console.error("Failed to load clients:", err);
        setError("Failed to load client list.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset form content when format changes
  useEffect(() => {
    const sections = FORMAT_SECTIONS[noteFormat] || [];
    const blank: Record<string, string> = {};
    for (const s of sections) blank[s.key] = "";
    setFormContent(blank);
  }, [noteFormat]);

  // Speech recognition
  const startRecording = useCallback(() => {
    if (!speechSupported) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition: SpeechRecognitionInstance = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      if (final) {
        setDictationText((prev) => prev + (prev ? " " : "") + final);
      }
      setInterimText(interim);
    };

    recognition.onend = () => {
      setIsRecording(false);
      setInterimText("");
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      setIsRecording(false);
      setInterimText("");
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
  }, [speechSupported]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
    setInterimText("");
  }, []);

  // Session recording functions
  const startSession = useCallback(() => {
    if (!speechSupported) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition: SpeechRecognitionInstance = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      if (final) {
        setSessionTranscript((prev) => prev + (prev ? " " : "") + final);
      }
      setSessionInterim(interim);
    };

    recognition.onend = () => {
      // Auto-restart if still recording (browser stops after silence)
      if (sessionRecognitionRef.current && !sessionPaused) {
        try {
          recognition.start();
        } catch {
          // Already started or stopped
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        console.error("Session recognition error:", event.error);
      }
    };

    recognition.start();
    sessionRecognitionRef.current = recognition;
    sessionStartTimeRef.current = Date.now();
    setSessionRecording(true);
    setSessionPaused(false);

    // Timer
    sessionTimerRef.current = setInterval(() => {
      setSessionElapsed(Math.floor((Date.now() - sessionStartTimeRef.current) / 1000));
    }, 1000);
  }, [speechSupported, sessionPaused]);

  const pauseSession = useCallback(() => {
    if (sessionRecognitionRef.current) {
      sessionRecognitionRef.current.stop();
      sessionRecognitionRef.current = null;
    }
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    setSessionPaused(true);
    setSessionInterim("");
  }, []);

  const resumeSession = useCallback(() => {
    if (!speechSupported) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition: SpeechRecognitionInstance = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      if (final) {
        setSessionTranscript((prev) => prev + (prev ? " " : "") + final);
      }
      setSessionInterim(interim);
    };

    recognition.onend = () => {
      if (sessionRecognitionRef.current && !sessionPaused) {
        try { recognition.start(); } catch { /* */ }
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        console.error("Session recognition error:", event.error);
      }
    };

    recognition.start();
    sessionRecognitionRef.current = recognition;
    setSessionPaused(false);

    const pausedElapsed = sessionElapsed;
    const resumeTime = Date.now();
    sessionTimerRef.current = setInterval(() => {
      setSessionElapsed(pausedElapsed + Math.floor((Date.now() - resumeTime) / 1000));
    }, 1000);
  }, [speechSupported, sessionPaused, sessionElapsed]);

  const endSession = useCallback(() => {
    if (sessionRecognitionRef.current) {
      sessionRecognitionRef.current.stop();
      sessionRecognitionRef.current = null;
    }
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    setSessionRecording(false);
    setSessionPaused(false);
    setSessionInterim("");
    // Set duration from elapsed time
    setDurationMinutes(Math.max(1, Math.round(sessionElapsed / 60)));
  }, [sessionElapsed]);

  const handleSessionSubmit = async () => {
    if (!clientId) { setError("Please select a client."); return; }
    if (!sessionTranscript.trim()) { setError("No transcript captured. Please try again."); return; }

    setSubmitting(true);
    setError("");
    try {
      const res = await api.post<{ note_id: string; encounter_id: string; format: string; content: Record<string, string> }>(
        "/api/notes/generate-from-dictation",
        {
          client_id: clientId,
          dictation: sessionTranscript,
          format: noteFormat,
          session_date: sessionDate,
          duration_minutes: Math.max(1, Math.round(sessionElapsed / 60)),
          appointment_id: preselectedAppointmentId || undefined,
        },
      );
      navigate(`/notes/${res.note_id}`);
    } catch (err: any) {
      console.error("Failed to generate note:", err);
      setError(err.message || "Failed to generate note from session recording.");
    } finally {
      setSubmitting(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (sessionRecognitionRef.current) {
        sessionRecognitionRef.current.abort();
      }
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
      }
    };
  }, []);

  // Submit: form mode → create manual note
  const handleFormSubmit = async () => {
    if (!clientId) { setError("Please select a client."); return; }
    const hasContent = Object.values(formContent).some((v) => v.trim());
    if (!hasContent) { setError("Please fill in at least one section."); return; }

    setSubmitting(true);
    setError("");
    try {
      // Create encounter + blank note, then update with form content
      const res = await api.post<{ note_id: string; encounter_id: string }>(
        "/api/notes/create-manual",
        {
          client_id: clientId,
          format: noteFormat,
          appointment_id: preselectedAppointmentId || undefined,
        },
      );
      // Update the note with the form content
      await api.put(`/api/notes/${res.note_id}`, { content: formContent });
      navigate(`/notes/${res.note_id}`);
    } catch (err: any) {
      console.error("Failed to create note:", err);
      setError(err.message || "Failed to create note.");
    } finally {
      setSubmitting(false);
    }
  };

  // Submit: dictation mode → generate via Gemini
  const handleDictationSubmit = async () => {
    if (!clientId) { setError("Please select a client."); return; }
    if (!dictationText.trim()) { setError("Please enter or dictate session notes."); return; }

    setSubmitting(true);
    setError("");
    try {
      const res = await api.post<{ note_id: string; encounter_id: string; format: string; content: Record<string, string> }>(
        "/api/notes/generate-from-dictation",
        {
          client_id: clientId,
          dictation: dictationText,
          format: noteFormat,
          session_date: sessionDate,
          duration_minutes: durationMinutes,
          appointment_id: preselectedAppointmentId || undefined,
        },
      );
      navigate(`/notes/${res.note_id}`);
    } catch (err: any) {
      console.error("Failed to generate note:", err);
      setError(err.message || "Failed to generate note from dictation.");
    } finally {
      setSubmitting(false);
    }
  };

  // Auto-resize textarea
  const handleDictationChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDictationText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  };

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const sections = FORMAT_SECTIONS[noteFormat] || [];

  return (
    <div className="px-8 py-8 max-w-4xl">
      {/* Back link */}
      <Link
        to="/clients"
        className="inline-flex items-center gap-1 text-sm text-warm-500 hover:text-warm-700 transition-colors mb-6"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
        </svg>
        Back
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold text-warm-800">Session Documentation</h1>
        <p className="text-sm text-warm-500 mt-1">
          Document your session with live recording, post-session dictation, or manual entry. No Google Workspace required — works with just your browser.
        </p>
      </div>

      {/* Session setup */}
      <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-6 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Client */}
          <div>
            <label className="block text-xs font-medium text-warm-500 uppercase tracking-wide mb-1.5">
              Client
            </label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full rounded-lg border border-warm-200 bg-white px-3 py-2 text-sm text-warm-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
            >
              <option value="">Select client...</option>
              {clients.map((c) => (
                <option key={c.firebase_uid} value={c.firebase_uid}>
                  {c.preferred_name || c.full_name || c.email}
                </option>
              ))}
            </select>
          </div>

          {/* Format */}
          <div>
            <label className="block text-xs font-medium text-warm-500 uppercase tracking-wide mb-1.5">
              Note Format
            </label>
            <select
              value={noteFormat}
              onChange={(e) => setNoteFormat(e.target.value as "SOAP" | "DAP" | "narrative")}
              className="w-full rounded-lg border border-warm-200 bg-white px-3 py-2 text-sm text-warm-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
            >
              <option value="SOAP">SOAP Progress Note</option>
              <option value="DAP">DAP Progress Note</option>
              <option value="narrative">Biopsychosocial Assessment</option>
            </select>
          </div>

          {/* Session date */}
          <div>
            <label className="block text-xs font-medium text-warm-500 uppercase tracking-wide mb-1.5">
              Session Date
            </label>
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className="w-full rounded-lg border border-warm-200 bg-white px-3 py-2 text-sm text-warm-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
            />
          </div>

          {/* Duration */}
          <div>
            <label className="block text-xs font-medium text-warm-500 uppercase tracking-wide mb-1.5">
              Duration (min)
            </label>
            <input
              type="number"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 0)}
              min={0}
              max={240}
              className="w-full rounded-lg border border-warm-200 bg-white px-3 py-2 text-sm text-warm-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
            />
          </div>
        </div>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 bg-warm-100 rounded-xl p-1 mb-6">
        <button
          onClick={() => setMode("record")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            mode === "record"
              ? "bg-white text-warm-800 shadow-sm"
              : "text-warm-500 hover:text-warm-700"
          }`}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
          </svg>
          Live Session
        </button>
        <button
          onClick={() => setMode("dictation")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            mode === "dictation"
              ? "bg-white text-warm-800 shadow-sm"
              : "text-warm-500 hover:text-warm-700"
          }`}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
            <path d="M5.5 9.643a.75.75 0 00-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-1.5v-1.546A6.001 6.001 0 0016 10v-.357a.75.75 0 00-1.5 0V10a4.5 4.5 0 01-9 0v-.357z" />
          </svg>
          Post-Session Notes
        </button>
        <button
          onClick={() => setMode("form")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            mode === "form"
              ? "bg-white text-warm-800 shadow-sm"
              : "text-warm-500 hover:text-warm-700"
          }`}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z" clipRule="evenodd" />
          </svg>
          Form Entry
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6 flex items-start gap-3">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError("")} className="ml-auto text-red-400 hover:text-red-600">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
      )}

      {/* Record session mode */}
      {mode === "record" && (
        <div className="space-y-4">
          {!speechSupported ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-amber-400 mx-auto mb-3">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-amber-700 font-medium">Speech recognition is not supported in this browser.</p>
              <p className="text-xs text-amber-600 mt-1">Please use Chrome, Edge, or Safari for live session recording.</p>
            </div>
          ) : !sessionRecording && !sessionTranscript ? (
            /* Not yet started */
            <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-8 text-center">
              <div className="w-20 h-20 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-teal-600">
                  <path d="M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="2" />
                  <path d="M19 10v1a7 7 0 01-14 0v-1M12 18v4m-4 0h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-warm-800 mb-2">Record During Your Session</h3>
              <p className="text-sm text-warm-500 mb-6 max-w-md mx-auto">
                Use your browser's microphone to transcribe the session as it happens.
                No Meet recording or Workspace account needed — just click start before your session begins.
                When you're done, AI will generate a structured {FORMAT_LABELS[noteFormat]} from the transcript.
              </p>
              <button
                onClick={startSession}
                disabled={!clientId}
                className="inline-flex items-center gap-2 px-6 py-3 bg-teal-600 text-white rounded-xl font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
                </svg>
                Start Recording
              </button>
              {!clientId && (
                <p className="text-xs text-amber-600 mt-3">Please select a client first.</p>
              )}
            </div>
          ) : sessionRecording ? (
            /* Currently recording */
            <div className="space-y-4">
              {/* Recording controls */}
              <div className="bg-white rounded-2xl border border-warm-100 shadow-sm overflow-hidden">
                <div className="px-6 py-4 bg-red-50 border-b border-red-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {!sessionPaused && (
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                      </span>
                    )}
                    <div>
                      <h3 className="text-sm font-semibold text-red-800">
                        {sessionPaused ? "Recording Paused" : "Recording Session"}
                      </h3>
                      <p className="text-xs text-red-600 mt-0.5 font-mono">
                        {formatElapsed(sessionElapsed)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {sessionPaused ? (
                      <button
                        onClick={resumeSession}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                          <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
                        </svg>
                        Resume
                      </button>
                    ) : (
                      <button
                        onClick={pauseSession}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                          <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
                        </svg>
                        Pause
                      </button>
                    )}
                    <button
                      onClick={endSession}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path d="M5.25 3A2.25 2.25 0 003 5.25v9.5A2.25 2.25 0 005.25 17h9.5A2.25 2.25 0 0017 14.75v-9.5A2.25 2.25 0 0014.75 3h-9.5z" />
                      </svg>
                      End Session
                    </button>
                  </div>
                </div>

                {/* Live transcript */}
                <div className="p-6">
                  <div className="min-h-[250px] max-h-[500px] overflow-y-auto rounded-lg border border-warm-200 bg-warm-50/50 px-4 py-3">
                    {sessionTranscript ? (
                      <p className="text-sm text-warm-700 leading-relaxed whitespace-pre-wrap">
                        {sessionTranscript}
                        {sessionInterim && (
                          <span className="text-warm-400 italic"> {sessionInterim}</span>
                        )}
                      </p>
                    ) : (
                      <p className="text-sm text-warm-400 italic">
                        {sessionPaused
                          ? "Recording paused. Resume to continue transcription."
                          : "Listening... Speak and your words will appear here in real-time."}
                      </p>
                    )}
                  </div>
                  {sessionTranscript && (
                    <p className="mt-2 text-xs text-warm-400">
                      {sessionTranscript.split(/\s+/).filter(Boolean).length} words transcribed
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Session ended, transcript ready */
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-warm-100 shadow-sm overflow-hidden">
                <div className="px-6 py-4 bg-teal-50 border-b border-teal-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-teal-800">Session Recorded</h3>
                    <p className="text-xs text-teal-600 mt-0.5">
                      {formatElapsed(sessionElapsed)} &middot; {sessionTranscript.split(/\s+/).filter(Boolean).length} words
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSessionTranscript("");
                        setSessionElapsed(0);
                      }}
                      className="px-3 py-2 text-xs font-medium text-warm-500 hover:text-warm-700 transition-colors"
                    >
                      Discard & Re-record
                    </button>
                  </div>
                </div>
                <div className="p-6">
                  <textarea
                    value={sessionTranscript}
                    onChange={(e) => setSessionTranscript(e.target.value)}
                    rows={12}
                    className="w-full resize-y rounded-lg border border-warm-200 bg-warm-50/50 px-4 py-3 text-sm text-warm-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 focus:bg-white transition-colors"
                  />
                  <p className="mt-2 text-xs text-warm-400">
                    You can edit the transcript above before generating the note.
                  </p>
                </div>
              </div>

              <button
                onClick={handleSessionSubmit}
                disabled={submitting || !clientId || !sessionTranscript.trim()}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-teal-600 text-white rounded-xl font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Generating note...
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.28a.75.75 0 00-.75.75v3.955a.75.75 0 001.5 0v-2.134l.21.21a7 7 0 0011.712-3.138.75.75 0 00-1.449-.388zm1.217-7.16a.75.75 0 00-1.5 0v2.134l-.21-.21A7 7 0 003.107 9.326a.75.75 0 001.449.388 5.5 5.5 0 019.201-2.466l.312.311h-2.433a.75.75 0 000 1.5H15.588a.75.75 0 00.75-.75V4.354z" clipRule="evenodd" />
                    </svg>
                    Generate {FORMAT_LABELS[noteFormat]} with AI
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Dictation mode */}
      {mode === "dictation" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-warm-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-warm-50 border-b border-warm-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-warm-700">Post-Session Notes</h3>
                <p className="text-xs text-warm-400 mt-0.5">
                  After your session, dictate or type what happened in any order. AI will structure it into a {FORMAT_LABELS[noteFormat]}.
                </p>
              </div>
              {speechSupported && (
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    isRecording
                      ? "bg-red-500 text-white hover:bg-red-600 shadow-md shadow-red-200"
                      : "bg-teal-600 text-white hover:bg-teal-700"
                  }`}
                >
                  {isRecording ? (
                    <>
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                      </span>
                      Stop Recording
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
                        <path d="M5.5 9.643a.75.75 0 00-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-1.5v-1.546A6.001 6.001 0 0016 10v-.357a.75.75 0 00-1.5 0V10a4.5 4.5 0 01-9 0v-.357z" />
                      </svg>
                      Start Dictation
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="p-6">
              <textarea
                ref={textareaRef}
                value={dictationText}
                onChange={handleDictationChange}
                placeholder="Start speaking or type your session notes here... You can include anything: client statements, your observations, interventions used, treatment progress, plans for next session. The AI will organize it into the proper clinical format."
                className="w-full min-h-[300px] resize-none rounded-lg border border-warm-200 bg-warm-50/50 px-4 py-3 text-sm text-warm-800 leading-relaxed placeholder-warm-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 focus:bg-white transition-colors"
              />
              {interimText && (
                <p className="mt-2 text-sm text-warm-400 italic">{interimText}</p>
              )}
              {dictationText && (
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-warm-400">
                    {dictationText.split(/\s+/).filter(Boolean).length} words
                  </p>
                  <button
                    onClick={() => { setDictationText(""); if (textareaRef.current) textareaRef.current.style.height = "auto"; }}
                    className="text-xs text-warm-400 hover:text-red-500 transition-colors"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleDictationSubmit}
            disabled={submitting || !clientId || !dictationText.trim()}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-teal-600 text-white rounded-xl font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating note...
              </>
            ) : (
              <>
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.28a.75.75 0 00-.75.75v3.955a.75.75 0 001.5 0v-2.134l.21.21a7 7 0 0011.712-3.138.75.75 0 00-1.449-.388zm1.217-7.16a.75.75 0 00-1.5 0v2.134l-.21-.21A7 7 0 003.107 9.326a.75.75 0 001.449.388 5.5 5.5 0 019.201-2.466l.312.311h-2.433a.75.75 0 000 1.5H15.588a.75.75 0 00.75-.75V4.354z" clipRule="evenodd" />
                </svg>
                Generate {FORMAT_LABELS[noteFormat]} with AI
              </>
            )}
          </button>
        </div>
      )}

      {/* Form mode */}
      {mode === "form" && (
        <div className="space-y-4">
          {sections.map((section) => (
            <div
              key={section.key}
              className="bg-white rounded-2xl border border-warm-100 shadow-sm overflow-hidden"
            >
              <div className="px-6 py-3 bg-warm-50 border-b border-warm-100">
                <h3 className="text-sm font-semibold text-warm-700">{section.label}</h3>
              </div>
              <div className="p-6">
                <textarea
                  value={formContent[section.key] || ""}
                  onChange={(e) =>
                    setFormContent((prev) => ({ ...prev, [section.key]: e.target.value }))
                  }
                  placeholder={section.placeholder}
                  rows={4}
                  className="w-full resize-y rounded-lg border border-warm-200 bg-warm-50/50 px-4 py-3 text-sm text-warm-800 leading-relaxed placeholder-warm-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 focus:bg-white transition-colors"
                />
              </div>
            </div>
          ))}

          {/* Submit button */}
          <button
            onClick={handleFormSubmit}
            disabled={submitting || !clientId}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-teal-600 text-white rounded-xl font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Creating note...
              </>
            ) : (
              <>
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                </svg>
                Create {FORMAT_LABELS[noteFormat]}
              </>
            )}
          </button>
        </div>
      )}

      {/* Help text */}
      <div className="mt-6 bg-warm-50 rounded-xl border border-warm-100 px-5 py-4">
        <p className="text-xs text-warm-500 leading-relaxed">
          {mode === "record" ? (
            <>
              <strong>Live Session:</strong> Transcribe your session in real-time using your browser's microphone.
              You can pause and resume during the session. When finished, review the transcript and
              generate a structured {FORMAT_LABELS[noteFormat]}. You can edit the note before signing.
            </>
          ) : mode === "dictation" ? (
            <>
              <strong>Post-Session Notes:</strong> After your session, speak or type what happened in any order — observations,
              client quotes, interventions, plans, anything you remember. The AI will organize your notes
              into a proper {FORMAT_LABELS[noteFormat]} format. You can review and edit the generated note
              before signing.
            </>
          ) : (
            <>
              <strong>Form Entry:</strong> Fill in each section of the {FORMAT_LABELS[noteFormat]} directly.
              You can leave sections empty and fill them in later from the note editor.
              The note will be created as a draft that you can edit and sign when ready.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
