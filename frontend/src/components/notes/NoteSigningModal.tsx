/**
 * Modal for signing a clinical note.
 *
 * Displays stored signature for one-click signing, or allows drawing a new one.
 * Reuses the SignatureCanvas and SignatureConfirm patterns from consent doc signing.
 */
import { useState, useEffect } from "react";
import { useApi } from "../../hooks/useApi";
import { SignatureCanvas } from "../signing/SignatureCanvas";
import { SignatureConfirm } from "../signing/SignatureConfirm";

interface NoteSigningModalProps {
  noteId: string;
  noteFormat: string;
  onSigned: (result: {
    signed_by: string;
    signed_at: string;
    content_hash: string;
  }) => void;
  onCancel: () => void;
}

export function NoteSigningModal({
  noteId,
  noteFormat,
  onSigned,
  onCancel,
}: NoteSigningModalProps) {
  const api = useApi();
  const [storedSignature, setStoredSignature] = useState<string | null>(null);
  const [useStored, setUseStored] = useState(true);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Fetch stored signature
  useEffect(() => {
    async function load() {
      try {
        const data = await api.get<{ signature: string | null }>(
          "/api/notes/signing/signature"
        );
        setStoredSignature(data.signature);
      } catch {
        // No stored signature, that's fine
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api]);

  const handleSign = async (signatureData: string) => {
    setSigning(true);
    setError("");
    try {
      const result = await api.post<{
        status: string;
        note_id: string;
        signed_by: string;
        signed_at: string;
        content_hash: string;
        pdf_generated: boolean;
      }>(`/api/notes/${noteId}/sign`, { signature_data: signatureData });

      onSigned({
        signed_by: result.signed_by,
        signed_at: result.signed_at,
        content_hash: result.content_hash,
      });
    } catch (err: any) {
      setError(err.message || "Failed to sign note");
      setSigning(false);
    }
  };

  const formatLabel =
    noteFormat === "SOAP"
      ? "SOAP Progress Note"
      : noteFormat === "DAP"
        ? "DAP Progress Note"
        : noteFormat === "narrative"
          ? "Biopsychosocial Assessment"
          : noteFormat;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-warm-100">
          <h2 className="font-display text-lg font-bold text-warm-800">
            Sign Clinical Note
          </h2>
          <p className="text-sm text-warm-500 mt-1">
            Signing this {formatLabel} will lock it permanently. No further
            edits will be allowed after signing.
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {/* Warning */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5">
            <p className="text-sm text-amber-800">
              <strong>Important:</strong> Once signed, this note cannot be
              edited. If changes are needed after signing, you will need to
              create an amendment.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
            </div>
          ) : storedSignature && useStored ? (
            <SignatureConfirm
              signaturePng={storedSignature}
              onConfirm={() => handleSign(storedSignature)}
              onDrawNew={() => setUseStored(false)}
              disabled={signing}
            />
          ) : (
            <SignatureCanvas
              onSign={handleSign}
              disabled={signing}
            />
          )}

          {signing && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <div className="w-4 h-4 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
              <span className="text-sm text-warm-500">
                Signing note and generating PDF...
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-warm-100 flex justify-end">
          <button
            onClick={onCancel}
            disabled={signing}
            className="px-4 py-2 text-sm font-medium text-warm-600 hover:bg-warm-100 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
