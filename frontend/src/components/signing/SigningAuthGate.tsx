import { useAuth } from "../../hooks/useAuth";
import { AuthModal } from "../AuthModal";
import { LoadingSpinner } from "../LoadingSpinner";
import type { ReactNode } from "react";

interface SigningAuthGateProps {
  children: ReactNode;
}

export function SigningAuthGate({ children }: SigningAuthGateProps) {
  const { user, loading } = useAuth();

  if (loading) return <LoadingSpinner />;

  if (!user) {
    return (
      <div className="min-h-screen bg-warm-50 flex flex-col items-center justify-center p-4">
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl font-bold text-warm-800 mb-2">
            Sign Your Documents
          </h1>
          <p className="text-warm-500">
            Please sign in to access your documents.
          </p>
        </div>
        <AuthModal mode="client" onClose={() => {}} />
      </div>
    );
  }

  return <>{children}</>;
}
