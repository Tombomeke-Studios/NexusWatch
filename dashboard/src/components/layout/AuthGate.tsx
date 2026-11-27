/** Shows the login screen instead of the app while the collector wants a password (NW_DASHBOARD_PASSWORD). */
import type { ReactNode } from 'react';
import { useAuth } from '@/api/queries';
import { LoginPage } from '@/pages/Login';

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.isPending) return null;
  // No answer about auth (network trouble): show the app, whose own requests report the problem.
  if (auth.data?.required && !auth.data.authenticated) return <LoginPage />;
  return <>{children}</>;
}
