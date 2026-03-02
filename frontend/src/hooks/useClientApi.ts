import { useCallback } from "react";
import { useAuth } from "./useAuth";
import { API_BASE } from "../lib/api-config";
import type { ClientProfile, InsuranceExtraction } from "../types";

async function api<T>(
  path: string,
  token: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function useClientApi() {
  const { getIdToken } = useAuth();

  const getProfile = useCallback(async (): Promise<ClientProfile> => {
    const token = await getIdToken();
    return api<ClientProfile>("/api/clients/me", token);
  }, [getIdToken]);

  const updateProfile = useCallback(
    async (data: Record<string, string | null>) => {
      const token = await getIdToken();
      return api("/api/clients/me", token, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },
    [getIdToken],
  );

  const extractInsuranceCard = useCallback(
    async (front: string, mimeType: string, back?: string) => {
      const token = await getIdToken();
      return api<{ extraction: InsuranceExtraction }>(
        "/api/clients/insurance-card",
        token,
        {
          method: "POST",
          body: JSON.stringify({ front, back: back || null, mime_type: mimeType }),
        },
      );
    },
    [getIdToken],
  );

  const saveInsurance = useCallback(
    async (data: Partial<InsuranceExtraction>) => {
      const token = await getIdToken();
      return api("/api/clients/insurance", token, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    [getIdToken],
  );

  return { getProfile, updateProfile, extractInsuranceCard, saveInsurance };
}
