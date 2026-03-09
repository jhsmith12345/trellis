import { useState, useEffect, useCallback } from "react";
import { useApi } from "../hooks/useApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BillingSettings {
  connected: boolean;
  billing_service_url: string;
  billing_auto_submit: boolean;
  billing_last_poll_at: string | null;
  api_key_preview: string | null;
  permissions: {
    messaging?: boolean;
    billing?: boolean;
  } | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BillingServicePage() {
  const api = useApi();

  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Connect form state
  const [apiKey, setApiKey] = useState("");
  const [serviceUrl, setServiceUrl] = useState("https://billing.trellis.health");

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.get<BillingSettings>("/api/billing/settings");
      setSettings(data);
      if (data.billing_service_url) {
        setServiceUrl(data.billing_service_url);
      }
    } catch (err) {
      console.error("Failed to load billing settings:", err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function handleConnect() {
    if (!apiKey.trim()) {
      setMessage({ type: "error", text: "Please enter an API key." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.put("/api/billing/settings", {
        billing_api_key: apiKey.trim(),
        billing_service_url: serviceUrl.trim(),
      });
      setApiKey("");
      await loadSettings();
      setMessage({ type: "success", text: "Billing service connected successfully." });
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Failed to connect." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Are you sure you want to disconnect the billing service? Auto-submit will stop working.")) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.put("/api/billing/settings", {
        billing_api_key: "",
        billing_auto_submit: false,
      });
      await loadSettings();
      setMessage({ type: "success", text: "Billing service disconnected." });
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Failed to disconnect." });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleAutoSubmit() {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.put("/api/billing/settings", {
        billing_auto_submit: !settings.billing_auto_submit,
      });
      await loadSettings();
      setMessage({
        type: "success",
        text: `Auto-submit ${!settings.billing_auto_submit ? "enabled" : "disabled"}.`,
      });
      setTimeout(() => setMessage(null), 3000);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Failed to update." });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-3xl">
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const isConnected = settings?.connected ?? false;

  return (
    <div className="px-8 py-8 max-w-3xl">
      <h1 className="font-display text-2xl font-bold text-warm-800 mb-1">
        Billing Service
      </h1>
      <p className="text-sm text-warm-500 mb-6">
        Connect to Trellis Billing for automated claim submission, eligibility checks, and ERA processing.
      </p>

      {/* Status message */}
      {message && (
        <div
          className={`mb-4 px-4 py-2 rounded-lg text-sm ${
            message.type === "error"
              ? "bg-red-50 text-red-700 border border-red-200"
              : "bg-teal-50 text-teal-700 border border-teal-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {isConnected ? (
        /* ---- Connected State ---- */
        <div className="space-y-6">
          {/* Connection status card */}
          <div className="bg-white rounded-xl border border-warm-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-teal-500" />
                </span>
                <h2 className="text-lg font-semibold text-warm-800">Connected</h2>
              </div>
              <button
                onClick={handleDisconnect}
                disabled={saving}
                className="text-sm text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-warm-400 text-xs font-medium uppercase tracking-wide mb-1">
                  API Key
                </p>
                <p className="text-warm-700 font-mono">{settings?.api_key_preview || "---"}</p>
              </div>
              <div>
                <p className="text-warm-400 text-xs font-medium uppercase tracking-wide mb-1">
                  Service URL
                </p>
                <p className="text-warm-700 truncate">{settings?.billing_service_url}</p>
              </div>
              <div>
                <p className="text-warm-400 text-xs font-medium uppercase tracking-wide mb-1">
                  Last Sync
                </p>
                <p className="text-warm-700">
                  {settings?.billing_last_poll_at
                    ? new Date(settings.billing_last_poll_at).toLocaleString()
                    : "Never"}
                </p>
              </div>
              {settings?.permissions && (
                <div>
                  <p className="text-warm-400 text-xs font-medium uppercase tracking-wide mb-1">
                    Active Services
                  </p>
                  <div className="flex gap-2">
                    {settings.permissions.messaging && (
                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200 rounded-full">
                        Messaging
                      </span>
                    )}
                    {settings.permissions.billing && (
                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200 rounded-full">
                        Billing
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Auto-submit toggle */}
          <div className="bg-white rounded-xl border border-warm-100 shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-warm-800">
                  Auto-Submit Claims
                </h3>
                <p className="text-xs text-warm-500 mt-0.5">
                  Automatically submit claims to the billing service when notes are signed and superbills are generated.
                </p>
              </div>
              <button
                onClick={handleToggleAutoSubmit}
                disabled={saving}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:opacity-50 ${
                  settings?.billing_auto_submit ? "bg-teal-500" : "bg-warm-200"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    settings?.billing_auto_submit ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Info section */}
          <div className="bg-warm-50 rounded-xl border border-warm-100 p-5">
            <h3 className="text-sm font-semibold text-warm-700 mb-2">What's included</h3>
            <ul className="space-y-1.5 text-sm text-warm-600">
              <li className="flex items-start gap-2">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-teal-500 mt-0.5 shrink-0">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                </svg>
                Electronic claim submission (837P) via Stedi
              </li>
              <li className="flex items-start gap-2">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-teal-500 mt-0.5 shrink-0">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                </svg>
                Real-time eligibility verification (270/271)
              </li>
              <li className="flex items-start gap-2">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-teal-500 mt-0.5 shrink-0">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                </svg>
                ERA/835 remittance auto-processing
              </li>
              <li className="flex items-start gap-2">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-teal-500 mt-0.5 shrink-0">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                </svg>
                Claim status tracking and automatic updates
              </li>
            </ul>
          </div>
        </div>
      ) : (
        /* ---- Not Connected State ---- */
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-warm-100 shadow-sm p-6 text-center">
            <div className="mx-auto w-12 h-12 bg-warm-100 rounded-full flex items-center justify-center mb-4">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6 text-warm-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-warm-800 mb-2">
              Trellis Billing
            </h2>
            <p className="text-sm text-warm-500 max-w-md mx-auto mb-6">
              Automate your insurance billing with electronic claim submission, real-time eligibility checks,
              and automatic payment posting. Submit claims directly from your superbills with one click.
            </p>
            <a
              href="https://trellis.health/billing"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-teal-600 hover:text-teal-700 font-medium"
            >
              Learn More
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M5.22 14.78a.75.75 0 001.06 0l7.22-7.22v5.69a.75.75 0 001.5 0v-7.5a.75.75 0 00-.75-.75h-7.5a.75.75 0 000 1.5h5.69l-7.22 7.22a.75.75 0 000 1.06z" clipRule="evenodd" />
              </svg>
            </a>
          </div>

          {/* Connect form */}
          <div className="bg-white rounded-xl border border-warm-100 shadow-sm p-6">
            <h3 className="text-sm font-semibold text-warm-700 mb-4">
              Have an API key? Connect your billing service.
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-warm-500 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your billing service API key"
                  className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-warm-500 mb-1">
                  Service URL
                </label>
                <input
                  type="url"
                  value={serviceUrl}
                  onChange={(e) => setServiceUrl(e.target.value)}
                  placeholder="https://billing.trellis.health"
                  className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
                />
              </div>
              <button
                onClick={handleConnect}
                disabled={saving || !apiKey.trim()}
                className="px-6 py-2 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {saving && (
                  <span className="w-4 h-4 block border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
