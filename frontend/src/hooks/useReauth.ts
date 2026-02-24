/**
 * Re-authentication Hook (convenience re-export)
 *
 * Re-exports useReauthContext from ReauthProvider for convenient usage.
 *
 * Usage:
 *   const { requireReauth } = useReauth();
 *   const confirmed = await requireReauth();
 *   if (!confirmed) return; // user cancelled
 *   // ... proceed with sensitive action
 */
export { useReauthContext as useReauth } from "../components/ReauthProvider";
