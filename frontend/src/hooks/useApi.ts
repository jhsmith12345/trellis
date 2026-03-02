import { useCallback, useMemo } from "react";
import { useAuth } from "./useAuth";
import { API_BASE } from "../lib/api-config";

async function request<T>(
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

export function useApi() {
  const { getIdToken } = useAuth();

  const get = useCallback(
    async <T>(path: string): Promise<T> => {
      const token = await getIdToken();
      return request<T>(path, token);
    },
    [getIdToken],
  );

  const put = useCallback(
    async <T>(path: string, body: unknown): Promise<T> => {
      const token = await getIdToken();
      return request<T>(path, token, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
    [getIdToken],
  );

  const post = useCallback(
    async <T>(path: string, body: unknown): Promise<T> => {
      const token = await getIdToken();
      return request<T>(path, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    [getIdToken],
  );

  const patch = useCallback(
    async <T>(path: string, body: unknown): Promise<T> => {
      const token = await getIdToken();
      return request<T>(path, token, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    [getIdToken],
  );

  const getBlob = useCallback(
    async (path: string): Promise<Blob> => {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Request failed: ${res.status}`);
      }
      return res.blob();
    },
    [getIdToken],
  );

  return useMemo(
    () => ({ get, put, post, patch, getBlob }),
    [get, put, post, patch, getBlob],
  );
}
