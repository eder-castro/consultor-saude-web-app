import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/providers/AuthProvider";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/login" });
  }, [loading, navigate, user]);
  if (loading) return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><div className="h-2 w-20 animate-pulse rounded-full bg-primary/40" /></div>;
  return user ? <>{children}</> : null;
}