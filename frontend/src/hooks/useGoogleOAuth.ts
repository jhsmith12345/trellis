import { useState, useEffect, useCallback } from "react";
import { useApi } from "./useApi";

interface GoogleOAuthStatus {
  connected: boolean;
  google_email: string | null;
  scopes: string[];
  connected_at: string | null;
}

export function useGoogleOAuth() {
  const api = useApi();
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected" | "error">("loading");
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.get<GoogleOAuthStatus>("/api/google/status");
      if (data.connected) {
        setStatus("connected");
        setGoogleEmail(data.google_email);
        setConnectedAt(data.connected_at);
      } else {
        setStatus("disconnected");
        setGoogleEmail(null);
        setConnectedAt(null);
      }
      setError("");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Failed to check Google connection");
    }
  }, [api]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const connect = useCallback(async () => {
    try {
      const data = await api.get<{ url: string }>("/api/google/connect");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start Google connection");
    }
  }, [api]);

  const disconnect = useCallback(async () => {
    try {
      await api.post("/api/google/disconnect", {});
      setStatus("disconnected");
      setGoogleEmail(null);
      setConnectedAt(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disconnect Google account");
    }
  }, [api]);

  return { status, googleEmail, connectedAt, error, connect, disconnect, refresh: fetchStatus };
}
