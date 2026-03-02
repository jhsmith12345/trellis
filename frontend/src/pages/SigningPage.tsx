import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { API_BASE } from "../lib/api-config";
import { SigningAuthGate } from "../components/signing/SigningAuthGate";
import { DocumentProgress } from "../components/signing/DocumentProgress";
import { DocumentViewer } from "../components/signing/DocumentViewer";
import { SignatureCanvas } from "../components/signing/SignatureCanvas";
import { SignatureConfirm } from "../components/signing/SignatureConfirm";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { Button } from "../components/Button";
import type { PracticeInfo } from "../templates";

interface Document {
  id: string;
  template_key: string;
  title: string;
  content: Record<string, any>;
  status: "pending" | "signed";
  signature_data: string | null;
  content_hash: string | null;
  signed_at: string | null;
  sort_order: number;
}

interface Package {
  id: string;
  client_name: string;
  client_email: string;
  status: string;
  documents: Document[];
}

function SigningFlow() {
  const { packageId } = useParams<{ packageId: string }>();
  const { getIdToken } = useAuth();

  const [pkg, setPkg] = useState<Package | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [signing, setSigning] = useState(false);
  const [storedSignature, setStoredSignature] = useState<string | null>(null);
  const [useCanvas, setUseCanvas] = useState(false);
  const [practice, setPractice] = useState<PracticeInfo | null>(null);

  const fetchPackage = useCallback(async () => {
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE}/api/documents/packages/${packageId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load documents");
      const data = await res.json();
      setPkg(data);

      // Advance to first unsigned doc
      const firstUnsigned = data.documents.findIndex(
        (d: Document) => d.status === "pending"
      );
      if (firstUnsigned >= 0) setCurrentIndex(firstUnsigned);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [packageId, getIdToken]);

  const fetchStoredSignature = useCallback(async () => {
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE}/api/documents/signature`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.signature_png) setStoredSignature(data.signature_png);
      }
    } catch {
      // Non-critical
    }
  }, [getIdToken]);

  const fetchPracticeProfile = useCallback(async () => {
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE}/api/practice-profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.exists) {
          setPractice({
            practice_name: data.practice_name || "Practice",
            clinician_name: data.clinician_name || "Provider",
            phone: data.phone,
            email: data.email,
            address_line1: data.address_line1,
            address_line2: data.address_line2,
            address_city: data.address_city,
            address_state: data.address_state,
            address_zip: data.address_zip,
          });
        }
      }
    } catch {
      // Non-critical — templates will use fallback names
    }
  }, [getIdToken]);

  useEffect(() => {
    fetchPackage();
    fetchStoredSignature();
    fetchPracticeProfile();
  }, [fetchPackage, fetchStoredSignature, fetchPracticeProfile]);

  async function handleSign(signatureDataUrl: string) {
    if (!pkg) return;
    const doc = pkg.documents[currentIndex];
    if (!doc || doc.status === "signed") return;

    setSigning(true);
    try {
      const token = await getIdToken();

      // Store signature for reuse if this is the first one
      if (!storedSignature) {
        await fetch(`${API_BASE}/api/documents/signature`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ signature_png: signatureDataUrl }),
        });
        setStoredSignature(signatureDataUrl);
      }

      // Sign the document
      const res = await fetch(`${API_BASE}/api/documents/${doc.id}/sign`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          signature_data: signatureDataUrl,
          content: doc.content,
        }),
      });

      if (!res.ok) throw new Error("Failed to sign document");

      const result = await res.json();

      // Update local state
      const updated = { ...pkg };
      updated.documents = [...pkg.documents];
      updated.documents[currentIndex] = {
        ...doc,
        status: "signed",
        signature_data: signatureDataUrl,
      };

      if (result.package_complete) {
        updated.status = "completed";
      }

      setPkg(updated);
      setUseCanvas(false);

      // Move to next unsigned doc
      if (!result.package_complete) {
        const nextUnsigned = updated.documents.findIndex(
          (d, i) => i > currentIndex && d.status === "pending"
        );
        if (nextUnsigned >= 0) {
          setCurrentIndex(nextUnsigned);
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSigning(false);
    }
  }

  if (loading) return <LoadingSpinner />;
  if (error) {
    return (
      <div className="min-h-screen bg-warm-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-600 mb-2">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }
  if (!pkg) return null;

  // All signed
  if (pkg.status === "completed" || pkg.documents.every((d) => d.status === "signed")) {
    return (
      <div className="min-h-screen bg-warm-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-6 bg-teal-100 rounded-full flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-teal-600">
              <path
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="font-display text-3xl font-bold text-warm-800 mb-2">
            All Documents Signed
          </h1>
          <p className="text-warm-500 mb-6">
            Thank you, {pkg.client_name}. All {pkg.documents.length} documents
            have been signed successfully. Your care team has been notified.
          </p>
          <p className="text-sm text-warm-400">
            You may close this window.
          </p>
        </div>
      </div>
    );
  }

  const currentDoc = pkg.documents[currentIndex]!;
  if (!currentDoc) return null;
  const isCurrentSigned = currentDoc.status === "signed";
  const signedCount = pkg.documents.filter((d) => d.status === "signed").length;

  // Resolve display date in content
  const displayContent = {
    ...currentDoc.content,
    date:
      currentDoc.content.date === "{{signing_date}}"
        ? new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : currentDoc.content.date,
  };

  return (
    <div className="min-h-screen bg-warm-50">
      {/* Header */}
      <header className="bg-white border-b border-warm-200 px-4 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-bold text-warm-800">
              Document Signing
            </h1>
            <p className="text-sm text-warm-500">
              {signedCount} of {pkg.documents.length} documents signed
            </p>
          </div>
          <div className="text-sm text-warm-500">{pkg.client_name}</div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar: progress */}
          <aside className="lg:w-72 flex-shrink-0">
            <div className="bg-white rounded-2xl shadow-sm border border-warm-200 p-4 lg:sticky lg:top-8">
              <h2 className="text-sm font-semibold text-warm-600 uppercase tracking-wide px-4 mb-3">
                Documents
              </h2>
              <DocumentProgress
                documents={pkg.documents}
                currentIndex={currentIndex}
                onSelect={setCurrentIndex}
              />
            </div>
          </aside>

          {/* Main: document + signature */}
          <main className="flex-1 min-w-0 space-y-6">
            <DocumentViewer
              templateKey={currentDoc.template_key}
              content={displayContent}
              practice={practice}
            />

            {/* Signature area */}
            {isCurrentSigned ? (
              <div className="bg-teal-50 border border-teal-200 rounded-2xl p-6 text-center">
                <p className="text-teal-700 font-medium">
                  This document has been signed
                </p>
                {currentDoc.signature_data && (
                  <img
                    src={currentDoc.signature_data}
                    alt="Signature"
                    className="mx-auto mt-3 max-h-20 object-contain"
                  />
                )}
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-warm-200 p-6">
                <h3 className="text-lg font-semibold text-warm-800 mb-4">
                  Your Signature
                </h3>
                {storedSignature && !useCanvas ? (
                  <SignatureConfirm
                    signaturePng={storedSignature}
                    onConfirm={() => handleSign(storedSignature)}
                    onDrawNew={() => setUseCanvas(true)}
                    disabled={signing}
                  />
                ) : (
                  <SignatureCanvas onSign={handleSign} disabled={signing} />
                )}
                {signing && (
                  <p className="text-sm text-warm-500 mt-3 text-center">
                    Signing...
                  </p>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default function SigningPage() {
  return (
    <SigningAuthGate>
      <SigningFlow />
    </SigningAuthGate>
  );
}
