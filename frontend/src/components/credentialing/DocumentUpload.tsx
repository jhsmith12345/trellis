import { useState, useRef } from "react";
import { useApi } from "../../hooks/useApi";

const DOC_TYPES = [
  { value: "malpractice_cert", label: "Malpractice Certificate" },
  { value: "license", label: "Professional License" },
  { value: "w9", label: "W-9 Form" },
  { value: "caqh_attestation", label: "CAQH Attestation" },
  { value: "dea_certificate", label: "DEA Certificate" },
  { value: "board_certification", label: "Board Certification" },
  { value: "cv_resume", label: "CV / Resume" },
  { value: "proof_of_insurance", label: "Proof of Insurance" },
  { value: "diploma", label: "Diploma" },
  { value: "application_form", label: "Application Form" },
  { value: "other", label: "Other" },
];

interface Props {
  payerId?: string;
  onClose: () => void;
  onUploaded: () => void;
}

export function DocumentUpload({ payerId, onClose, onUploaded }: Props) {
  const api = useApi();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("license");
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  function handleFileSelect(f: File) {
    const maxSize = 5 * 1024 * 1024;
    if (f.size > maxSize) {
      alert("File too large. Maximum 5MB.");
      return;
    }
    setFile(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setExtracting(true);

    try {
      const b64 = await fileToBase64(file);
      await api.post("/api/credentialing/documents", {
        document_type: docType,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        file_b64: b64,
        payer_id: payerId || null,
        notes: notes || null,
      });
      onUploaded();
    } catch (err) {
      console.error("Upload failed:", err);
      alert("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      setExtracting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl border border-warm-100 p-6 w-full max-w-md">
        <h3 className="font-display text-lg font-semibold text-warm-800 mb-1">
          Upload Credential Document
        </h3>
        <p className="text-xs text-warm-400 mb-5">
          AI will automatically extract key fields like expiration dates, license numbers, and more.
        </p>

        {/* Document type */}
        <label className="block text-xs font-medium text-warm-500 mb-1.5">Document Type</label>
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
          className="w-full text-sm border border-warm-200 rounded-lg px-3 py-2.5 text-warm-700 mb-4 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
        >
          {DOC_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        {/* File drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors mb-4 ${
            dragOver
              ? "border-teal-400 bg-teal-50/50"
              : file
                ? "border-teal-300 bg-teal-50/30"
                : "border-warm-200 hover:border-warm-300"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="image/*,application/pdf"
            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          />
          {file ? (
            <div className="flex items-center gap-3 justify-center">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-teal-500">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div className="text-left">
                <p className="text-sm font-medium text-warm-700">{file.name}</p>
                <p className="text-xs text-warm-400">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
            </div>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-warm-300 mx-auto mb-2">
                <path d="M7 10V8a5 5 0 0110 0v2m-8 4h6m-8 0a2 2 0 01-2-2V9a2 2 0 012-2h12a2 2 0 012 2v3a2 2 0 01-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M12 16v4m0 0l-2-2m2 2l2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-sm text-warm-500">Drop file here or click to browse</p>
              <p className="text-xs text-warm-400 mt-1">PDF, JPEG, or PNG up to 5MB</p>
            </>
          )}
        </div>

        {/* Notes */}
        <label className="block text-xs font-medium text-warm-500 mb-1.5">Notes (optional)</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any notes about this document"
          className="w-full px-3 py-2 border border-warm-200 rounded-lg text-sm text-warm-800 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 mb-5"
        />

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-warm-500 hover:text-warm-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {extracting ? (
              <span className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Extracting...
              </span>
            ) : uploading ? (
              "Uploading..."
            ) : (
              "Upload & Extract"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}


function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
