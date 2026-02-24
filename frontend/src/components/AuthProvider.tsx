import { createContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { auth, onAuthStateChanged, type User } from "../lib/firebase";
import type { PracticeType, PracticeRole, Clinician } from "../types";

export type AppRole = "clinician" | "client" | null;

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  role: AppRole;
  roleLoading: boolean;
  registered: boolean;
  getIdToken: () => Promise<string>;
  setRole: (role: AppRole) => void;
  registerRole: (role: "clinician" | "client") => Promise<void>;
  switchRole: (newRole: "clinician" | "client") => Promise<void>;
  /* Group practice context */
  practiceId: string | null;
  practiceType: PracticeType | null;
  practiceRole: PracticeRole | null;
  isOwner: boolean;
  clinician: Clinician | null;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<AppRole>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [practiceType, setPracticeType] = useState<PracticeType | null>(null);
  const [practiceRole, setPracticeRole] = useState<PracticeRole | null>(null);
  const [clinician, setClinician] = useState<Clinician | null>(null);

  const isOwner = practiceRole === "owner";

  async function getIdToken(): Promise<string> {
    if (!user) throw new Error("Not authenticated");
    return user.getIdToken();
  }

  function clearPracticeState() {
    setPracticeId(null);
    setPracticeType(null);
    setPracticeRole(null);
    setClinician(null);
  }

  const fetchRole = useCallback(async (u: User) => {
    setRoleLoading(true);
    try {
      const token = await u.getIdToken();
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.registered) {
          setRole(data.role);
          setRegistered(true);
          // Parse group practice context from /auth/me response
          if (data.clinician) {
            setClinician(data.clinician);
            setPracticeId(data.clinician.practice_id || null);
            setPracticeRole(data.clinician.practice_role || null);
          }
          if (data.practice) {
            setPracticeType(data.practice.type || null);
          }
        } else {
          setRole(null);
          setRegistered(false);
          clearPracticeState();
        }
      }
    } catch {
      // API not available — leave as unregistered
    } finally {
      setRoleLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        fetchRole(u);
      } else {
        setRole(null);
        setRegistered(false);
        setRoleLoading(false);
        clearPracticeState();
      }
    });
    return unsubscribe;
  }, [fetchRole]);

  const registerRole = useCallback(
    async (newRole: "clinician" | "client") => {
      if (!user) throw new Error("Not authenticated");
      const token = await user.getIdToken();
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: newRole, display_name: user.displayName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Registration failed");
      }
      const data = await res.json();
      setRole(newRole);
      setRegistered(true);
      // Parse practice context from registration response
      if (data.practice_id) {
        setPracticeId(data.practice_id);
      }
      if (data.practice_role) {
        setPracticeRole(data.practice_role);
      }
    },
    [user],
  );

  const switchRole = useCallback(
    async (newRole: "clinician" | "client") => {
      if (!user) throw new Error("Not authenticated");
      const token = await user.getIdToken();
      const res = await fetch("/api/auth/switch-role", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ new_role: newRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409 && body.detail?.locked) {
          throw new Error(body.detail.reason);
        }
        throw new Error(body.detail || "Failed to switch role");
      }
      // Refresh all auth state from the server
      await fetchRole(user);
    },
    [user, fetchRole],
  );

  return (
    <AuthContext.Provider
      value={{
        user, loading, role, roleLoading, registered, getIdToken, setRole, registerRole,
        switchRole, practiceId, practiceType, practiceRole, isOwner, clinician,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
