import { useState, useEffect, useMemo } from "react";
import type { TimeSlot } from "../../types";
import { Button } from "../Button";
import { useApi } from "../../hooks/useApi";

const APPT_TYPES = [
  { value: "assessment", label: "Assessment", cpt: "90791", duration: 60 },
  { value: "individual", label: "Individual Session", cpt: "90834", duration: 50 },
  { value: "individual_extended", label: "Individual Session (Extended)", cpt: "90837", duration: 90 },
] as const;

type ApptType = (typeof APPT_TYPES)[number]["value"];

interface ClientOption {
  id: string;
  firebase_uid: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
}

interface BookingFlowProps {
  onBook: (data: {
    clinician_id: string;
    clinician_email: string;
    client_id: string;
    client_email: string;
    client_name: string;
    type: string;
    scheduled_at: string;
    duration_minutes: number;
  }) => Promise<void>;
  /** Pre-fill clinician info (skips clinician entry step) */
  clinicianId?: string;
  clinicianEmail?: string;
  /** Pre-fill client info (skips client selection step) */
  clientId?: string;
  clientEmail?: string;
  clientName?: string;
  getSlots: (
    clinicianId: string,
    start: string,
    end: string,
    type: string,
  ) => Promise<TimeSlot[]>;
}

type Step = "client" | "type" | "slots" | "confirm";

export function BookingFlow({
  onBook,
  clinicianId: prefilledClinicianId,
  clinicianEmail: prefilledClinicianEmail,
  clientId: prefilledClientId,
  clientEmail: prefilledClientEmail,
  clientName: prefilledClientName,
  getSlots,
}: BookingFlowProps) {
  const api = useApi();
  const hasPrefilledClinician = !!(prefilledClinicianId && prefilledClinicianEmail);
  const hasPrefilledClient = !!(prefilledClientId && prefilledClientEmail);

  // Determine starting step
  const firstStep: Step = hasPrefilledClient ? "type" : "client";

  const [step, setStep] = useState<Step>(firstStep);
  const [clinicianId] = useState(prefilledClinicianId || "");
  const [clinicianEmail] = useState(prefilledClinicianEmail || "");
  const [selectedClient, setSelectedClient] = useState<ClientOption | null>(
    hasPrefilledClient
      ? { id: "", firebase_uid: prefilledClientId!, first_name: prefilledClientName?.split(" ")[0] || "", last_name: prefilledClientName?.split(" ").slice(1).join(" ") || "", email: prefilledClientEmail!, status: "active" }
      : null,
  );
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [clientsLoading, setClientsLoading] = useState(false);
  const [apptType, setApptType] = useState<ApptType>("assessment");
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const typeInfo = APPT_TYPES.find((t) => t.value === apptType)!;

  // Load client list for clinician booking
  useEffect(() => {
    if (hasPrefilledClient) return;
    setClientsLoading(true);
    api.get<{ clients: ClientOption[] }>("/api/clients")
      .then((resp) => setClients(resp.clients.filter((c) => c.status === "active")))
      .catch(() => {})
      .finally(() => setClientsLoading(false));
  }, []);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const q = clientSearch.toLowerCase();
    return clients.filter(
      (c) =>
        `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q),
    );
  }, [clients, clientSearch]);

  async function handleFindSlots(e: React.FormEvent) {
    e.preventDefault();
    if (!clinicianId || !selectedClient) return;
    setLoading(true);
    setError("");
    try {
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 28);
      const results = await getSlots(
        clinicianId,
        start.toISOString(),
        end.toISOString(),
        apptType,
      );
      setSlots(results);
      setStep("slots");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const slotsByDate = useMemo(() => {
    const groups: Record<string, TimeSlot[]> = {};
    for (const s of slots) {
      const date = new Date(s.start).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
      if (!groups[date]) groups[date] = [];
      groups[date].push(s);
    }
    return groups;
  }, [slots]);

  async function handleConfirm() {
    if (!selectedSlot || !selectedClient) return;
    setBooking(true);
    setError("");
    try {
      await onBook({
        clinician_id: clinicianId,
        clinician_email: clinicianEmail,
        client_id: selectedClient.firebase_uid || prefilledClientId || "",
        client_email: selectedClient.email || prefilledClientEmail || "",
        client_name: `${selectedClient.first_name} ${selectedClient.last_name}`.trim() || prefilledClientName || "",
        type: apptType,
        scheduled_at: selectedSlot.start,
        duration_minutes: typeInfo.duration,
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBooking(false);
    }
  }

  function resetFlow() {
    setStep(firstStep);
    setSelectedSlot(null);
    setSlots([]);
    setSuccess(false);
    setApptType("assessment");
    if (!hasPrefilledClient) {
      setSelectedClient(null);
      setClientSearch("");
    }
  }

  if (success) {
    return (
      <div className="text-center py-12">
        <div className="w-14 h-14 mx-auto mb-4 bg-teal-100 rounded-full flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-teal-600">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-warm-800 mb-2">Appointment Booked</h3>
        <p className="text-warm-500 mb-1">
          Your {typeInfo.label.toLowerCase()} has been scheduled.
        </p>
        <p className="text-sm text-warm-400">Calendar invites have been sent to all participants.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-6"
          onClick={resetFlow}
        >
          Book Another
        </Button>
      </div>
    );
  }

  // Build visible steps for progress indicator
  const visibleSteps: Step[] = [];
  if (!hasPrefilledClient) visibleSteps.push("client");
  visibleSteps.push("type", "slots", "confirm");

  return (
    <div>
      {/* Progress steps */}
      <div className="flex items-center gap-2 mb-6">
        {visibleSteps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                step === s
                  ? "bg-teal-600 text-white"
                  : i < visibleSteps.indexOf(step)
                    ? "bg-teal-100 text-teal-700"
                    : "bg-warm-100 text-warm-400"
              }`}
            >
              {i + 1}
            </div>
            {i < visibleSteps.length - 1 && (
              <div className={`w-8 h-0.5 ${
                i < visibleSteps.indexOf(step)
                  ? "bg-teal-200"
                  : "bg-warm-100"
              }`} />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* Step: Select client */}
      {step === "client" && (
        <div>
          <h3 className="text-lg font-semibold text-warm-800 mb-4">
            Select Client
          </h3>
          {clientsLoading ? (
            <p className="text-sm text-warm-500">Loading clients...</p>
          ) : (
            <>
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full px-4 py-2.5 border border-warm-300 rounded-lg text-warm-800 placeholder:text-warm-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent mb-3"
              />
              {filteredClients.length === 0 ? (
                <p className="text-sm text-warm-500 py-4">No active clients found.</p>
              ) : (
                <div className="max-h-[300px] overflow-y-auto space-y-1">
                  {filteredClients.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedClient(c);
                        setStep("type");
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-warm-200 hover:border-teal-300 hover:bg-teal-50 transition-all text-left"
                    >
                      <div className="w-9 h-9 bg-teal-50 rounded-full flex items-center justify-center shrink-0">
                        <span className="text-sm font-semibold text-teal-600">
                          {c.first_name?.charAt(0).toUpperCase() || "?"}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-warm-800 truncate">
                          {c.first_name} {c.last_name}
                        </p>
                        <p className="text-xs text-warm-500 truncate">{c.email}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Step: Select appointment type & find slots */}
      {step === "type" && (
        <div>
          <h3 className="text-lg font-semibold text-warm-800 mb-4">
            Appointment Details
          </h3>
          {selectedClient && (
            <div className="bg-warm-50 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-warm-800">
                  {selectedClient.first_name} {selectedClient.last_name}
                </p>
                <p className="text-xs text-warm-500">{selectedClient.email}</p>
              </div>
              {!hasPrefilledClient && (
                <Button variant="ghost" size="sm" onClick={() => { setSelectedClient(null); setStep("client"); }}>
                  Change
                </Button>
              )}
            </div>
          )}
          <form onSubmit={handleFindSlots} className="space-y-4 max-w-md">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">
                Appointment Type
              </label>
              <select
                value={apptType}
                onChange={(e) => setApptType(e.target.value as ApptType)}
                className="w-full px-4 py-2.5 border border-warm-300 rounded-lg text-warm-800 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white"
              >
                {APPT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label} ({t.duration} min — CPT {t.cpt})
                  </option>
                ))}
              </select>
            </div>
            {!hasPrefilledClinician && (
              <>
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">
                    Clinician ID
                  </label>
                  <input
                    type="text"
                    value={clinicianId}
                    readOnly
                    placeholder="Enter clinician user ID"
                    className="w-full px-4 py-2.5 border border-warm-300 rounded-lg text-warm-800 placeholder:text-warm-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-warm-700 mb-1">
                    Clinician Email
                  </label>
                  <input
                    type="email"
                    value={clinicianEmail}
                    readOnly
                    placeholder="clinician@example.com"
                    className="w-full px-4 py-2.5 border border-warm-300 rounded-lg text-warm-800 placeholder:text-warm-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    required
                  />
                </div>
              </>
            )}
            <Button size="sm" type="submit" disabled={loading || !selectedClient}>
              {loading ? "Loading slots..." : "Find Available Slots"}
            </Button>
          </form>
        </div>
      )}

      {/* Step: Select slot */}
      {step === "slots" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-warm-800">
              Select a time slot
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setStep("type")}>
              Back
            </Button>
          </div>

          {slots.length === 0 ? (
            <div className="text-center py-8 text-warm-500">
              <p>No available slots found in the next 4 weeks.</p>
              <p className="text-sm mt-1">Check your availability settings and try again.</p>
            </div>
          ) : (
            <div className="space-y-6 max-h-[400px] overflow-y-auto pr-2">
              {Object.entries(slotsByDate).map(([date, daySlots]) => (
                <div key={date}>
                  <h4 className="text-sm font-semibold text-warm-600 mb-2 sticky top-0 bg-white py-1">
                    {date}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {daySlots.map((s) => {
                      const t = new Date(s.start);
                      const label = t.toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      });
                      const selected = selectedSlot?.start === s.start;
                      return (
                        <button
                          key={s.start}
                          onClick={() => {
                            setSelectedSlot(s);
                            setStep("confirm");
                          }}
                          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                            selected
                              ? "border-teal-500 bg-teal-50 text-teal-700"
                              : "border-warm-200 text-warm-700 hover:border-teal-300 hover:bg-teal-50"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step: Confirm */}
      {step === "confirm" && selectedSlot && selectedClient && (
        <div>
          <h3 className="text-lg font-semibold text-warm-800 mb-4">
            Confirm Appointment
          </h3>
          <div className="bg-warm-50 rounded-xl p-5 space-y-3 mb-6">
            <div className="flex justify-between text-sm">
              <span className="text-warm-500">Client</span>
              <span className="font-medium text-warm-800">
                {selectedClient.first_name} {selectedClient.last_name}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-warm-500">Type</span>
              <span className="font-medium text-warm-800">{typeInfo.label}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-warm-500">Date & Time</span>
              <span className="font-medium text-warm-800">
                {new Date(selectedSlot.start).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}{" "}
                at{" "}
                {new Date(selectedSlot.start).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-warm-500">Duration</span>
              <span className="font-medium text-warm-800">{typeInfo.duration} minutes</span>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep("slots")}>
              Back
            </Button>
            <Button onClick={handleConfirm} disabled={booking}>
              {booking ? "Booking..." : "Confirm Booking"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
