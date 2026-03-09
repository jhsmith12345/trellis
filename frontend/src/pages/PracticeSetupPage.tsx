import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { Button } from "../components/Button";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

const COMMON_INSURANCES = [
  "Aetna", "Anthem", "Blue Cross Blue Shield", "Cigna", "Humana",
  "Kaiser Permanente", "Magellan Health", "Medicaid", "Medicare",
  "Optum / UnitedHealthcare", "Tricare", "Other",
];

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "America/Phoenix", "Pacific/Honolulu",
];

interface FormData {
  practice_name: string;
  clinician_name: string;
  credentials: string;
  license_number: string;
  license_state: string;
  npi: string;
  tax_id: string;
  specialties: string;
  bio: string;
  phone: string;
  email: string;
  website: string;
  address_line1: string;
  address_line2: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  cash_only: boolean;
  accepted_insurances: string[];
  session_rate: string;
  intake_rate: string;
  sliding_scale: boolean;
  sliding_scale_min: string;
  default_session_duration: string;
  intake_duration: string;
  timezone: string;
}

const INITIAL: FormData = {
  practice_name: "",
  clinician_name: "",
  credentials: "",
  license_number: "",
  license_state: "",
  npi: "",
  tax_id: "",
  specialties: "",
  bio: "",
  phone: "",
  email: "",
  website: "",
  address_line1: "",
  address_line2: "",
  address_city: "",
  address_state: "",
  address_zip: "",
  cash_only: false,
  accepted_insurances: [],
  session_rate: "",
  intake_rate: "",
  sliding_scale: false,
  sliding_scale_min: "",
  default_session_duration: "53",
  intake_duration: "53",
  timezone: "America/New_York",
};

const STEPS = [
  { title: "Practice Info", desc: "Your practice name and specialties" },
  { title: "Credentials", desc: "License and provider information" },
  { title: "Contact & Address", desc: "How clients can reach you" },
  { title: "Billing & Rates", desc: "Payment model and session fees" },
];

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-warm-600 mb-1">
      {label}
      {required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

function Input({
  value,
  onChange,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-4 py-2.5 rounded-xl border border-warm-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-warm-800"
      {...props}
    />
  );
}

export default function PracticeSetupPage() {
  const navigate = useNavigate();
  const api = useApi();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof FormData>(key: K, val: FormData[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function toggleInsurance(name: string) {
    setForm((f) => ({
      ...f,
      accepted_insurances: f.accepted_insurances.includes(name)
        ? f.accepted_insurances.filter((i) => i !== name)
        : [...f.accepted_insurances, name],
    }));
  }

  function canAdvance(): boolean {
    if (step === 0) return !!form.clinician_name.trim();
    if (step === 1) return !!form.license_number.trim() && !!form.license_state;
    return true;
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        practice_name: form.practice_name || null,
        clinician_name: form.clinician_name,
        credentials: form.credentials || null,
        license_number: form.license_number || null,
        license_state: form.license_state || null,
        npi: form.npi || null,
        tax_id: form.tax_id || null,
        specialties: form.specialties
          ? form.specialties.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
        bio: form.bio || null,
        phone: form.phone || null,
        email: form.email || null,
        website: form.website || null,
        address_line1: form.address_line1 || null,
        address_line2: form.address_line2 || null,
        address_city: form.address_city || null,
        address_state: form.address_state || null,
        address_zip: form.address_zip || null,
        cash_only: form.cash_only,
        accepted_insurances: form.cash_only ? null : (form.accepted_insurances.length
          ? form.accepted_insurances
          : null),
        session_rate: form.session_rate ? parseFloat(form.session_rate) : null,
        intake_rate: form.intake_rate ? parseFloat(form.intake_rate) : null,
        sliding_scale: form.sliding_scale,
        sliding_scale_min: form.sliding_scale_min
          ? parseFloat(form.sliding_scale_min)
          : null,
        default_session_duration: form.default_session_duration
          ? parseInt(form.default_session_duration)
          : null,
        intake_duration: form.intake_duration
          ? parseInt(form.intake_duration)
          : null,
        timezone: form.timezone || null,
      };
      await api.put("/api/practice-profile", body);
      navigate("/dashboard");
    } catch (e: any) {
      setError(e.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-warm-50">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-warm-100 bg-white">
        <p className="font-display text-lg font-semibold text-warm-800">Trellis</p>
        <span className="text-sm text-warm-400">
          Step {step + 1} of {STEPS.length}
        </span>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Progress bar */}
        <div className="flex gap-2 mb-8">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= step ? "bg-teal-500" : "bg-warm-200"
              }`}
            />
          ))}
        </div>

        <h1 className="font-display text-2xl font-bold text-warm-800 mb-1">
          {STEPS[step]!.title}
        </h1>
        <p className="text-warm-500 mb-8">{STEPS[step]!.desc}</p>

        {/* Step 0: Practice Info */}
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <FieldLabel label="Practice Name" />
              <Input
                value={form.practice_name}
                onChange={(v) => set("practice_name", v)}
                placeholder="e.g. Mindful Healing Therapy"
              />
            </div>
            <div>
              <FieldLabel label="Your Full Name" required />
              <Input
                value={form.clinician_name}
                onChange={(v) => set("clinician_name", v)}
                placeholder="e.g. Dr. Jane Smith"
              />
            </div>
            <div>
              <FieldLabel label="Specialties" />
              <Input
                value={form.specialties}
                onChange={(v) => set("specialties", v)}
                placeholder="e.g. Substance Abuse, CBT, Trauma (comma-separated)"
              />
            </div>
            <div>
              <FieldLabel label="Bio" />
              <textarea
                value={form.bio}
                onChange={(e) => set("bio", e.target.value)}
                rows={4}
                className="w-full px-4 py-2.5 rounded-xl border border-warm-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-warm-800 resize-none"
                placeholder="A short professional bio for your clients..."
              />
            </div>
          </div>
        )}

        {/* Step 1: Credentials */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <FieldLabel label="Credentials" />
              <Input
                value={form.credentials}
                onChange={(v) => set("credentials", v)}
                placeholder="e.g. LCSW, LPC, PhD"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel label="License Number" required />
                <Input
                  value={form.license_number}
                  onChange={(v) => set("license_number", v)}
                  placeholder="e.g. 12345"
                />
              </div>
              <div>
                <FieldLabel label="License State" required />
                <select
                  value={form.license_state}
                  onChange={(e) => set("license_state", e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-warm-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-warm-800 bg-white"
                >
                  <option value="">Select state</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel label="NPI Number" />
                <Input
                  value={form.npi}
                  onChange={(v) => set("npi", v)}
                  placeholder="10-digit NPI"
                  maxLength={10}
                />
              </div>
              <div>
                <FieldLabel label="Tax ID / EIN" />
                <Input
                  value={form.tax_id}
                  onChange={(v) => set("tax_id", v)}
                  placeholder="XX-XXXXXXX"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Contact & Address */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel label="Phone" />
                <Input
                  value={form.phone}
                  onChange={(v) => set("phone", v)}
                  placeholder="(555) 555-5555"
                  type="tel"
                />
              </div>
              <div>
                <FieldLabel label="Email" />
                <Input
                  value={form.email}
                  onChange={(v) => set("email", v)}
                  placeholder="you@practice.com"
                  type="email"
                />
              </div>
            </div>
            <div>
              <FieldLabel label="Website" />
              <Input
                value={form.website}
                onChange={(v) => set("website", v)}
                placeholder="https://yourpractice.com"
              />
            </div>
            <div>
              <FieldLabel label="Address Line 1" />
              <Input
                value={form.address_line1}
                onChange={(v) => set("address_line1", v)}
                placeholder="123 Main St"
              />
            </div>
            <div>
              <FieldLabel label="Address Line 2" />
              <Input
                value={form.address_line2}
                onChange={(v) => set("address_line2", v)}
                placeholder="Suite 200"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <FieldLabel label="City" />
                <Input
                  value={form.address_city}
                  onChange={(v) => set("address_city", v)}
                  placeholder="City"
                />
              </div>
              <div>
                <FieldLabel label="State" />
                <select
                  value={form.address_state}
                  onChange={(e) => set("address_state", e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-warm-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-warm-800 bg-white"
                >
                  <option value="">State</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel label="ZIP" />
                <Input
                  value={form.address_zip}
                  onChange={(v) => set("address_zip", v)}
                  placeholder="12345"
                  maxLength={10}
                />
              </div>
            </div>
            <div>
              <FieldLabel label="Timezone" />
              <select
                value={form.timezone}
                onChange={(e) => set("timezone", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-warm-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-warm-800 bg-white"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace("America/", "").replace("Pacific/", "").replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Step 3: Billing & Rates */}
        {step === 3 && (
          <div className="space-y-6">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.cash_only}
                onChange={(e) => set("cash_only", e.target.checked)}
                className="w-4 h-4 rounded border-warm-300 text-teal-600 focus:ring-teal-500"
              />
              <div>
                <span className="text-sm font-medium text-warm-700">Cash-pay only</span>
                <p className="text-xs text-warm-400">
                  Hide insurance fields throughout the app. You can change this later in Practice Settings.
                </p>
              </div>
            </label>
            {!form.cash_only && (
              <div>
                <FieldLabel label="Accepted Insurance" />
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {COMMON_INSURANCES.map((ins) => (
                    <button
                      key={ins}
                      type="button"
                      onClick={() => toggleInsurance(ins)}
                      className={`px-3 py-2 rounded-lg text-sm text-left transition-all ${
                        form.accepted_insurances.includes(ins)
                          ? "bg-teal-50 border-2 border-teal-400 text-teal-700 font-medium"
                          : "bg-white border border-warm-200 text-warm-600 hover:border-warm-300"
                      }`}
                    >
                      {ins}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel label="Session Rate ($)" />
                <Input
                  value={form.session_rate}
                  onChange={(v) => set("session_rate", v)}
                  placeholder="150"
                  type="number"
                  min="0"
                />
              </div>
              <div>
                <FieldLabel label="Intake Rate ($)" />
                <Input
                  value={form.intake_rate}
                  onChange={(v) => set("intake_rate", v)}
                  placeholder="200"
                  type="number"
                  min="0"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel label="Session Duration (min)" />
                <Input
                  value={form.default_session_duration}
                  onChange={(v) => set("default_session_duration", v)}
                  type="number"
                  min="15"
                  max="120"
                />
              </div>
              <div>
                <FieldLabel label="Intake Duration (min)" />
                <Input
                  value={form.intake_duration}
                  onChange={(v) => set("intake_duration", v)}
                  type="number"
                  min="15"
                  max="120"
                />
              </div>
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.sliding_scale}
                  onChange={(e) => set("sliding_scale", e.target.checked)}
                  className="w-4 h-4 rounded border-warm-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="text-sm text-warm-700">
                  Offer sliding scale fees
                </span>
              </label>
              {form.sliding_scale && (
                <div className="pl-7">
                  <FieldLabel label="Minimum sliding scale rate ($)" />
                  <Input
                    value={form.sliding_scale_min}
                    onChange={(v) => set("sliding_scale_min", v)}
                    placeholder="50"
                    type="number"
                    min="0"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-10">
          {step > 0 ? (
            <Button
              variant="ghost"
              onClick={() => setStep((s) => s - 1)}
            >
              Back
            </Button>
          ) : (
            <div />
          )}

          {step < STEPS.length - 1 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance()}
            >
              Continue
            </Button>
          ) : (
            <Button onClick={handleSave} disabled={saving || !canAdvance()}>
              {saving ? "Saving..." : "Complete Setup"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
