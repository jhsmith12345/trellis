/**
 * Re-authentication Context Provider
 *
 * Provides a shared re-authentication context so any component in the tree
 * can request re-auth via the useReauthContext() hook. This ensures only one
 * modal is shown at a time and the 5-minute cache is shared.
 */
import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import {
  reauthenticateWithPopup,
  GoogleAuthProvider,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import { auth } from "../lib/firebase";

const REAUTH_CACHE_MS = 5 * 60 * 1000; // 5 minutes

interface ReauthContextValue {
  /** Request re-authentication. Returns promise<boolean>. */
  requireReauth: () => Promise<boolean>;
  /** Whether the re-auth modal should be displayed */
  showModal: boolean;
  /** Current error message (null if none) */
  error: string | null;
  /** Whether a re-auth attempt is in progress */
  loading: boolean;
  /** Re-authenticate with Google popup */
  reauthWithGoogle: () => Promise<void>;
  /** Re-authenticate with email/password */
  reauthWithPassword: (password: string) => Promise<void>;
  /** Cancel re-authentication */
  cancel: () => void;
}

const ReauthContext = createContext<ReauthContextValue | null>(null);

export function useReauthContext(): ReauthContextValue {
  const ctx = useContext(ReauthContext);
  if (!ctx) {
    throw new Error("useReauthContext must be used within a ReauthProvider");
  }
  return ctx;
}

export function ReauthProvider({ children }: { children: ReactNode }) {
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastReauthRef = useRef(0);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const requireReauth = useCallback((): Promise<boolean> => {
    // Check cache
    if (Date.now() - lastReauthRef.current < REAUTH_CACHE_MS) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setError(null);
      setShowModal(true);
    });
  }, []);

  const reauthWithGoogle = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setError("Not signed in");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await reauthenticateWithPopup(user, new GoogleAuthProvider());
      lastReauthRef.current = Date.now();
      setShowModal(false);
      resolveRef.current?.(true);
      resolveRef.current = null;
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes("popup-closed")) {
          setError("Sign-in popup was closed. Please try again.");
        } else if (err.message.includes("user-mismatch")) {
          setError("You must sign in with the same account.");
        } else {
          setError("Re-authentication failed. Please try again.");
        }
      } else {
        setError("Re-authentication failed.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const reauthWithPassword = useCallback(async (password: string) => {
    const user = auth.currentUser;
    if (!user || !user.email) {
      setError("Not signed in");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);
      lastReauthRef.current = Date.now();
      setShowModal(false);
      resolveRef.current?.(true);
      resolveRef.current = null;
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes("wrong-password") || err.message.includes("invalid-credential")) {
          setError("Incorrect password. Please try again.");
        } else {
          setError("Re-authentication failed. Please try again.");
        }
      } else {
        setError("Re-authentication failed.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const cancel = useCallback(() => {
    setShowModal(false);
    setError(null);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  return (
    <ReauthContext.Provider
      value={{
        requireReauth,
        showModal,
        error,
        loading,
        reauthWithGoogle,
        reauthWithPassword,
        cancel,
      }}
    >
      {children}
    </ReauthContext.Provider>
  );
}
