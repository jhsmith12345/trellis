import { createContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { auth, onAuthStateChanged, type User } from "../lib/firebase";
import { API_BASE } from "../lib/api-config";
import type { PracticeType, PracticeRole, Clinician } from "../types";

export type AppRole = "clinician" | "client" | null;

export type IntakeMode = "standard" | "iop";

export interface InviteInfo {
  practice_name: string;
  clinician_name: string;
  email: string;
  intake_mode: IntakeMode;
}

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  role: AppRole;
  roleLoading: boolean;
  registered: boolean;
  getIdToken: () => Promise<string>;
  setRole: (role: AppRole) => void;
  registerRole: (role: "clinician" | "client", opts?: { invite_token?: string; primary_clinician_id?: string }) => Promise<void>;
  switchRole: (newRole: "clinician" | "client") => Promise<void>;
  /* Group practice context */
  practiceId: string | null;
  practiceType: PracticeType | null;
  practiceRole: PracticeRole | null;
  isOwner: boolean;
  clinician: Clinician | null;
  /* Practice initialization & invite flow */
  practiceInitialized: boolean | null;
  cashOnly: boolean;
  inviteToken: string | null;
  inviteInfo: InviteInfo | null;
  needsClinicianPicker: boolean;
  completeRegistration: (clinicianId: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

function getInviteTokenFromURL(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("invite");
}

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

  // Practice status & invite flow state
  const [practiceInitialized, setPracticeInitialized] = useState<boolean | null>(null);
  const [cashOnly, setCashOnly] = useState(false);
  const [practiceStatusType, setPracticeStatusType] = useState<string | null>(null);
  const [inviteToken] = useState<string | null>(getInviteTokenFromURL);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [needsClinicianPicker, setNeedsClinicianPicker] = useState(false);

  const autoRegisterAttempted = useRef(false);

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
    setNeedsClinicianPicker(false);
  }

  // Fetch practice status + invite info on mount
  useEffect(() => {
    async function loadPracticeStatus() {
      try {
        const res = await fetch(`${API_BASE}/api/practice/status`);
        if (res.ok) {
          const data = await res.json();
          setPracticeInitialized(data.initialized);
          if (data.initialized) {
            setPracticeStatusType(data.practice_type || null);
            setCashOnly(data.cash_only || false);
          }
        }
      } catch {
        // API not available — leave as null
      }
    }

    async function loadInviteInfo() {
      if (!inviteToken) return;
      try {
        const res = await fetch(`${API_BASE}/api/invitations/${inviteToken}`);
        if (res.ok) {
          const data = await res.json();
          setInviteInfo(data);
        }
      } catch {
        // Invalid/expired token — ignore
      }
    }

    loadPracticeStatus();
    loadInviteInfo();
  }, [inviteToken]);

  // Auto-register when fetchRole discovers user is unregistered
  const autoRegister = useCallback(async (u: User) => {
    if (autoRegisterAttempted.current) return;
    autoRegisterAttempted.current = true;

    // Wait for practice status to be loaded
    // (practiceInitialized is captured in closure — use a fresh fetch)
    let initialized = practiceInitialized;
    let pType = practiceStatusType;
    if (initialized === null) {
      try {
        const res = await fetch(`${API_BASE}/api/practice/status`);
        if (res.ok) {
          const data = await res.json();
          initialized = data.initialized;
          pType = data.practice_type || null;
          setPracticeInitialized(data.initialized);
          setPracticeStatusType(data.practice_type || null);
          setCashOnly(data.cash_only || false);
        }
      } catch {
        return; // Can't determine — bail out
      }
    }

    const token = await u.getIdToken();
    const registerPayload: Record<string, string | null | undefined> = {
      display_name: u.displayName,
    };

    if (!initialized) {
      // First user → register as clinician
      registerPayload.role = "clinician";
    } else if (inviteToken) {
      // Invited client
      registerPayload.role = "client";
      registerPayload.invite_token = inviteToken;
    } else if (pType === "solo") {
      // Solo practice — auto-register as client linked to owner
      registerPayload.role = "client";
    } else if (pType === "group") {
      // Group practice — need clinician picker first
      setNeedsClinicianPicker(true);
      setRoleLoading(false);
      return;
    } else {
      // Default to client
      registerPayload.role = "client";
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(registerPayload),
      });
      if (res.ok) {
        const data = await res.json();
        setRole(data.role as AppRole);
        setRegistered(true);
        if (data.practice_id) setPracticeId(data.practice_id);
        if (data.practice_role) setPracticeRole(data.practice_role);
      }
    } catch {
      // Registration failed — leave unregistered
    } finally {
      setRoleLoading(false);
    }
  }, [practiceInitialized, practiceStatusType, inviteToken]);

  const fetchRole = useCallback(async (u: User) => {
    setRoleLoading(true);
    try {
      const token = await u.getIdToken();
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.registered) {
          setRole(data.role);
          setRegistered(true);
          setRoleLoading(false);
          // Parse group practice context from /auth/me response
          if (data.clinician) {
            setClinician(data.clinician);
            setPracticeId(data.clinician.practice_id || null);
            setPracticeRole(data.clinician.practice_role || null);
          }
          if (data.practice) {
            setPracticeType(data.practice.type || null);
            setCashOnly(data.practice.cash_only || false);
          }
        } else {
          // Not registered — auto-register based on practice state
          setRole(null);
          setRegistered(false);
          clearPracticeState();
          await autoRegister(u);
        }
      } else {
        setRoleLoading(false);
      }
    } catch {
      // API not available — leave as unregistered
      setRoleLoading(false);
    }
  }, [autoRegister]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        autoRegisterAttempted.current = false;
        fetchRole(u);
      } else {
        setRole(null);
        setRegistered(false);
        setRoleLoading(false);
        clearPracticeState();
        autoRegisterAttempted.current = false;
      }
    });
    return unsubscribe;
  }, [fetchRole]);

  const registerRole = useCallback(
    async (newRole: "clinician" | "client", opts?: { invite_token?: string; primary_clinician_id?: string }) => {
      if (!user) throw new Error("Not authenticated");
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role: newRole,
          display_name: user.displayName,
          invite_token: opts?.invite_token,
          primary_clinician_id: opts?.primary_clinician_id,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Registration failed");
      }
      const data = await res.json();
      setRole(newRole);
      setRegistered(true);
      setNeedsClinicianPicker(false);
      if (data.practice_id) {
        setPracticeId(data.practice_id);
      }
      if (data.practice_role) {
        setPracticeRole(data.practice_role);
      }
    },
    [user],
  );

  const completeRegistration = useCallback(
    async (clinicianId: string) => {
      await registerRole("client", { primary_clinician_id: clinicianId });
    },
    [registerRole],
  );

  const switchRole = useCallback(
    async (newRole: "clinician" | "client") => {
      if (!user) throw new Error("Not authenticated");
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/auth/switch-role`, {
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
        practiceInitialized, cashOnly, inviteToken, inviteInfo, needsClinicianPicker, completeRegistration,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
