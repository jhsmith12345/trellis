import { useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";

// -- Types --

interface WizardConfig {
  projectId: string;
  region: string;
}

interface FieldError {
  field: string;
  message: string;
}

const TOTAL_STEPS = 2;

const REGIONS = [
  { value: "us-central1", label: "us-central1 (Iowa)" },
  { value: "us-east1", label: "us-east1 (South Carolina)" },
  { value: "us-east4", label: "us-east4 (Virginia)" },
  { value: "us-west1", label: "us-west1 (Oregon)" },
  { value: "us-west2", label: "us-west2 (Los Angeles)" },
];

const STEP_NAMES = ["Welcome", "GCP Project"];

// -- Reusable sub-components --

function InfoBox({
  variant,
  title,
  children,
}: {
  variant: "info" | "warning" | "success";
  title: string;
  children: React.ReactNode;
}) {
  const styles = {
    info: "bg-blue-50 border-blue-200 text-blue-900",
    warning: "bg-amber-50 border-amber-200 text-amber-900",
    success: "bg-green-50 border-green-200 text-green-900",
  };

  return (
    <div className={`p-4 rounded-lg border text-sm leading-relaxed my-4 ${styles[variant]}`}>
      <strong className="block mb-1">{title}</strong>
      {children}
    </div>
  );
}

function FormField({
  label,
  helpText,
  error,
  children,
}: {
  label: string;
  helpText?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <label className="block text-sm font-medium text-warm-800 mb-1.5">
        {label}
      </label>
      {children}
      {helpText && !error && (
        <p className="text-xs text-warm-500 mt-1">{helpText}</p>
      )}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function WizardInput({
  value,
  onChange,
  error,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  value: string;
  onChange: (val: string) => void;
  error?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full px-3.5 py-2.5 rounded-lg border text-sm text-warm-800 bg-white transition-all outline-none focus:ring-2 focus:ring-teal-500/20 ${
        error
          ? "border-red-400 focus:border-red-500"
          : "border-warm-200 focus:border-teal-500"
      }`}
      {...props}
    />
  );
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-teal-700 font-medium border-b border-dashed border-teal-300 hover:text-teal-900 hover:border-solid transition-colors"
    >
      {children}
    </a>
  );
}

function InstructionList({ children }: { children: React.ReactNode }) {
  return (
    <ol className="my-4 space-y-0 list-none counter-reset-step">
      {children}
    </ol>
  );
}

function InstructionItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative pl-10 py-3 border-b border-warm-100 last:border-b-0 leading-relaxed text-sm instruction-item">
      {children}
    </li>
  );
}

// -- Step Components --

function StepWelcome() {
  return (
    <>
      <h2 className="font-display text-2xl font-bold text-warm-800 mb-2">
        Welcome to Trellis
      </h2>
      <p className="text-warm-500 text-[0.95rem] mb-6 leading-relaxed">
        This wizard will guide you through setting up Trellis in your own Google Cloud
        project and Google Workspace. Full setup instructions are in CLAUDE.md.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-6">
        {[
          {
            title: "Your Data, Your Control",
            desc: "Everything runs in your own GCP project. Patient data never leaves your infrastructure.",
          },
          {
            title: "HIPAA Compliant",
            desc: "Google Cloud BAA, encrypted at rest, audit logging, session timeouts, and more.",
          },
          {
            title: "AI-Powered Workflow",
            desc: "Voice intake, auto-transcription, AI note generation, and billing document creation.",
          },
          {
            title: "Google Workspace Integration",
            desc: "Calendar, Meet, Gmail, and Drive work together for a seamless experience.",
          },
        ].map((f) => (
          <div
            key={f.title}
            className="p-4 border border-warm-100 rounded-lg bg-warm-50"
          >
            <h4 className="text-sm font-semibold text-teal-700 mb-1">
              {f.title}
            </h4>
            <p className="text-xs text-warm-500 leading-snug">{f.desc}</p>
          </div>
        ))}
      </div>

      <InfoBox variant="info" title="What you will need:">
        <ul className="mt-2 ml-5 list-disc space-y-1">
          <li>A Google Workspace account (Business Standard or higher for Meet recording)</li>
          <li>A Google Cloud account with billing enabled</li>
          <li>A custom domain (for your practice's Trellis URL)</li>
          <li>About 30 minutes to complete the setup</li>
        </ul>
      </InfoBox>

      <InfoBox variant="warning" title="HIPAA Requirement">
        You must sign Google's Business Associate Agreement (BAA) as part of this setup.
        Google Workspace Business Standard or higher is required.
      </InfoBox>
    </>
  );
}

function StepGcpProject({
  config,
  setConfig,
  errors,
}: {
  config: WizardConfig;
  setConfig: React.Dispatch<React.SetStateAction<WizardConfig>>;
  errors: FieldError[];
}) {
  const fieldErr = (f: string) => errors.find((e) => e.field === f)?.message;

  return (
    <>
      <h2 className="font-display text-2xl font-bold text-warm-800 mb-2">
        Create a GCP Project
      </h2>
      <p className="text-warm-500 text-[0.95rem] mb-6 leading-relaxed">
        Create a new Google Cloud project dedicated to your Trellis installation.
        This keeps your practice data isolated in its own project.
      </p>

      <InstructionList>
        <InstructionItem>
          Go to the{" "}
          <ExternalLink href="https://console.cloud.google.com/projectcreate">
            Google Cloud Console &rarr; Create Project
          </ExternalLink>
        </InstructionItem>
        <InstructionItem>
          Enter a project name (e.g., <strong>trellis-yourpractice</strong>). Note the{" "}
          <strong>Project ID</strong> shown below the name field.
        </InstructionItem>
        <InstructionItem>
          Select your organization (your Google Workspace domain) as the parent.
        </InstructionItem>
        <InstructionItem>
          Click <strong>Create</strong> and wait for the project to be ready.
        </InstructionItem>
        <InstructionItem>
          Ensure billing is enabled:{" "}
          <ExternalLink href="https://console.cloud.google.com/billing">
            Billing Console
          </ExternalLink>
          {" "}&mdash; link a billing account to your new project.
        </InstructionItem>
      </InstructionList>

      <FormField
        label="GCP Project ID"
        helpText="The Project ID (not name). Lowercase letters, numbers, and hyphens. 6-30 characters."
        error={fieldErr("projectId")}
      >
        <WizardInput
          value={config.projectId}
          onChange={(v) => setConfig((c) => ({ ...c, projectId: v.trim() }))}
          placeholder="e.g., trellis-yourpractice"
          error={!!fieldErr("projectId")}
        />
      </FormField>

      <FormField
        label="Preferred Region"
        helpText="Choose a region close to your practice for best performance."
      >
        <select
          value={config.region}
          onChange={(e) =>
            setConfig((c) => ({ ...c, region: e.target.value }))
          }
          className="w-full px-3.5 py-2.5 rounded-lg border border-warm-200 text-sm text-warm-800 bg-white transition-all outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
        >
          {REGIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </FormField>

      <InfoBox variant="success" title="Next steps">
        After entering your project details, follow the full setup guide in{" "}
        <strong>CLAUDE.md</strong> to complete deployment. Open the repo in Claude Code
        and say "Set up Trellis" to get started.
      </InfoBox>
    </>
  );
}

// -- Validation Functions --

function validateStep(step: number, config: WizardConfig): FieldError[] {
  const errors: FieldError[] = [];

  switch (step) {
    case 0: // Welcome
      break;

    case 1: {
      // GCP Project
      const id = config.projectId;
      if (!id) {
        errors.push({ field: "projectId", message: "Project ID is required" });
      } else if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(id)) {
        errors.push({
          field: "projectId",
          message:
            "Must be 6-30 characters: lowercase letters, numbers, hyphens. Must start with a letter.",
        });
      }
      break;
    }
  }

  return errors;
}

// -- Main Wizard Component --

export default function SetupWizardPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);

  const [config, setConfig] = useState<WizardConfig>({
    projectId: "",
    region: "us-central1",
  });

  const nextStep = useCallback(() => {
    const validationErrors = validateStep(currentStep, config);
    setErrors(validationErrors);
    if (validationErrors.length > 0) return;

    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep((s) => s + 1);
      setErrors([]);
      window.scrollTo(0, 0);
    }
  }, [currentStep, config]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
      setErrors([]);
      window.scrollTo(0, 0);
    }
  }, [currentStep]);

  const progressPct = (currentStep / (TOTAL_STEPS - 1)) * 100;

  return (
    <div className="min-h-screen bg-warm-50 flex items-start justify-center px-4 py-8">
      {/* Custom CSS for instruction list counters */}
      <style>{`
        .counter-reset-step { counter-reset: step; }
        .instruction-item { counter-increment: step; }
        .instruction-item::before {
          content: counter(step);
          position: absolute;
          left: 0;
          top: 0.75rem;
          width: 1.5rem;
          height: 1.5rem;
          background: #e8ece8;
          color: #3d5a4a;
          border-radius: 50%;
          font-size: 0.75rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
        }
      `}</style>

      <div className="w-full max-w-[720px] bg-white rounded-2xl shadow-sm border border-warm-100 overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-warm-100">
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <svg viewBox="0 0 32 32" width="32" height="32" fill="none">
              <rect width="32" height="32" rx="8" fill="#4f6d5e" />
              <path
                d="M8 12h16M12 8v16M20 8v16"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span className="font-display text-xl font-bold text-warm-800">
              Trellis
            </span>
          </Link>
          <span className="text-sm text-warm-500 font-medium">
            Setup Wizard
          </span>
        </header>

        {/* Progress bar */}
        <div className="h-1 bg-warm-100">
          <div
            className="h-full bg-teal-700 transition-all duration-300 ease-out rounded-r-sm"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Step dots */}
        <div className="flex justify-center gap-2 pt-4 px-6">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                i === currentStep
                  ? "bg-teal-700 scale-125"
                  : i < currentStep
                    ? "bg-teal-500"
                    : "bg-warm-200"
              }`}
              title={STEP_NAMES[i]}
            />
          ))}
        </div>

        {/* Step content */}
        <div ref={contentRef} className="px-6 py-8 min-h-[400px]">
          {currentStep === 0 && <StepWelcome />}
          {currentStep === 1 && (
            <StepGcpProject
              config={config}
              setConfig={setConfig}
              errors={errors}
            />
          )}
        </div>

        {/* Footer navigation */}
        <footer className="flex items-center justify-between px-6 py-4 border-t border-warm-100 bg-warm-50">
          {currentStep > 0 ? (
            <button
              onClick={prevStep}
              className="px-5 py-2.5 text-sm font-medium text-warm-600 bg-white border border-warm-200 rounded-lg hover:bg-warm-50 hover:border-warm-300 transition-all"
            >
              Back
            </button>
          ) : (
            <div />
          )}

          <span className="text-[0.8125rem] text-warm-500">
            Step {currentStep + 1} of {TOTAL_STEPS}
          </span>

          {currentStep < TOTAL_STEPS - 1 ? (
            <button
              onClick={nextStep}
              className="px-5 py-2.5 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition-all"
            >
              Continue
            </button>
          ) : (
            <div />
          )}
        </footer>
      </div>
    </div>
  );
}
