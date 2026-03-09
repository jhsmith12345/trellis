import { useState } from "react";
import { useApi } from "../../hooks/useApi";

export function CAQHGenerator() {
  const api = useApi();
  const [sections, setSections] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    try {
      const data = await api.post<Record<string, string>>("/api/credentialing/generate-caqh", {});
      setSections(data);
      setGenerated(true);
    } catch (e) {
      console.error("Failed to generate CAQH profile:", e);
    } finally {
      setLoading(false);
    }
  }

  function copySection(key: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedSection(key);
    setTimeout(() => setCopiedSection(null), 2000);
  }

  const SECTION_LABELS: Record<string, string> = {
    practice_description: "Practice Description",
    specialty_narrative: "Specialty Narrative",
    education_training: "Education & Training",
    work_history: "Work History",
    professional_references_note: "Professional References",
    hospital_affiliations_note: "Hospital Affiliations",
    malpractice_history: "Malpractice History",
  };

  return (
    <div>
      {/* Intro */}
      <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-teal-600">
              <path fillRule="evenodd" d="M4.606 12.97a.75.75 0 01-.134 1.051 2.494 2.494 0 00-.93 2.437 2.494 2.494 0 002.437-.93.75.75 0 111.186.918 3.995 3.995 0 01-4.482 1.332.75.75 0 01-.461-.461 3.994 3.994 0 011.332-4.482.75.75 0 011.052.134z" clipRule="evenodd" />
              <path fillRule="evenodd" d="M5.752 12A13.07 13.07 0 008 14.248v4.002c0 .414.336.75.75.75a5 5 0 004.797-6.414 12.984 12.984 0 005.45-10.848.75.75 0 00-.735-.735 12.984 12.984 0 00-10.849 5.45A5 5 0 001 11.25c.001.414.337.75.751.75h4.002zM13 9a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-warm-800 mb-1">CAQH Profile Generator</h3>
            <p className="text-sm text-warm-500 leading-relaxed">
              Generate pre-filled CAQH profile sections from your practice data.
              AI will compose professional text for each section — review and copy into your CAQH ProView profile.
              Fields marked [NEEDS INPUT] require manual completion.
            </p>
          </div>
        </div>
        {!generated && (
          <div className="mt-5 ml-14">
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M4.606 12.97a.75.75 0 01-.134 1.051 2.494 2.494 0 00-.93 2.437 2.494 2.494 0 002.437-.93.75.75 0 111.186.918 3.995 3.995 0 01-4.482 1.332.75.75 0 01-.461-.461 3.994 3.994 0 011.332-4.482.75.75 0 011.052.134z" clipRule="evenodd" />
                    <path fillRule="evenodd" d="M5.752 12A13.07 13.07 0 008 14.248v4.002c0 .414.336.75.75.75a5 5 0 004.797-6.414 12.984 12.984 0 005.45-10.848.75.75 0 00-.735-.735 12.984 12.984 0 00-10.849 5.45A5 5 0 001 11.25c.001.414.337.75.751.75h4.002zM13 9a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                  </svg>
                  Generate CAQH Profile Text
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Generated sections */}
      {sections && (
        <div className="space-y-4">
          {Object.entries(sections).map(([key, text]) => (
            <div key={key} className="bg-white rounded-xl border border-warm-100 shadow-sm">
              <div className="px-5 py-3.5 border-b border-warm-50 flex items-center justify-between">
                <h4 className="text-sm font-medium text-warm-700">
                  {SECTION_LABELS[key] || key.replace(/_/g, " ")}
                </h4>
                <button
                  onClick={() => copySection(key, text)}
                  className="flex items-center gap-1.5 text-xs font-medium text-warm-400 hover:text-teal-600 transition-colors"
                >
                  {copiedSection === key ? (
                    <>
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-emerald-500">
                        <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 01.208 1.04l-5 7.5a.75.75 0 01-1.154.114l-3-3a.75.75 0 011.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 011.04-.207z" />
                      </svg>
                      Copied
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M10.5 3a.75.75 0 01.75.75v1h1a.75.75 0 010 1.5h-1v1a.75.75 0 01-1.5 0v-1h-1a.75.75 0 010-1.5h1v-1A.75.75 0 0110.5 3z" />
                        <path d="M3.75 2A1.75 1.75 0 002 3.75v8.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0014 12.25v-8.5A1.75 1.75 0 0012.25 2H3.75z" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              </div>
              <div className="px-5 py-4">
                <p className="text-sm text-warm-600 leading-relaxed whitespace-pre-wrap">{text}</p>
              </div>
            </div>
          ))}

          <div className="flex justify-center pt-4">
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
            >
              {loading ? "Regenerating..." : "Regenerate All Sections"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
