import { useState, useRef, type ChangeEvent } from "react";
import { useClientApi } from "../hooks/useClientApi";
import { Button } from "./Button";
import type { InsuranceExtraction } from "../types";

type Stage = "idle" | "uploading" | "reviewing" | "saving" | "done";

interface Props {
  onComplete: () => void;
  onSkip: () => void;
}

const inputClass =
  "w-full px-4 py-2.5 rounded-xl border border-warm-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-warm-800 bg-white";

const FIELD_LABELS: Record<keyof InsuranceExtraction, string> = {
  payer_name: "Insurance Company",
  plan_name: "Plan Name",
  member_id: "Member ID",
  group_number: "Group Number",
  plan_type: "Plan Type",
  subscriber_name: "Subscriber Name",
  rx_bin: "Rx BIN",
  rx_pcn: "Rx PCN",
  rx_group: "Rx Group",
  payer_phone: "Member Services Phone",
  effective_date: "Effective Date",
  copay_info: "Copay Info",
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function InsuranceCardUpload({ onComplete, onSkip }: Props) {
  const { extractInsuranceCard, saveInsurance } = useClientApi();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState("");
  const [backPreview, setBackPreview] = useState("");
  const [extraction, setExtraction] = useState<InsuranceExtraction | null>(null);
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);

  function handleFile(
    e: ChangeEvent<HTMLInputElement>,
    side: "front" | "back",
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (side === "front") {
      setFrontFile(file);
      setFrontPreview(url);
    } else {
      setBackFile(file);
      setBackPreview(url);
    }
  }

  async function handleUpload() {
    if (!frontFile) return;
    setError("");
    setStage("uploading");

    try {
      const frontB64 = await fileToBase64(frontFile);
      let backB64: string | undefined;
      if (backFile) {
        backB64 = await fileToBase64(backFile);
      }

      const { extraction: data } = await extractInsuranceCard(
        frontB64,
        frontFile.type || "image/jpeg",
        backB64,
      );
      setExtraction(data);
      setStage("reviewing");
    } catch (err: any) {
      setError(err.message ?? "Extraction failed");
      setStage("idle");
    }
  }

  function updateField(key: keyof InsuranceExtraction, value: string) {
    if (!extraction) return;
    setExtraction({ ...extraction, [key]: value || null });
  }

  async function handleConfirm() {
    if (!extraction) return;
    setStage("saving");
    try {
      await saveInsurance(extraction);
      setStage("done");
      onComplete();
    } catch (err: any) {
      setError(err.message ?? "Failed to save");
      setStage("reviewing");
    }
  }

  function handleReupload() {
    setFrontFile(null);
    setBackFile(null);
    setFrontPreview("");
    setBackPreview("");
    setExtraction(null);
    setError("");
    setStage("idle");
    if (frontRef.current) frontRef.current.value = "";
    if (backRef.current) backRef.current.value = "";
  }

  // Uploading state
  if (stage === "uploading") {
    return (
      <div className="max-w-xl mx-auto px-6 py-16 text-center">
        <div className="w-16 h-16 mx-auto mb-6 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
        <h3 className="font-display text-xl font-bold text-warm-800 mb-2">
          Extracting Insurance Info
        </h3>
        <p className="text-warm-500">
          Our AI is reading your card. This usually takes a few seconds...
        </p>
      </div>
    );
  }

  // Review extracted data
  if ((stage === "reviewing" || stage === "saving") && extraction) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <h2 className="font-display text-2xl font-bold text-warm-800 mb-2">
          Verify Your Insurance Info
        </h2>
        <p className="text-warm-500 mb-8">
          We extracted the following from your card. Please review and correct
          any errors.
        </p>

        <div className="space-y-4 mb-8">
          {(Object.keys(FIELD_LABELS) as (keyof InsuranceExtraction)[]).map(
            (key) => (
              <label key={key} className="block">
                <span className="block text-sm font-medium text-warm-600 mb-1">
                  {FIELD_LABELS[key]}
                </span>
                <input
                  value={extraction[key] ?? ""}
                  onChange={(e) => updateField(key, e.target.value)}
                  className={inputClass}
                />
              </label>
            ),
          )}
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-100 rounded-xl p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="flex gap-3">
          <Button
            onClick={handleConfirm}
            disabled={stage === "saving"}
            size="lg"
            className="flex-1"
          >
            {stage === "saving" ? "Saving..." : "Confirm & Save"}
          </Button>
          <Button
            onClick={handleReupload}
            variant="secondary"
            size="lg"
          >
            Re-upload
          </Button>
        </div>
      </div>
    );
  }

  // Idle / error state — file inputs
  return (
    <div className="max-w-xl mx-auto px-6 py-12">
      <h2 className="font-display text-2xl font-bold text-warm-800 mb-2">
        Insurance Card
      </h2>
      <p className="text-warm-500 mb-8">
        Take a photo of your insurance card so we can speed up your paperwork.
        You can skip this and add it later.
      </p>

      {/* Front */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-warm-600 mb-2">
          Front of Card <span className="text-red-500">*</span>
        </label>
        {frontPreview ? (
          <div className="relative mb-2">
            <img
              src={frontPreview}
              alt="Front of insurance card"
              className="w-full rounded-xl border border-warm-200 object-contain max-h-48"
            />
            <button
              onClick={() => {
                setFrontFile(null);
                setFrontPreview("");
                if (frontRef.current) frontRef.current.value = "";
              }}
              className="absolute top-2 right-2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center text-warm-500 hover:text-warm-700 shadow"
            >
              x
            </button>
          </div>
        ) : (
          <div
            onClick={() => frontRef.current?.click()}
            className="border-2 border-dashed border-warm-200 rounded-xl p-8 text-center cursor-pointer hover:border-teal-400 hover:bg-teal-50/50 transition-colors"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="w-10 h-10 mx-auto mb-3 text-warm-300"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <p className="text-sm text-warm-500">
              Tap to take a photo or select an image
            </p>
          </div>
        )}
        <input
          ref={frontRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => handleFile(e, "front")}
          className="hidden"
        />
      </div>

      {/* Back */}
      <div className="mb-8">
        <label className="block text-sm font-medium text-warm-600 mb-2">
          Back of Card <span className="text-warm-400">(optional)</span>
        </label>
        {backPreview ? (
          <div className="relative mb-2">
            <img
              src={backPreview}
              alt="Back of insurance card"
              className="w-full rounded-xl border border-warm-200 object-contain max-h-48"
            />
            <button
              onClick={() => {
                setBackFile(null);
                setBackPreview("");
                if (backRef.current) backRef.current.value = "";
              }}
              className="absolute top-2 right-2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center text-warm-500 hover:text-warm-700 shadow"
            >
              x
            </button>
          </div>
        ) : (
          <div
            onClick={() => backRef.current?.click()}
            className="border-2 border-dashed border-warm-200 rounded-xl p-6 text-center cursor-pointer hover:border-teal-400 hover:bg-teal-50/50 transition-colors"
          >
            <p className="text-sm text-warm-400">
              Tap to add back of card
            </p>
          </div>
        )}
        <input
          ref={backRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => handleFile(e, "back")}
          className="hidden"
        />
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 rounded-xl p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          onClick={handleUpload}
          disabled={!frontFile}
          size="lg"
          className="flex-1"
        >
          Extract Info
        </Button>
        <Button onClick={onSkip} variant="secondary" size="lg">
          Skip for Now
        </Button>
      </div>
    </div>
  );
}
