/**
 * API base URL — empty in dev (Vite proxies /api), full URL in production.
 * Set via VITE_API_URL build arg when building the Docker image.
 */
export const API_BASE = import.meta.env.VITE_API_URL ?? "";

/** WebSocket base URL for the voice relay. */
export const WS_BASE = import.meta.env.VITE_WS_URL ?? "";
