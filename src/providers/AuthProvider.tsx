import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
  type AuthUser,
  type Credentials,
} from "@/lib/api";
import { AuthContext, type AuthContextValue } from "@/providers/auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const expire = () => {
      setUser(null);
      queryClient.clear();
      void navigate({ to: "/login", search: { expired: "1" } });
    };
    window.addEventListener("health:unauthorized", expire);
    return () => window.removeEventListener("health:unauthorized", expire);
  }, [navigate, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login: async (credentials) => {
        const next = await loginRequest(credentials);
        setUser(next);
        await queryClient.clear();
        return next;
      },
      register: async (credentials) => {
        const next = await registerRequest(credentials);
        setUser(next);
        await queryClient.clear();
        return next;
      },
      logout: async () => {
        await logoutRequest();
        setUser(null);
        await queryClient.clear();
        void navigate({ to: "/login" });
      },
    }),
    [loading, navigate, queryClient, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
