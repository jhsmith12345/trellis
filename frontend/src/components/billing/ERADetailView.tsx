/**
 * ERA / Payment Posting Detail View
 *
 * Displays insurance remittance (835) data for a superbill: payment summary,
 * adjustments with plain-English descriptions, service line breakdown, and
 * payment metadata (check/EFT number, payer, date).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ERAAdjustment {
  group_code: string; // CO, PR, OA
  reason_code: string;
  amount: number;
  description: string;
}

export interface ERAServiceLine {
  cpt_code: string;
  charged_amount: number;
  allowed_amount: number;
  paid_amount: number;
  adjustments: ERAAdjustment[];
}

export interface ERAClaimPayment {
  patient_name: string;
  member_id: string;
  claim_id: string;
  charged_amount: number;
  paid_amount: number;
  patient_responsibility: number;
  adjustments: ERAAdjustment[];
  service_lines: ERAServiceLine[];
  is_denied: boolean;
  denial_reason: string;
}

export interface ERADetail {
  id: string;
  account_id: string;
  claim_id: string;
  stedi_era_id: string | null;
  check_number: string | null;
  payer_name: string | null;
  payment_amount: number;
  adjustment_amount: number;
  patient_responsibility: number;
  adjustment_reasons: ERAAdjustment[];
  claim_payments: ERAClaimPayment[];
  processed_at: string | null;
  created_at: string;
}

export interface ERAData {
  eras: ERADetail[];
  count: number;
}

interface ERADetailViewProps {
  eraData: ERAData | null;
  loading: boolean;
  chargedAmount?: number | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUP_CODE_LABELS: Record<string, string> = {
  CO: "Contractual Obligation",
  PR: "Patient Responsibility",
  OA: "Other Adjustment",
  PI: "Payer Initiated",
  CR: "Correction / Reversal",
};

const GROUP_CODE_STYLES: Record<string, string> = {
  CO: "bg-warm-50 text-warm-600 border-warm-200",
  PR: "bg-blue-50 text-blue-700 border-blue-200",
  OA: "bg-amber-50 text-amber-700 border-amber-200",
  PI: "bg-purple-50 text-purple-700 border-purple-200",
  CR: "bg-red-50 text-red-700 border-red-200",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "-";
  return `$${amount.toFixed(2)}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Aggregate adjustments by group code across all claim payments. */
function aggregateByGroup(eras: ERADetail[]): {
  co: number;
  pr: number;
  oa: number;
  deductible: number;
  copay: number;
  coinsurance: number;
} {
  const result = { co: 0, pr: 0, oa: 0, deductible: 0, copay: 0, coinsurance: 0 };
  for (const era of eras) {
    for (const adj of era.adjustment_reasons) {
      const gc = adj.group_code.toUpperCase();
      if (gc === "CO") result.co += adj.amount;
      else if (gc === "PR") result.pr += adj.amount;
      else result.oa += adj.amount;

      // PR sub-categories by common CARC codes
      if (gc === "PR") {
        if (adj.reason_code === "1") result.deductible += adj.amount;
        else if (adj.reason_code === "2") result.coinsurance += adj.amount;
        else if (adj.reason_code === "3") result.copay += adj.amount;
      }
    }
    // Also check claim_payments adjustments for more detail
    for (const cp of era.claim_payments) {
      for (const adj of cp.adjustments) {
        const gc = adj.group_code.toUpperCase();
        if (gc === "PR") {
          if (adj.reason_code === "1") result.deductible += adj.amount;
          else if (adj.reason_code === "2") result.coinsurance += adj.amount;
          else if (adj.reason_code === "3") result.copay += adj.amount;
        }
      }
    }
  }
  return result;
}

/** Collect all unique adjustments across ERAs for the detail table. */
function collectAdjustments(eras: ERADetail[]): ERAAdjustment[] {
  const all: ERAAdjustment[] = [];
  const seen = new Set<string>();
  for (const era of eras) {
    for (const adj of era.adjustment_reasons) {
      const key = `${adj.group_code}-${adj.reason_code}-${adj.amount}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(adj);
      }
    }
    for (const cp of era.claim_payments) {
      for (const adj of cp.adjustments) {
        const key = `${adj.group_code}-${adj.reason_code}-${adj.amount}`;
        if (!seen.has(key)) {
          seen.add(key);
          all.push(adj);
        }
      }
    }
  }
  return all;
}

/** Collect all service lines across all claim payments. */
function collectServiceLines(eras: ERADetail[]): ERAServiceLine[] {
  const lines: ERAServiceLine[] = [];
  for (const era of eras) {
    for (const cp of era.claim_payments) {
      lines.push(...cp.service_lines);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ERADetailView({ eraData, loading, chargedAmount }: ERADetailViewProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-warm-100 shadow-sm p-6">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
          <span className="text-sm text-warm-500">Loading payment details...</span>
        </div>
      </div>
    );
  }

  if (!eraData || eraData.count === 0) {
    return (
      <div className="bg-white rounded-xl border border-warm-100 shadow-sm p-6">
        <div className="flex items-center gap-3 text-warm-400">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-sm">Awaiting insurance response</span>
        </div>
      </div>
    );
  }

  const eras = eraData.eras;
  const primary = eras[0]!;
  const totalPaid = eras.reduce((s, e) => s + e.payment_amount, 0);
  const totalAdjustment = eras.reduce((s, e) => s + e.adjustment_amount, 0);
  const totalPatientResp = eras.reduce((s, e) => s + e.patient_responsibility, 0);
  const groups = aggregateByGroup(eras);
  const adjustments = collectAdjustments(eras);
  const serviceLines = collectServiceLines(eras);

  // Use charged amount from the primary claim payment or from the prop
  const charged =
    primary.claim_payments.length > 0
      ? primary.claim_payments.reduce((s, cp) => s + cp.charged_amount, 0)
      : chargedAmount ?? 0;
  const allowed = charged - groups.co;

  const isDenied = eras.some((e) => e.claim_payments.some((cp) => cp.is_denied));
  const denialReason = eras
    .flatMap((e) => e.claim_payments)
    .find((cp) => cp.is_denied)?.denial_reason;

  return (
    <div className="space-y-4">
      {/* Denial banner */}
      {isDenied && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-red-600">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm font-semibold text-red-800">Claim Denied</span>
          </div>
          {denialReason && (
            <p className="text-sm text-red-700 ml-7">{denialReason}</p>
          )}
        </div>
      )}

      {/* Payment Summary */}
      <div className="bg-white rounded-xl border border-warm-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-warm-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-warm-700">Payment Summary</h3>
          {primary.check_number && (
            <span className="text-xs text-warm-500 bg-warm-50 px-2 py-0.5 rounded">
              Check/EFT: {primary.check_number}
            </span>
          )}
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <SummaryItem label="Charged" value={fmt(charged)} />
            <SummaryItem label="Allowed" value={fmt(allowed)} sublabel="Insurance's reasonable rate" />
            <SummaryItem
              label="Insurance Paid"
              value={fmt(totalPaid)}
              color="text-teal-700"
              bgColor="bg-teal-50"
            />
            <SummaryItem
              label="Adjustments"
              value={fmt(totalAdjustment)}
              sublabel={groups.co > 0 ? `CO: ${fmt(groups.co)}` : undefined}
            />
            <SummaryItem
              label="Patient Responsibility"
              value={fmt(totalPatientResp)}
              color="text-blue-700"
              bgColor="bg-blue-50"
              sublabel={
                [
                  groups.deductible > 0 ? `Deductible: ${fmt(groups.deductible)}` : null,
                  groups.copay > 0 ? `Copay: ${fmt(groups.copay)}` : null,
                  groups.coinsurance > 0 ? `Coinsurance: ${fmt(groups.coinsurance)}` : null,
                ]
                  .filter(Boolean)
                  .join(" / ") || undefined
              }
            />
            <SummaryItem
              label="Payment Date"
              value={formatDate(primary.processed_at || primary.created_at)}
              sublabel={primary.payer_name || undefined}
            />
          </div>
        </div>
      </div>

      {/* Adjustments Table */}
      {adjustments.length > 0 && (
        <div className="bg-white rounded-xl border border-warm-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-warm-100">
            <h3 className="text-sm font-semibold text-warm-700">Adjustment Details</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs font-semibold text-warm-400 uppercase tracking-wide border-b border-warm-100">
                  <th className="px-5 py-2.5 text-left">Group</th>
                  <th className="px-5 py-2.5 text-left">Reason</th>
                  <th className="px-5 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-100">
                {adjustments.map((adj, i) => {
                  const gc = adj.group_code.toUpperCase();
                  const style = GROUP_CODE_STYLES[gc] || GROUP_CODE_STYLES.OA!;
                  return (
                    <tr key={i} className="text-sm">
                      <td className="px-5 py-2.5">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${style}`}
                        >
                          {gc}
                        </span>
                        <span className="ml-2 text-xs text-warm-500">
                          {GROUP_CODE_LABELS[gc] || gc}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-warm-700">
                        <span className="font-mono text-xs text-warm-400 mr-1.5">
                          {adj.reason_code}
                        </span>
                        {adj.description}
                      </td>
                      <td className="px-5 py-2.5 text-right font-medium text-warm-700">
                        {fmt(adj.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Service Line Breakdown */}
      {serviceLines.length > 0 && (
        <div className="bg-white rounded-xl border border-warm-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-warm-100">
            <h3 className="text-sm font-semibold text-warm-700">Service Line Breakdown</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs font-semibold text-warm-400 uppercase tracking-wide border-b border-warm-100">
                  <th className="px-5 py-2.5 text-left">CPT</th>
                  <th className="px-5 py-2.5 text-right">Charged</th>
                  <th className="px-5 py-2.5 text-right">Allowed</th>
                  <th className="px-5 py-2.5 text-right">Paid</th>
                  <th className="px-5 py-2.5 text-left">Adjustments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-100">
                {serviceLines.map((sl, i) => (
                  <tr key={i} className="text-sm">
                    <td className="px-5 py-2.5 font-mono font-semibold text-warm-700">
                      {sl.cpt_code}
                    </td>
                    <td className="px-5 py-2.5 text-right text-warm-600">
                      {fmt(sl.charged_amount)}
                    </td>
                    <td className="px-5 py-2.5 text-right text-warm-600">
                      {fmt(sl.allowed_amount)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-medium text-teal-700">
                      {fmt(sl.paid_amount)}
                    </td>
                    <td className="px-5 py-2.5">
                      {sl.adjustments.length > 0 ? (
                        <div className="space-y-0.5">
                          {sl.adjustments.map((adj, j) => (
                            <div key={j} className="text-xs text-warm-500">
                              <span
                                className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border mr-1 ${
                                  GROUP_CODE_STYLES[adj.group_code.toUpperCase()] ||
                                  GROUP_CODE_STYLES.OA!
                                }`}
                              >
                                {adj.group_code}
                              </span>
                              {adj.description || adj.reason_code} ({fmt(adj.amount)})
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-warm-300">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryItem({
  label,
  value,
  sublabel,
  color,
  bgColor,
}: {
  label: string;
  value: string;
  sublabel?: string;
  color?: string;
  bgColor?: string;
}) {
  return (
    <div className={`rounded-lg p-3 ${bgColor || "bg-warm-50"}`}>
      <p className="text-xs font-medium text-warm-500 mb-0.5">{label}</p>
      <p className={`text-lg font-semibold ${color || "text-warm-800"}`}>{value}</p>
      {sublabel && <p className="text-[11px] text-warm-400 mt-0.5">{sublabel}</p>}
    </div>
  );
}
