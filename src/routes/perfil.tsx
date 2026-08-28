import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-context";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

export const Route = createFileRoute("/perfil")({
  head: () => ({
    meta: [
      { title: "Perfil — Consultor de Saúde" },
      { name: "description", content: "Consulte sua conta e encerre sua sessão com segurança." },
    ],
  }),
  component: ProtectedPerfilPage,
});

function ProtectedPerfilPage() {
  return (
    <ProtectedRoute>
      <PerfilPage />
    </ProtectedRoute>
  );
}

function PerfilPage() {
  const { user, logout } = useAuth();

  return (
    <AppShell title="Perfil">
      <div className="h-full overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <section className="rounded-2xl border border-border bg-card p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Sua conta</p>
            <h2 className="mt-2 text-lg font-semibold">{user?.email}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Seus registros são privados e ficam associados apenas a esta conta.
            </p>
            <Button variant="outline" className="mt-5" onClick={() => void logout()}>
              Encerrar sessão
            </Button>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
