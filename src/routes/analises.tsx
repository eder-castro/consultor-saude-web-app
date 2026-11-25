import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, BookOpen } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage, getSavedAnalyses } from "@/lib/api";
import { useAuth } from "@/providers/auth-context";
import { AnalysisText } from "@/components/chat/AnalysisText";

export const Route = createFileRoute("/analises")({
  head: () => ({
    meta: [
      { title: "Análises anteriores — Consultor de Saúde" },
      { name: "description", content: "Consulte análises anteriores dos seus registros confirmados." },
    ],
  }),
  component: ProtectedAnalysesPage,
});

function saoPauloToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function previousDay(date: string) {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

function ProtectedAnalysesPage() {
  return <ProtectedRoute><AnalysesPage /></ProtectedRoute>;
}

function AnalysesPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(() => previousDay(saoPauloToday()));
  const today = saoPauloToday();
  const analyses = useQuery({
    queryKey: ["saved-analyses", user?.id, date],
    queryFn: () => getSavedAnalyses(date),
    enabled: Boolean(user?.id) && Boolean(date),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  return (
    <AppShell title="Análises anteriores">
      <div className="h-full min-w-0 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-2xl space-y-4 pb-[env(safe-area-inset-bottom)]">
          <Link to="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Voltar ao Dia
          </Link>
          <section className="rounded-2xl border border-border bg-card p-4 sm:p-6">
            <div className="mb-4 flex items-start gap-3">
              <BookOpen className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h2 className="font-semibold">Análises dos registros confirmados</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Escolha a data em que a análise foi registrada. O chat continua mostrando só as mensagens de hoje.
                </p>
              </div>
            </div>
            <label htmlFor="analysis-date" className="block text-sm font-medium">Data da análise</label>
            <input
              id="analysis-date"
              type="date"
              value={date}
              max={today}
              onChange={(event) => setDate(event.target.value)}
              className="mt-2 min-h-11 w-full max-w-xs rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </section>

          {!date ? (
            <p className="text-sm text-muted-foreground">Selecione uma data para consultar as análises.</p>
          ) : analyses.isPending ? (
            <div role="status" className="space-y-3">
              <span className="sr-only">Carregando análises salvas.</span>
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
            </div>
          ) : analyses.isError ? (
            <section role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm">Não foi possível carregar as análises: {getApiErrorMessage(analyses.error)}</p>
              <Button
                className="mt-3"
                variant="outline"
                size="sm"
                disabled={analyses.isFetching}
                onClick={() => void analyses.refetch()}
              >
                {analyses.isFetching ? "Tentando novamente..." : "Tentar novamente"}
              </Button>
            </section>
          ) : analyses.data.data !== date ? (
            <p role="alert" className="text-sm text-destructive">
              A resposta não corresponde à data selecionada. Tente novamente.
            </p>
          ) : analyses.data.analises.length === 0 ? (
            <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
              Nenhuma análise salva nesta data.
            </p>
          ) : (
            <ol className="space-y-3">
              {analyses.data.analises.map((entry) => (
                <li key={entry.id} className="rounded-2xl border border-border bg-card p-4">
                  <time dateTime={entry.created_at} className="text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("pt-BR", {
                      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit",
                    }).format(new Date(entry.created_at))}
                  </time>
                  <AnalysisText className="mt-2" text={entry.texto} />
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </AppShell>
  );
}