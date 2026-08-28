import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ApiError, getCurrentUser, login as loginRequest, logout as logoutRequest, register as registerRequest, type AuthUser, type Credentials } from "@/lib/api";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (credentials: Credentials) => Promise<AuthUser>;
  register: (credentials: Credentials) => Promise<AuthUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

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

  const value = useMemo<AuthContextValue>(() => ({
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
  }), [loading, navigate, queryClient, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return value;
}

export function authMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "E-mail ou senha inválidos.";
    if (error.status === 403) return "Este e-mail ainda não foi convidado.";
    if (error.status === 409) return "Este e-mail já está cadastrado.";
    return error.message;
  }
  if (error instanceof TypeError) return "Não foi possível conectar agora. Confira sua conexão e tente novamente.";
  return "Não foi possível concluir. Tente novamente.";
}