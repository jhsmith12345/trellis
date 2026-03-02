import { useState, useMemo } from "react";
import type { TimeSlot } from "../../types";
import { Button } from "../Button";

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
  clientId: string;
  clientEmail: string;
  clientName: string;
  getSlots: (
    clinicianId: string,
    start: string,
    end: string,
    type: string,
  ) => Promise<TimeSlot[]>;
}

type Step = "clinician" | "slots" | "confirm";
const STEPS: Step[] = ["clinician", "slots", "confirm"];

export function BookingFlow({
  onBook,
  clientId,
  clientEmail,
  clientName,
  getSlots,
}: BookingFlowProps) {
  const [step, setStep] = useState<Step>("clinician");
  const [clinicianId, setClinicianId] = useState("");
  const [clinicianEmail, setClinicianEmail] = useState("");
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleClinicianSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clinicianId.trim()) return;
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
        "assessment",
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
    if (!selectedSlot) return;
    setBooking(true);
    setError("");
    try {
      await onBook({
        clinician_id: clinicianId,
        clinician_email: clinicianEmail,
        client_id: clientId,
        client_email: clientEmail,
        client_name: clientName,
        type: "assessment",
        scheduled_at: selectedSlot.start,
        duration_minutes: 60,
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBooking(false);
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
        <h3 className="text-xl font-semibold text-warm-800 mb-2">Assessment Booked</h3>
        <p className="text-warm-500 mb-1">
          Your initial assessment has been scheduled.
        </p>
        <p className="text-sm text-warm-400">Calendar invites have been sent to all participants.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-6"
          onClick={() => {
            setStep("clinician");
            setSelectedSlot(null);
            setSlots([]);
            setSuccess(false);
          }}
        >
          Book Another
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Progress steps */}
      <div className="flex items-center gap-2 mb-6">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                step === s
                  ? "bg-teal-600 text-white"
                  : i < STEPS.indexOf(step)
                    ? "bg-teal-100 text-teal-700"
                    : "bg-warm-100 text-warm-400"
              }`}
            >
              {i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-0.5 ${
                i < STEPS.indexOf(step)
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

      {/* Step 1: Enter clinician */}
      {step === "clinician" && (
        <div>
          <h3 className="text-lg font-semibold text-warm-800 mb-4">
            Which clinician?
          </h3>
          <form onSubmit={handleClinicianSubmit} className="space-y-4 max-w-md">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">
                Clinician ID
              </label>
              <input
                type="text"
                value={clinicianId}
                onChange={(e) => setClinicianId(e.target.value)}
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
                onChange={(e) => setClinicianEmail(e.target.value)}
                placeholder="clinician@example.com"
                className="w-full px-4 py-2.5 border border-warm-300 rounded-lg text-warm-800 placeholder:text-warm-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                required
              />
            </div>
            <Button size="sm" type="submit" disabled={loading}>
              {loading ? "Loading slots..." : "Find Available Slots"}
            </Button>
          </form>
        </div>
      )}

      {/* Step 2: Select slot */}
      {step === "slots" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-warm-800">
              Select a time slot
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setStep("clinician")}>
              Back
            </Button>
          </div>

          {slots.length === 0 ? (
            <div className="text-center py-8 text-warm-500">
              <p>No available slots found in the next 4 weeks.</p>
              <p className="text-sm mt-1">Try a different clinician or check back later.</p>
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

      {/* Step 3: Confirm */}
      {step === "confirm" && selectedSlot && (
        <div>
          <h3 className="text-lg font-semibold text-warm-800 mb-4">
            Confirm Assessment
          </h3>
          <div className="bg-warm-50 rounded-xl p-5 space-y-3 mb-6">
            <div className="flex justify-between text-sm">
              <span className="text-warm-500">Type</span>
              <span className="font-medium text-warm-800">Assessment</span>
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
              <span className="text-warm-500">Clinician</span>
              <span className="font-medium text-warm-800">{clinicianEmail}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-warm-500">Duration</span>
              <span className="font-medium text-warm-800">60 minutes</span>
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
