import { useState, useEffect, useCallback } from "react";
import { useApi } from "../../hooks/useApi";
import { DocumentUpload } from "./DocumentUpload";
import type { CredentialingPayer, CredentialingDocument } from "../../pages/CredentialingPage";

const DOC_TYPE_LABELS: Record<string, string> = {
  malpractice_cert: "Malpractice Certificate",
  license: "Professional License",
  w9: "W-9 Form",
  caqh_attestation: "CAQH Attestation",
  dea_certificate: "DEA Certificate",
  board_certification: "Board Certification",
  cv_resume: "CV / Resume",
  proof_of_insurance: "Proof of Insurance",
  diploma: "Diploma",
  application_form: "Application Form",
  other: "Other",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

interface Props {
  payers: CredentialingPayer[];
  onRefresh: () => void;
}

export function DocumentLibrary({ payers, onRefresh }: Props) {
  const api = useApi();
  const [documents, setDocuments] = useState<CredentialingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      const url = typeFilter
        ? `/api/credentialing/documents?document_type=${typeFilter}`
        : "/api/credentialing/documents";
      const data = await api.get<{ documents: CredentialingDocument[]; count: number }>(url);
      setDocuments(data.documents);
    } catch (e) {
      console.error("Failed to load documents:", e);
    } finally {
      setLoading(false);
    }
  }, [api, typeFilter]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  async function handleDelete(docId: string) {
    if (!confirm("Delete this document?")) return;
    try {
      await api.del(`/api/credentialing/documents/${docId}`);
      loadDocuments();
    } catch (e) {
      console.error("Failed to delete:", e);
    }
  }

  async function handleDownload(doc: CredentialingDocument) {
    try {
      const blob = await api.getBlob(`/api/credentialing/documents/${doc.id}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed:", e);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  // Group by document type
  const grouped = documents.reduce<Record<string, CredentialingDocument[]>>((acc, doc) => {
    const key = doc.document_type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(doc);
    return acc;
  }, {});

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-sm border border-warm-200 rounded-lg px-3 py-2 text-warm-700 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
          >
            <option value="">All types</option>
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <span className="text-sm text-warm-400">{documents.length} document{documents.length !== 1 ? "s" : ""}</span>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors shadow-sm"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
          </svg>
          Upload Document
        </button>
      </div>

      {documents.length === 0 ? (
        <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-12 text-center">
          <div className="w-14 h-14 bg-warm-50 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-warm-300">
              <path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-warm-500 text-sm mb-4">No credential documents uploaded yet.</p>
          <button
            onClick={() => setShowUpload(true)}
            className="text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
          >
            Upload your first document
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([type, docs]) => (
            <div key={type}>
              <h3 className="text-xs font-medium text-warm-400 uppercase tracking-wider mb-3">
                {DOC_TYPE_LABELS[type] || type} ({docs.length})
              </h3>
              <div className="bg-white rounded-xl border border-warm-100 shadow-sm divide-y divide-warm-50">
                {docs.map((doc) => {
                  const linkedPayer = payers.find((p) => p.id === doc.payer_id);
                  const isExpiringSoon = doc.expiration_date && new Date(doc.expiration_date) < new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

                  return (
                    <div key={doc.id} className="flex items-center gap-4 p-4">
                      <div className="w-10 h-10 bg-warm-50 rounded-lg flex items-center justify-center shrink-0">
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4.5 h-4.5 text-warm-400">
                          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-warm-700 truncate">{doc.file_name}</p>
                        <div className="flex items-center gap-3 text-xs text-warm-400 mt-0.5">
                          {doc.document_number && <span>#{doc.document_number}</span>}
                          {doc.issuing_authority && <span>{doc.issuing_authority}</span>}
                          {linkedPayer && <span>Linked to {linkedPayer.payer_name}</span>}
                          <span>Uploaded {formatDate(doc.created_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {doc.expiration_date && (
                          <span className={`text-xs font-medium ${isExpiringSoon ? "text-amber-600" : "text-warm-400"}`}>
                            Exp {formatDate(doc.expiration_date)}
                          </span>
                        )}
                        {doc.verified && (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                              <path fillRule="evenodd" d="M8 16A8 8 0 108 0a8 8 0 000 16zm3.78-9.72a.75.75 0 00-1.06-1.06L7 8.94 5.28 7.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25z" />
                            </svg>
                            Verified
                          </span>
                        )}
                        <button
                          onClick={() => handleDownload(doc)}
                          className="p-1.5 text-warm-400 hover:text-teal-600 transition-colors"
                          title="Download"
                        >
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                            <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                            <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(doc.id)}
                          className="p-1.5 text-warm-400 hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                            <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 01.78.72l.5 6a.75.75 0 01-1.49.12l-.5-6a.75.75 0 01.71-.84zm2.84 0a.75.75 0 01.71.84l-.5 6a.75.75 0 11-1.49-.12l.5-6a.75.75 0 01.78-.72z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showUpload && (
        <DocumentUpload
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); loadDocuments(); onRefresh(); }}
        />
      )}
    </>
  );
}
