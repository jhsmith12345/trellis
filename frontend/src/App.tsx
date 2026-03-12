import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./components/AuthProvider";
import { ReauthProvider } from "./components/ReauthProvider";
import { ReauthModal } from "./components/ReauthModal";
import { useAuth } from "./hooks/useAuth";
import { ClinicianPicker } from "./components/ClinicianPicker";
import { ClinicianShell } from "./components/ClinicianShell";
import { ClientShell } from "./components/ClientShell";
import { LoadingSpinner } from "./components/LoadingSpinner";
import LandingPage from "./pages/LandingPage";
import OnboardingPage from "./pages/OnboardingPage";
import DashboardPage from "./pages/DashboardPage";
import ClientListPage from "./pages/ClientListPage";
import ClientDetailPage from "./pages/ClientDetailPage";
import PracticeSetupPage from "./pages/PracticeSetupPage";
import PracticeSettingsPage from "./pages/PracticeSettingsPage";
import SigningPage from "./pages/SigningPage";
import SetupWizardPage from "./pages/SetupWizardPage";
import SchedulePage from "./pages/SchedulePage";
import NoteEditorPage from "./pages/NoteEditorPage";
import ManualNotePage from "./pages/ManualNotePage";
import TreatmentPlanEditorPage from "./pages/TreatmentPlanEditorPage";
import BillingPage from "./pages/BillingPage";
import FinancialReportsPage from "./pages/FinancialReportsPage";
import ClaimReviewPage from "./pages/ClaimReviewPage";
import AuditLogPage from "./pages/AuditLogPage";
import CredentialingPage from "./pages/CredentialingPage";
import TeamManagementPage from "./pages/TeamManagementPage";
import ClientDashboardPage from "./pages/client/ClientDashboardPage";
import ClientAppointmentsPage from "./pages/client/ClientAppointmentsPage";
import ClientDocumentsPage from "./pages/client/ClientDocumentsPage";
import ClientBillingPage from "./pages/client/ClientBillingPage";
import type { ReactNode } from "react";

/** Shows ClinicianPicker if needed, otherwise loading spinner while auto-registering. */
function UnregisteredGate() {
  const { needsClinicianPicker } = useAuth();
  if (needsClinicianPicker) return <ClinicianPicker />;
  return <LoadingSpinner />;
}

/** Requires Firebase auth. Shows picker or spinner while registering. */
function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, registered, roleLoading } = useAuth();
  if (loading || roleLoading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/" replace />;
  if (!registered) return <UnregisteredGate />;
  return <>{children}</>;
}

/** Requires clinician role. */
function ClinicianRoute({ children }: { children: ReactNode }) {
  const { user, loading, role, roleLoading, registered } = useAuth();
  if (loading || roleLoading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/" replace />;
  if (!registered) return <UnregisteredGate />;
  if (role !== "clinician") return <Navigate to="/client/dashboard" replace />;
  return <>{children}</>;
}

/** Requires practice owner (or solo practitioner). */
function OwnerRoute({ children }: { children: ReactNode }) {
  const { user, loading, role, roleLoading, registered, isOwner, practiceType } = useAuth();
  if (loading || roleLoading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/" replace />;
  if (!registered) return <UnregisteredGate />;
  if (role !== "clinician") return <Navigate to="/client/dashboard" replace />;
  if (practiceType === "solo" || isOwner) return <>{children}</>;
  return <Navigate to="/dashboard" replace />;
}

/** Requires client role. */
function ClientRoute({ children }: { children: ReactNode }) {
  const { user, loading, role, roleLoading, registered } = useAuth();
  if (loading || roleLoading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/" replace />;
  if (!registered) return <UnregisteredGate />;
  if (role !== "client") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Redirect authenticated users to their role's home page. */
function RoleRedirect() {
  const { user, loading, role, roleLoading, registered } = useAuth();
  if (loading || roleLoading) return <LoadingSpinner />;
  if (!user) return null;
  if (!registered) return <Navigate to="/onboarding" replace />;
  if (role === "clinician") return <Navigate to="/dashboard" replace />;
  if (role === "client") return <Navigate to="/client/dashboard" replace />;
  return null;
}

/** Clinicians who end up on /onboarding get sent to /dashboard instead. */
function OnboardingGuard() {
  const { role } = useAuth();
  if (role === "clinician") return <Navigate to="/dashboard" replace />;
  return <OnboardingPage />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<><RoleRedirect /><LandingPage /></>} />

      {/* Clinician routes — wrapped in sidebar shell */}
      <Route
        element={
          <ClinicianRoute>
            <ClinicianShell />
          </ClinicianRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/clients" element={<ClientListPage />} />
        <Route path="/clients/:clientId" element={<ClientDetailPage />} />
        <Route path="/notes/new" element={<ManualNotePage />} />
        <Route path="/notes/:noteId" element={<NoteEditorPage />} />
        <Route path="/treatment-plans/:planId" element={<TreatmentPlanEditorPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/billing" element={<OwnerRoute><BillingPage /></OwnerRoute>} />
        <Route path="/billing/reports" element={<OwnerRoute><FinancialReportsPage /></OwnerRoute>} />
        <Route path="/billing/claims/:superbillId/review" element={<OwnerRoute><ClaimReviewPage /></OwnerRoute>} />
        <Route path="/settings/practice" element={<PracticeSettingsPage />} />
        <Route path="/settings/team" element={<OwnerRoute><TeamManagementPage /></OwnerRoute>} />
        <Route path="/settings/credentialing" element={<OwnerRoute><CredentialingPage /></OwnerRoute>} />
        <Route path="/settings/audit-log" element={<OwnerRoute><AuditLogPage /></OwnerRoute>} />
      </Route>

      {/* Clinician onboarding — no sidebar */}
      <Route
        path="/setup"
        element={
          <ClinicianRoute>
            <PracticeSetupPage />
          </ClinicianRoute>
        }
      />

      {/* Client portal routes — wrapped in client shell */}
      <Route
        element={
          <ClientRoute>
            <ClientShell />
          </ClientRoute>
        }
      >
        <Route path="/client/dashboard" element={<ClientDashboardPage />} />
        <Route path="/client/appointments" element={<ClientAppointmentsPage />} />
        <Route path="/client/documents" element={<ClientDocumentsPage />} />
        <Route path="/client/billing" element={<ClientBillingPage />} />
      </Route>

      {/* Client onboarding — no shell (standalone flow) */}
      {/* Clinicians who land here after role selection get redirected to /dashboard */}
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <OnboardingGuard />
          </ProtectedRoute>
        }
      />

      {/* Public signing page */}
      <Route path="/sign/:packageId" element={<SigningPage />} />

      {/* Public setup wizard — no auth required */}
      <Route path="/setup-wizard" element={<SetupWizardPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ReauthProvider>
          <AppRoutes />
          {/* HIPAA: Re-auth modal for sensitive actions (signing, discharge, etc.) */}
          <ReauthModal />
        </ReauthProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
