import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";
import { useGoogleOAuth } from "../hooks/useGoogleOAuth";
import { Button } from "../components/Button";
import type { PracticeProfile } from "../types";

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
  accepted_insurances: string[];
  cash_only: boolean;
  booking_enabled: boolean;
  session_rate: string;
  intake_rate: string;
  sliding_scale: boolean;
  sliding_scale_min: string;
  default_session_duration: string;
  intake_duration: string;
  timezone: string;
}

function profileToForm(p: PracticeProfile): FormData {
  return {
    practice_name: p.practice_name || "",
    clinician_name: p.clinician_name || "",
    credentials: p.credentials || "",
    license_number: p.license_number || "",
    license_state: p.license_state || "",
    npi: p.npi || "",
    tax_id: p.tax_id || "",
    specialties: (p.specialties || []).join(", "),
    bio: p.bio || "",
    phone: p.phone || "",
    email: p.email || "",
    website: p.website || "",
    address_line1: p.address_line1 || "",
    address_line2: p.address_line2 || "",
    address_city: p.address_city || "",
    address_state: p.address_state || "",
    address_zip: p.address_zip || "",
    accepted_insurances: p.accepted_insurances || [],
    cash_only: p.cash_only || false,
    booking_enabled: p.booking_enabled !== false,
    session_rate: p.session_rate != null ? String(p.session_rate) : "",
    intake_rate: p.intake_rate != null ? String(p.intake_rate) : "",
    sliding_scale: p.sliding_scale || false,
    sliding_scale_min: p.sliding_scale_min != null ? String(p.sliding_scale_min) : "",
    default_session_duration: p.default_session_duration != null ? String(p.default_session_duration) : "53",
    intake_duration: p.intake_duration != null ? String(p.intake_duration) : "53",
    timezone: p.timezone || "America/New_York",
  };
}

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
  disabled,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-4 py-2.5 rounded-xl border border-warm-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-warm-800 disabled:bg-warm-50 disabled:text-warm-400 disabled:cursor-not-allowed"
      {...props}
    />
  );
}

export default function PracticeSettingsPage() {
  const api = useApi();
  const { isOwner, practiceType } = useAuth();
  const [form, setForm] = useState<FormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const google = useGoogleOAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [googleToast, setGoogleToast] = useState("");

  useEffect(() => {
    if (searchParams.get("google") === "connected") {
      setGoogleToast("Google account connected successfully!");
      google.refresh();
      const next = new URLSearchParams(searchParams);
      next.delete("google");
      next.delete("tab");
      setSearchParams(next, { replace: true });
      const timer = setTimeout(() => setGoogleToast(""), 5000);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.get<PracticeProfile>("/api/practice-profile");
        if (data.exists) {
          setForm(profileToForm(data));
        } else {
          // Empty form for first setup
          setForm({
            practice_name: "", clinician_name: "", credentials: "",
            license_number: "", license_state: "", npi: "", tax_id: "",
            specialties: "", bio: "", phone: "", email: "", website: "",
            address_line1: "", address_line2: "", address_city: "",
            address_state: "", address_zip: "", cash_only: false, booking_enabled: true, accepted_insurances: [],
            session_rate: "", intake_rate: "", sliding_scale: false,
            sliding_scale_min: "", default_session_duration: "53",
            intake_duration: "53", timezone: "America/New_York",
          });
        }
      } catch {
        setError("Failed to load profile");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-red-600">{error || "Failed to load profile"}</p>
      </div>
    );
  }

  function set<K extends keyof FormData>(key: K, val: FormData[K]) {
    setForm((f) => f ? { ...f, [key]: val } : f);
    setSaved(false);
  }

  function toggleInsurance(name: string) {
    setForm((f) => {
      if (!f) return f;
      return {
        ...f,
        accepted_insurances: f.accepted_insurances.includes(name)
          ? f.accepted_insurances.filter((i) => i !== name)
          : [...f.accepted_insurances, name],
      };
    });
    setSaved(false);
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setError("");
    setSaved(false);
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
        booking_enabled: form.booking_enabled,
        accepted_insurances: form.cash_only
          ? []
          : form.accepted_insurances.length
            ? form.accepted_insurances
            : null,
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
      setSaved(true);
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-8 py-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold text-warm-800">Practice Profile</h1>
        <p className="text-warm-500 text-sm mt-1">
          Your practice information, credentials, and rates.
        </p>
        <div className="flex gap-4 mt-4 border-b border-warm-100 pb-px">
          <span className="text-sm font-medium text-teal-700 border-b-2 border-teal-600 pb-2 px-1">
            Profile
          </span>
          {practiceType === "group" && (
            <Link
              to="/settings/team"
              className="text-sm font-medium text-warm-400 hover:text-warm-600 pb-2 px-1 transition-colors"
            >
              Team
            </Link>
          )}
          <Link
            to="/settings/credentialing"
            className="text-sm font-medium text-warm-400 hover:text-warm-600 pb-2 px-1 transition-colors"
          >
            Credentialing
          </Link>
          <Link
            to="/settings/audit-log"
            className="text-sm font-medium text-warm-400 hover:text-warm-600 pb-2 px-1 transition-colors"
          >
            Audit Log
          </Link>
          <Link
            to="/setup-wizard"
            className="text-sm font-medium text-warm-400 hover:text-warm-600 pb-2 px-1 transition-colors ml-auto"
          >
            Setup New Instance
          </Link>
        </div>
      </div>

      {/* Google Account Connection */}
      {googleToast && (
        <div className="mb-4 px-4 py-3 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-800">
          {googleToast}
        </div>
      )}
      <div className="bg-white rounded-2xl border border-warm-100 shadow-sm mb-6">
        <div className="px-6 py-6">
          <h2 className="font-semibold text-warm-800 mb-1">Google Account</h2>
          <p className="text-warm-400 text-xs mb-4">
            Connect your Google account to send emails, create calendar events, and access Drive recordings from your own account.
          </p>
          {google.status === "loading" ? (
            <div className="flex items-center gap-2 text-sm text-warm-400">
              <div className="w-4 h-4 border-2 border-warm-200 border-t-warm-500 rounded-full animate-spin" />
              Checking connection...
            </div>
          ) : google.status === "connected" ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-teal-500" />
                <div>
                  <p className="text-sm font-medium text-warm-700">
                    Connected as {google.googleEmail}
                  </p>
                  {google.connectedAt && (
                    <p className="text-xs text-warm-400">
                      Since {new Date(google.connectedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={google.disconnect}
                className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div>
              <button
                onClick={google.connect}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-warm-200 rounded-xl text-sm font-medium text-warm-700 hover:border-warm-300 hover:bg-warm-50 transition-all"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Connect Google Account
              </button>
              {google.error && (
                <p className="mt-2 text-xs text-red-500">{google.error}</p>
              )}
              <p className="mt-2 text-xs text-warm-400">
                Permissions: Calendar, Gmail (send), Drive (recordings)
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-warm-100 shadow-sm divide-y divide-warm-100">
        {/* Practice Info */}
        <Section title="Practice Info">
          <div>
            <FieldLabel label="Practice Name" />
            <Input value={form.practice_name} onChange={(v) => set("practice_name", v)} disabled={!isOwner} />
          </div>
          <div>
            <FieldLabel label="Your Full Name" required />
            <Input value={form.clinician_name} onChange={(v) => set("clinician_name", v)} />
          </div>
          <div>
            <FieldLabel label="Specialties" />
            <Input
              value={form.specialties}
              onChange={(v) => set("specialties", v)}
              placeholder="Comma-separated"
            />
          </div>
          <div>
            <FieldLabel label="Bio" />
            <textarea
              value={form.bio}
              onChange={(e) => set("bio", e.target.value)}
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl border border-warm-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-warm-800 resize-none"
            />
          </div>
        </Section>

        {/* Credentials */}
        <Section title="Credentials">
          <div>
            <FieldLabel label="Credentials" />
            <Input value={form.credentials} onChange={(v) => set("credentials", v)} placeholder="e.g. LCSW, LPC" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel label="License Number" />
              <Input value={form.license_number} onChange={(v) => set("license_number", v)} />
            </div>
            <div>
              <FieldLabel label="License State" />
              <select
                value={form.license_state}
                onChange={(e) => set("license_state", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-warm-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-warm-800 bg-white"
              >
                <option value="">Select</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel label="NPI Number" />
              <Input value={form.npi} onChange={(v) => set("npi", v)} maxLength={10} />
            </div>
            <div>
              <FieldLabel label="Tax ID / EIN" />
              <Input value={form.tax_id} onChange={(v) => set("tax_id", v)} />
            </div>
          </div>
        </Section>

        {/* Contact & Address */}
        <Section title="Contact & Address">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel label="Phone" />
              <Input value={form.phone} onChange={(v) => set("phone", v)} type="tel" disabled={!isOwner} />
            </div>
            <div>
              <FieldLabel label="Email" />
              <Input value={form.email} onChange={(v) => set("email", v)} type="email" disabled={!isOwner} />
            </div>
          </div>
          <div>
            <FieldLabel label="Website" />
            <Input value={form.website} onChange={(v) => set("website", v)} disabled={!isOwner} />
          </div>
          <div>
            <FieldLabel label="Address Line 1" />
            <Input value={form.address_line1} onChange={(v) => set("address_line1", v)} disabled={!isOwner} />
          </div>
          <div>
            <FieldLabel label="Address Line 2" />
            <Input value={form.address_line2} onChange={(v) => set("address_line2", v)} disabled={!isOwner} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <FieldLabel label="City" />
              <Input value={form.address_city} onChange={(v) => set("address_city", v)} disabled={!isOwner} />
            </div>
            <div>
              <FieldLabel label="State" />
              <select
                value={form.address_state}
                onChange={(e) => set("address_state", e.target.value)}
                disabled={!isOwner}
                className="w-full px-4 py-2.5 rounded-xl border border-warm-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-warm-800 bg-white disabled:bg-warm-50 disabled:text-warm-400 disabled:cursor-not-allowed"
              >
                <option value="">State</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel label="ZIP" />
              <Input value={form.address_zip} onChange={(v) => set("address_zip", v)} maxLength={10} disabled={!isOwner} />
            </div>
          </div>
          <div>
            <FieldLabel label="Timezone" />
            <select
              value={form.timezone}
              onChange={(e) => set("timezone", e.target.value)}
              disabled={!isOwner}
              className="w-full px-4 py-2.5 rounded-xl border border-warm-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-warm-800 bg-white disabled:bg-warm-50 disabled:text-warm-400 disabled:cursor-not-allowed"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace("America/", "").replace("Pacific/", "").replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
        </Section>

        {/* Billing & Rates (owner/solo only) */}
        {(practiceType === "solo" || isOwner) && <Section title="Billing & Rates">
          <label className="flex items-center gap-3 cursor-pointer p-3 bg-warm-50 rounded-lg border border-warm-200">
            <input
              type="checkbox"
              checked={form.cash_only}
              onChange={(e) => set("cash_only", e.target.checked)}
              className="w-4 h-4 rounded border-warm-300 text-teal-600 focus:ring-teal-500"
            />
            <div>
              <span className="text-sm font-medium text-warm-800">Cash-only practice</span>
              <p className="text-xs text-warm-500 mt-0.5">Hides insurance billing, credentialing, and claims throughout the app</p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer p-3 bg-warm-50 rounded-lg border border-warm-200">
            <input
              type="checkbox"
              checked={form.booking_enabled}
              onChange={(e) => set("booking_enabled", e.target.checked)}
              className="w-4 h-4 rounded border-warm-300 text-teal-600 focus:ring-teal-500"
            />
            <div>
              <span className="text-sm font-medium text-warm-800">Allow client booking</span>
              <p className="text-xs text-warm-500 mt-0.5">When disabled, clients cannot book appointments from their portal</p>
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
              <Input value={form.session_rate} onChange={(v) => set("session_rate", v)} type="number" min="0" />
            </div>
            <div>
              <FieldLabel label="Intake Rate ($)" />
              <Input value={form.intake_rate} onChange={(v) => set("intake_rate", v)} type="number" min="0" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel label="Session Duration (min)" />
              <Input value={form.default_session_duration} onChange={(v) => set("default_session_duration", v)} type="number" />
            </div>
            <div>
              <FieldLabel label="Intake Duration (min)" />
              <Input value={form.intake_duration} onChange={(v) => set("intake_duration", v)} type="number" />
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
              <span className="text-sm text-warm-700">Offer sliding scale fees</span>
            </label>
            {form.sliding_scale && (
              <div className="pl-7">
                <FieldLabel label="Minimum sliding scale rate ($)" />
                <Input value={form.sliding_scale_min} onChange={(v) => set("sliding_scale_min", v)} type="number" min="0" />
              </div>
            )}
          </div>
        </Section>}
      </div>

      {/* Save bar */}
      <div className="mt-6 flex items-center gap-4">
        <Button onClick={handleSave} disabled={saving || !form.clinician_name.trim()}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
        {saved && (
          <span className="text-sm text-teal-600 font-medium">Saved successfully</span>
        )}
        {error && (
          <span className="text-sm text-red-600">{error}</span>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-6 py-6">
      <h2 className="font-semibold text-warm-800 mb-5">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
