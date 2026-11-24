import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { clearSessionState } from "@/lib/session-state";
import { persistSessionQueries, restoreSessionQueries } from "@/lib/session-query-cache";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const stopQueryPersistence = useRef<(() => void) | null>(null);
  const clearPrivateState = useCallback(() => {
    // Stop before query teardown: observer removal also emits cache events,
    // which could otherwise recreate storage after logout cleared it.
    stopQueryPersistence.current?.();
    stopQueryPersistence.current = null;
    queryClient.clear();
    clearSessionState();
  }, [queryClient]);

  useEffect(() => {
    getCurrentUser()
      .then((next) => {
        restoreSessionQueries(queryClient, next.id);
        setUser(next);
      })
      .catch(() => {
        clearSessionState();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [queryClient]);

  useEffect(() => {
    if (!user) return;
    const stop = persistSessionQueries(queryClient, user.id);
    stopQueryPersistence.current = stop;
    return () => {
      stop();
      if (stopQueryPersistence.current === stop) stopQueryPersistence.current = null;
    };
  }, [queryClient, user]);

  useEffect(() => {
    const expire = () => {
      setUser(null);
      clearPrivateState();
      void navigate({ to: "/login", search: { expired: "1" } });
    };
    window.addEventListener("health:unauthorized", expire);
    return () => window.removeEventListener("health:unauthorized", expire);
  }, [navigate, clearPrivateState]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login: async (credentials) => {
        const next = await loginRequest(credentials);
        clearPrivateState();
        setUser(next);
        return next;
      },
      register: async (credentials) => {
        const next = await registerRequest(credentials);
        clearPrivateState();
        setUser(next);
        return next;
      },
      logout: async () => {
        await logoutRequest();
        clearPrivateState();
        setUser(null);
        void navigate({ to: "/login" });
      },
    }),
    [loading, navigate, clearPrivateState, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
