import { useState, useEffect, type FormEvent } from "react";
import { useAuth } from "../hooks/useAuth";
import { useClientApi } from "../hooks/useClientApi";
import { API_BASE } from "../lib/api-config";
import { Button } from "./Button";

interface IntakeData {
  name: string;
  preferredName: string;
  pronouns: string;
  sex: string;
  dateOfBirth: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  presentingConcerns: string;
  priorTherapy: string;
  priorTherapyDetails: string;
  medications: string;
  medicalConditions: string;
  goals: string;
  additionalNotes: string;
  insurancePayerName: string;
  insurancePayerId: string;
  insuranceMemberId: string;
  insuranceGroupNumber: string;
  secondaryPayerName: string;
  secondaryPayerId: string;
  secondaryMemberId: string;
  secondaryGroupNumber: string;
  defaultModality: string;
}

const empty: IntakeData = {
  name: "",
  preferredName: "",
  pronouns: "",
  sex: "",
  dateOfBirth: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
  presentingConcerns: "",
  priorTherapy: "no",
  priorTherapyDetails: "",
  medications: "",
  medicalConditions: "",
  goals: "",
  additionalNotes: "",
  insurancePayerName: "",
  insurancePayerId: "",
  insuranceMemberId: "",
  insuranceGroupNumber: "",
  secondaryPayerName: "",
  secondaryPayerId: "",
  secondaryMemberId: "",
  secondaryGroupNumber: "",
  defaultModality: "telehealth",
};

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-warm-600 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full px-4 py-2.5 rounded-xl border border-warm-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-warm-800 bg-white";

export function IntakeForm({ intakeMode: _intakeMode = "standard" }: { intakeMode?: "standard" | "iop" }) {
  const { getIdToken } = useAuth();
  const { getProfile } = useClientApi();
  const [data, setData] = useState<IntakeData>(empty);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  // Pre-fill from client profile if available
  useEffect(() => {
    getProfile()
      .then((profile) => {
        if (!profile.exists) return;
        setData((prev) => ({
          ...prev,
          name: profile.full_name || prev.name,
          preferredName: profile.preferred_name || prev.preferredName,
          pronouns: profile.pronouns || prev.pronouns,
          dateOfBirth: profile.date_of_birth || prev.dateOfBirth,
          emergencyContactName: profile.emergency_contact_name || prev.emergencyContactName,
          emergencyContactPhone: profile.emergency_contact_phone || prev.emergencyContactPhone,
          emergencyContactRelationship: profile.emergency_contact_relationship || prev.emergencyContactRelationship,
        }));
      })
      .catch(() => {
        // Best-effort — silently ignore errors
      });
  }, [getProfile]);

  function set<K extends keyof IntakeData>(key: K, value: IntakeData[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE}/api/intake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          demographics: {
            name: data.name,
            preferredName: data.preferredName || null,
            pronouns: data.pronouns || null,
            sex: data.sex || null,
            dateOfBirth: data.dateOfBirth,
            emergencyContact: {
              name: data.emergencyContactName || null,
              phone: data.emergencyContactPhone || null,
              relationship: data.emergencyContactRelationship || null,
            },
          },
          presentingConcerns: data.presentingConcerns || null,
          history: {
            priorTherapy: data.priorTherapy === "yes",
            priorTherapyDetails: data.priorTherapyDetails || null,
            medications: data.medications || null,
            medicalConditions: data.medicalConditions || null,
          },
          insurance: {
            payerName: data.insurancePayerName || null,
            payerId: data.insurancePayerId || null,
            memberId: data.insuranceMemberId || null,
            groupNumber: data.insuranceGroupNumber || null,
          },
          secondaryInsurance: {
            payerName: data.secondaryPayerName || null,
            payerId: data.secondaryPayerId || null,
            memberId: data.secondaryMemberId || null,
            groupNumber: data.secondaryGroupNumber || null,
          },
          defaultModality: data.defaultModality || null,
          goals: data.goals || null,
          additionalNotes: data.additionalNotes || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Submission failed");
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto px-6 py-16 text-center">
        <div className="w-20 h-20 mx-auto mb-6 bg-sage-50 rounded-full flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-sage-600">
            <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3 className="font-display text-xl font-bold text-warm-800 mb-2">
          Intake Submitted
        </h3>
        <p className="text-warm-500">
          Thank you, {data.preferredName || data.name}. Your care team will
          review your information and reach out soon.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-6 py-12">
      <h2 className="font-display text-2xl font-bold text-warm-800 mb-2">
        Intake Form
      </h2>
      <p className="text-warm-500 mb-10">
        All information is confidential. Fields marked with * are required.
      </p>

      {/* Personal info */}
      <fieldset className="mb-10">
        <legend className="text-lg font-semibold text-warm-700 mb-4 pb-2 border-b border-warm-100 w-full">
          Personal Information
        </legend>
        <div className="space-y-4">
          <Field label="Full Name" required>
            <input
              required
              value={data.name}
              onChange={(e) => set("name", e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Preferred Name">
              <input
                value={data.preferredName}
                onChange={(e) => set("preferredName", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Pronouns">
              <input
                value={data.pronouns}
                onChange={(e) => set("pronouns", e.target.value)}
                className={inputClass}
                placeholder="e.g. she/her, he/him, they/them"
              />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Sex (for insurance forms)">
              <select
                value={data.sex}
                onChange={(e) => set("sex", e.target.value)}
                className={inputClass}
              >
                <option value="">Select...</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="X">Non-binary</option>
                <option value="U">Prefer not to say</option>
              </select>
            </Field>
            <Field label="Date of Birth" required>
              <input
                type="date"
                required
                value={data.dateOfBirth}
                onChange={(e) => set("dateOfBirth", e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </fieldset>

      {/* Emergency contact */}
      <fieldset className="mb-10">
        <legend className="text-lg font-semibold text-warm-700 mb-4 pb-2 border-b border-warm-100 w-full">
          Emergency Contact
        </legend>
        <div className="space-y-4">
          <Field label="Contact Name">
            <input
              value={data.emergencyContactName}
              onChange={(e) => set("emergencyContactName", e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Phone Number">
              <input
                type="tel"
                value={data.emergencyContactPhone}
                onChange={(e) => set("emergencyContactPhone", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Relationship">
              <input
                value={data.emergencyContactRelationship}
                onChange={(e) =>
                  set("emergencyContactRelationship", e.target.value)
                }
                className={inputClass}
                placeholder="e.g. parent, spouse, sibling"
              />
            </Field>
          </div>
        </div>
      </fieldset>

      {/* Clinical */}
      <fieldset className="mb-10">
        <legend className="text-lg font-semibold text-warm-700 mb-4 pb-2 border-b border-warm-100 w-full">
          Clinical Information
        </legend>
        <div className="space-y-4">
          <Field label="What brings you to treatment?">
            <textarea
              rows={3}
              value={data.presentingConcerns}
              onChange={(e) => set("presentingConcerns", e.target.value)}
              className={inputClass}
              placeholder="Share as much or as little as you'd like"
            />
          </Field>
          <Field label="Have you attended therapy or treatment before?">
            <select
              value={data.priorTherapy}
              onChange={(e) => set("priorTherapy", e.target.value)}
              className={inputClass}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>
          {data.priorTherapy === "yes" && (
            <Field label="Tell us about your previous treatment">
              <textarea
                rows={2}
                value={data.priorTherapyDetails}
                onChange={(e) => set("priorTherapyDetails", e.target.value)}
                className={inputClass}
              />
            </Field>
          )}
          <Field label="Current Medications">
            <textarea
              rows={2}
              value={data.medications}
              onChange={(e) => set("medications", e.target.value)}
              className={inputClass}
              placeholder="List any current medications and dosages"
            />
          </Field>
          <Field label="Medical Conditions">
            <textarea
              rows={2}
              value={data.medicalConditions}
              onChange={(e) => set("medicalConditions", e.target.value)}
              className={inputClass}
              placeholder="Any relevant medical conditions"
            />
          </Field>
        </div>
      </fieldset>

      {/* Insurance */}
      <fieldset className="mb-10">
        <legend className="text-lg font-semibold text-warm-700 mb-4 pb-2 border-b border-warm-100 w-full">
          Insurance
        </legend>
        <div className="space-y-4">
          <Field label="Insurance Company">
            <input
              value={data.insurancePayerName}
              onChange={(e) => set("insurancePayerName", e.target.value)}
              className={inputClass}
              placeholder="e.g. Blue Cross Blue Shield, Aetna, or Self-pay"
            />
          </Field>
          {data.insurancePayerName && data.insurancePayerName.toLowerCase() !== "self-pay" && (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Member ID">
                  <input
                    value={data.insuranceMemberId}
                    onChange={(e) => set("insuranceMemberId", e.target.value)}
                    className={inputClass}
                    placeholder="From your insurance card"
                  />
                </Field>
                <Field label="Group Number">
                  <input
                    value={data.insuranceGroupNumber}
                    onChange={(e) => set("insuranceGroupNumber", e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field label="Payer ID (if known)">
                <input
                  value={data.insurancePayerId}
                  onChange={(e) => set("insurancePayerId", e.target.value)}
                  className={inputClass}
                  placeholder="Electronic payer ID (optional)"
                />
              </Field>
              <div className="mt-4 pt-4 border-t border-warm-100">
                <p className="text-sm font-medium text-warm-600 mb-3">Secondary Insurance (if applicable)</p>
                <div className="space-y-4">
                  <Field label="Secondary Insurance Company">
                    <input
                      value={data.secondaryPayerName}
                      onChange={(e) => set("secondaryPayerName", e.target.value)}
                      className={inputClass}
                    />
                  </Field>
                  {data.secondaryPayerName && (
                    <div className="grid sm:grid-cols-2 gap-4">
                      <Field label="Secondary Member ID">
                        <input
                          value={data.secondaryMemberId}
                          onChange={(e) => set("secondaryMemberId", e.target.value)}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Secondary Group Number">
                        <input
                          value={data.secondaryGroupNumber}
                          onChange={(e) => set("secondaryGroupNumber", e.target.value)}
                          className={inputClass}
                        />
                      </Field>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </fieldset>

      {/* Session Preferences */}
      <fieldset className="mb-10">
        <legend className="text-lg font-semibold text-warm-700 mb-4 pb-2 border-b border-warm-100 w-full">
          Session Preferences
        </legend>
        <div className="space-y-4">
          <Field label="Preferred Session Format">
            <select
              value={data.defaultModality}
              onChange={(e) => set("defaultModality", e.target.value)}
              className={inputClass}
            >
              <option value="telehealth">Telehealth (video)</option>
              <option value="in_office">In-office</option>
            </select>
          </Field>
        </div>
      </fieldset>

      {/* Goals */}
      <fieldset className="mb-10">
        <legend className="text-lg font-semibold text-warm-700 mb-4 pb-2 border-b border-warm-100 w-full">
          Goals & Additional Notes
        </legend>
        <div className="space-y-4">
          <Field label="What are your goals for treatment?">
            <textarea
              rows={3}
              value={data.goals}
              onChange={(e) => set("goals", e.target.value)}
              className={inputClass}
              placeholder="What does recovery look like for you?"
            />
          </Field>
          <Field label="Anything else you'd like us to know?">
            <textarea
              rows={3}
              value={data.additionalNotes}
              onChange={(e) => set("additionalNotes", e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </fieldset>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 rounded-xl p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <Button type="submit" disabled={submitting} size="lg" className="w-full">
        {submitting ? "Submitting..." : "Submit Intake"}
      </Button>
    </form>
  );
}
