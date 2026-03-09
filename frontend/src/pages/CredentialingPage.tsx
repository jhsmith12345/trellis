import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";
import { PayerList } from "../components/credentialing/PayerList";
import { PayerDetail } from "../components/credentialing/PayerDetail";
import { DocumentLibrary } from "../components/credentialing/DocumentLibrary";
import { CAQHGenerator } from "../components/credentialing/CAQHGenerator";

export interface CredentialingPayer {
  id: string;
  practice_id: string;
  clinician_id: string;
  payer_name: string;
  payer_id: string | null;
  status: string;
  provider_relations_phone: string | null;
  provider_relations_email: string | null;
  provider_relations_fax: string | null;
  portal_url: string | null;
  application_submitted_at: string | null;
  credentialed_at: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  denied_at: string | null;
  denial_reason: string | null;
  recredential_reminder_days: number;
  required_documents: Array<{ name: string; required: boolean; uploaded: boolean }>;
  contracted_rates: Record<string, number> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  timeline?: TimelineEvent[];
  documents?: CredentialingDocument[];
}

export interface CredentialingDocument {
  id: string;
  payer_id: string | null;
  practice_id: string;
  clinician_id: string;
  document_type: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  extracted_data: Record<string, unknown>;
  expiration_date: string | null;
  issue_date: string | null;
  issuing_authority: string | null;
  document_number: string | null;
  verified: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimelineEvent {
  id: string;
  payer_id: string;
  event_type: string;
  description: string;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

type Tab = "payers" | "documents" | "caqh";

export default function CredentialingPage() {
  const api = useApi();
  const { practiceType } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("payers");
  const [payers, setPayers] = useState<CredentialingPayer[]>([]);
  const [selectedPayerId, setSelectedPayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const loadPayers = useCallback(async () => {
    try {
      const url = statusFilter
        ? `/api/credentialing/payers?status=${statusFilter}`
        : "/api/credentialing/payers";
      const data = await api.get<{ payers: CredentialingPayer[]; count: number }>(url);
      setPayers(data.payers);
    } catch (e) {
      console.error("Failed to load payers:", e);
    } finally {
      setLoading(false);
    }
  }, [api, statusFilter]);

  useEffect(() => {
    loadPayers();
  }, [loadPayers]);

  const handleBack = useCallback(() => {
    setSelectedPayerId(null);
    loadPayers();
  }, [loadPayers]);

  // If viewing a specific payer detail
  if (selectedPayerId) {
    return (
      <PayerDetail
        payerId={selectedPayerId}
        onBack={handleBack}
        practiceType={practiceType}
      />
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "payers", label: "Payer Enrollments" },
    { key: "documents", label: "Document Library" },
    { key: "caqh", label: "CAQH Profile" },
  ];

  return (
    <div className="px-8 py-8 max-w-5xl">
      {/* Header with settings tabs */}
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold text-warm-800">
          Insurance Credentialing
        </h1>
        <p className="text-warm-500 text-sm mt-1">
          Track payer enrollments, manage credential documents, and monitor application status.
        </p>

        {/* Settings-level tabs */}
        <div className="flex gap-4 mt-4 border-b border-warm-100 pb-px">
          <Link
            to="/settings/practice"
            className="text-sm font-medium text-warm-400 hover:text-warm-600 pb-2 px-1 transition-colors"
          >
            Profile
          </Link>
          {practiceType === "group" && (
            <Link
              to="/settings/team"
              className="text-sm font-medium text-warm-400 hover:text-warm-600 pb-2 px-1 transition-colors"
            >
              Team
            </Link>
          )}
          <span className="text-sm font-medium text-teal-700 border-b-2 border-teal-600 pb-2 px-1">
            Credentialing
          </span>
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

      {/* Feature tabs */}
      <div className="flex gap-1 bg-warm-100/60 rounded-xl p-1 mb-6 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? "bg-white text-warm-800 shadow-sm"
                : "text-warm-500 hover:text-warm-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "payers" && (
        <PayerList
          payers={payers}
          loading={loading}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          onSelectPayer={setSelectedPayerId}
          onRefresh={loadPayers}
        />
      )}

      {activeTab === "documents" && (
        <DocumentLibrary payers={payers} onRefresh={loadPayers} />
      )}

      {activeTab === "caqh" && <CAQHGenerator />}
    </div>
  );
}
