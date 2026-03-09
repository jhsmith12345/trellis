import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../../hooks/useApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OutstandingClient {
  client_uuid: string;
  client_id: string;
  client_name: string;
  client_email: string | null;
  total_billed: number;
  total_paid: number;
  outstanding_balance: number;
  oldest_unpaid_date: string | null;
  last_payment_date: string | null;
  total_superbills: number;
  unpaid_superbills: number;
}

interface OutstandingBalancesResponse {
  clients: OutstandingClient[];
  total_outstanding: number;
  client_count: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "-";
  return `$${amount.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface OutstandingBalancesProps {
  billingConnected: boolean;
}

export default function OutstandingBalances({ billingConnected }: OutstandingBalancesProps) {
  const api = useApi();
  const [data, setData] = useState<OutstandingBalancesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingLinkFor] = useState<string | null>(null);
  const [emailingStatementFor, setEmailingStatementFor] = useState<string | null>(null);

  // Payment link modal state
  const [paymentModal, setPaymentModal] = useState<{
    clientId: string;
    clientName: string;
    clientEmail: string | null;
    balance: number;
  } | null>(null);
  const [paymentLinkResult, setPaymentLinkResult] = useState<{
    url: string;
    amount: number;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const result = await api.get<OutstandingBalancesResponse>(
        "/api/billing/outstanding-balances"
      );
      setData(result);
    } catch (err) {
      console.error("Failed to load outstanding balances:", err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleEmailStatement(clientId: string) {
    setEmailingStatementFor(clientId);
    try {
      await api.post(`/api/clients/${clientId}/statement/email`, {});
      alert("Statement emailed to client successfully.");
    } catch (err: any) {
      console.error("Failed to email statement:", err);
      alert(err.message || "Failed to email statement.");
    } finally {
      setEmailingStatementFor(null);
    }
  }

  async function handleDownloadStatement(clientId: string) {
    try {
      const blob = await api.postBlob(`/api/clients/${clientId}/statement`, {});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `statement_${clientId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download statement:", err);
      alert("Failed to generate patient statement.");
    }
  }

  async function handleCopyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!data || data.clients.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-warm-100 shadow-sm px-6 py-16 text-center">
        <div className="w-12 h-12 mx-auto mb-4 bg-teal-50 rounded-full flex items-center justify-center">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6 text-teal-400">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <p className="text-warm-500 text-sm">
          No outstanding patient balances. All caught up!
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Summary */}
      <div className="bg-white rounded-2xl border border-warm-100 shadow-sm p-5 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-1">
              Total Outstanding Patient Balances
            </p>
            <p className="text-2xl font-bold text-red-600">
              {formatCurrency(data.total_outstanding)}
            </p>
            <p className="text-xs text-warm-400 mt-1">
              {data.client_count} client{data.client_count !== 1 ? "s" : ""} with outstanding balance
            </p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-warm-100 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs font-semibold text-warm-400 uppercase tracking-wide border-b border-warm-100">
                <th className="px-6 py-3 text-left">Client</th>
                <th className="px-6 py-3 text-right">Total Balance</th>
                <th className="px-6 py-3 text-center">Unpaid Claims</th>
                <th className="px-6 py-3 text-center">Oldest Unpaid</th>
                <th className="px-6 py-3 text-center">Last Payment</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-100">
              {data.clients.map((client) => (
                <tr key={client.client_uuid} className="hover:bg-warm-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <Link
                      to={`/clients/${client.client_uuid}`}
                      className="text-sm font-medium text-teal-700 hover:text-teal-800 transition-colors"
                    >
                      {client.client_name}
                    </Link>
                    {client.client_email && (
                      <p className="text-xs text-warm-400">{client.client_email}</p>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-semibold text-red-600">
                      {formatCurrency(client.outstanding_balance)}
                    </span>
                    <p className="text-xs text-warm-400">
                      of {formatCurrency(client.total_billed)} billed
                    </p>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                      {client.unpaid_superbills}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-center text-warm-500">
                    {formatDate(client.oldest_unpaid_date)}
                  </td>
                  <td className="px-6 py-4 text-xs text-center text-warm-500">
                    {formatDate(client.last_payment_date)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* Send Payment Link */}
                      {billingConnected && (
                        <button
                          onClick={() =>
                            setPaymentModal({
                              clientId: client.client_id,
                              clientName: client.client_name,
                              clientEmail: client.client_email,
                              balance: client.outstanding_balance,
                            })
                          }
                          disabled={sendingLinkFor === client.client_id}
                          className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 transition-colors disabled:opacity-50 flex items-center gap-1"
                          title="Send payment link"
                        >
                          {sendingLinkFor === client.client_id ? (
                            <span className="w-3 h-3 block border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
                          ) : (
                            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                              <path d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 001.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" />
                            </svg>
                          )}
                          Payment Link
                        </button>
                      )}

                      {/* Email Statement */}
                      <button
                        onClick={() => handleEmailStatement(client.client_id)}
                        disabled={emailingStatementFor === client.client_id}
                        className="p-1.5 text-warm-400 hover:text-blue-600 transition-colors disabled:opacity-50"
                        title="Email statement"
                      >
                        {emailingStatementFor === client.client_id ? (
                          <span className="w-4 h-4 block border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                        ) : (
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                            <path d="M3 4a2 2 0 00-2 2v1.161l8.441 4.221a1.25 1.25 0 001.118 0L19 7.162V6a2 2 0 00-2-2H3z" />
                            <path d="M19 8.839l-7.77 3.885a2.75 2.75 0 01-2.46 0L1 8.839V14a2 2 0 002 2h14a2 2 0 002-2V8.839z" />
                          </svg>
                        )}
                      </button>

                      {/* Download Statement */}
                      <button
                        onClick={() => handleDownloadStatement(client.client_id)}
                        className="p-1.5 text-warm-400 hover:text-teal-600 transition-colors"
                        title="Download statement PDF"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                          <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                          <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                        </svg>
                      </button>

                      {/* View Details */}
                      <Link
                        to={`/clients/${client.client_uuid}`}
                        className="p-1.5 text-warm-400 hover:text-teal-600 transition-colors"
                        title="View client details"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                          <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                          <path
                            fillRule="evenodd"
                            d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Link Modal - placeholder for per-client use */}
      {paymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setPaymentModal(null);
              setPaymentLinkResult(null);
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 mx-4">
            <h3 className="font-display text-lg font-bold text-warm-800 mb-1">
              Send Payment Link
            </h3>
            <p className="text-sm text-warm-500 mb-4">
              Generate a Stripe payment link for {paymentModal.clientName}.
            </p>

            {!paymentLinkResult ? (
              <div className="space-y-4">
                <div className="bg-warm-50 rounded-xl p-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-warm-600">Outstanding Balance</span>
                    <span className="text-lg font-bold text-red-600">
                      {formatCurrency(paymentModal.balance)}
                    </span>
                  </div>
                </div>

                {paymentModal.clientEmail && (
                  <div>
                    <label className="block text-sm font-medium text-warm-700 mb-1">
                      Patient Email
                    </label>
                    <p className="text-sm text-warm-600 bg-warm-50 rounded-lg px-3 py-2">
                      {paymentModal.clientEmail}
                    </p>
                  </div>
                )}

                <p className="text-xs text-warm-400">
                  Note: Individual payment links will be generated per superbill from the client detail page.
                  This view shows the total outstanding balance.
                </p>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={() => {
                      setPaymentModal(null);
                      setPaymentLinkResult(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-warm-600 hover:text-warm-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <Link
                    to={`/clients/${paymentModal.clientId}`}
                    onClick={() => {
                      setPaymentModal(null);
                      setPaymentLinkResult(null);
                    }}
                    className="px-4 py-2 text-sm font-medium rounded-xl bg-teal-600 text-white hover:bg-teal-700 transition-colors"
                  >
                    Go to Client Details
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
                  <p className="text-sm text-teal-800 font-medium mb-2">
                    Payment link generated!
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={paymentLinkResult.url}
                      className="flex-1 px-3 py-2 text-xs bg-white border border-teal-200 rounded-lg text-warm-600 truncate"
                    />
                    <button
                      onClick={() => handleCopyLink(paymentLinkResult.url)}
                      className="px-3 py-2 text-xs font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors whitespace-nowrap"
                    >
                      {copiedLink ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p className="text-xs text-teal-600 mt-2">
                    Amount: {formatCurrency(paymentLinkResult.amount)}
                  </p>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setPaymentModal(null);
                      setPaymentLinkResult(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-warm-600 hover:text-warm-800 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
