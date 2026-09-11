import { FormEvent, useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/providers/auth-context";
import { authMessage } from "@/lib/auth-errors";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar — Meu Dia" },
      { name: "description", content: "Seu espaço privado para cuidar do dia." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && user) void navigate({ to: "/" });
  }, [loading, navigate, user]);

  if (!loading && user) return null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!email || password.length < 8) {
      setError("Informe um e-mail válido e uma senha com pelo menos 8 caracteres.");
      return;
    }
    setBusy(true);
    try {
      await login({ email, password });
      await navigate({ to: "/" });
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const expired =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("expired");
  return (
    <main className="min-h-[100dvh] min-w-0 overflow-x-hidden bg-background px-[max(1.25rem,env(safe-area-inset-left))] pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-foreground md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,430px)] md:gap-20 md:px-16">
      <section className="mx-auto flex min-w-0 max-w-xl flex-col justify-center py-6 md:py-0">
        <div className="mb-8 flex items-center gap-3 text-primary sm:mb-12">
          <div className="grid size-10 place-items-center rounded-2xl bg-primary/15">
            <Sparkles className="size-5" />
          </div>
          <span className="font-semibold tracking-tight">meu dia</span>
        </div>
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.22em] text-primary">
          Um lugar só seu
        </p>
        <h1 className="max-w-lg text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-4xl md:text-6xl">
          Cuide do que você sente, um dia de cada vez.
        </h1>
        <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground">
          Registre alimentação, movimento, sono e como você está. Com calma, privacidade e sem
          julgamentos.
        </p>
      </section>
      <section className="mx-auto flex min-w-0 w-full max-w-md items-center">
        <form
          onSubmit={submit}
          className="min-w-0 w-full rounded-[1.75rem] border border-border bg-card/80 p-5 shadow-elegant backdrop-blur sm:p-6 md:p-8"
        >
          <div className="mb-8">
            <div className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <LockKeyhole className="size-5" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Que bom ver você.</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {expired
                ? "Sua sessão terminou. Entre novamente para continuar."
                : "Entre para continuar seu cuidado diário."}
            </p>
          </div>
          <div className="space-y-4">
            <label className="block text-sm font-medium">
              E-mail
              <Input
                data-testid="input-email"
                suppressHydrationWarning
                className="mt-2 h-11 bg-background"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@exemplo.com"
              />
            </label>
            <label className="block text-sm font-medium">
              Senha
              <Input
                data-testid="input-password"
                suppressHydrationWarning
                className="mt-2 h-11 bg-background"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="mínimo de 8 caracteres"
                minLength={8}
              />
            </label>
          </div>
          {error && (
            <p
              data-testid="status-auth-error"
              role="alert"
              className="mt-4 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <Button data-testid="button-submit-auth" className="mt-6 h-11 w-full" disabled={busy}>
            {busy ? "Aguarde..." : "Entrar no meu dia"}
            <ArrowRight />
          </Button>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Acesso somente para contas previamente autorizadas.
          </p>
        </form>
      </section>
    </main>
  );
}
