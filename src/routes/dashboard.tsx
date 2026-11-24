import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { QueryRefreshNotice } from "@/components/QueryRefreshNotice";
import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { WeeklyDetailDialog, type WeeklyMetric } from "@/components/dashboard/WeeklyDetailDialog";
import { MealSummaryList } from "@/components/dashboard/MealSummaryList";
import { MealCorrectionDialog } from "@/components/dashboard/MealCorrectionDialog";
import { WaterHistoryDialog } from "@/components/dashboard/WaterHistoryDialog";
import { RecordDateDialog } from "@/components/dashboard/RecordDateDialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage, getDailySummary, getSleepReviews } from "@/lib/api";
import { Activity, BookOpen, Droplet, Moon, Scale, Utensils } from "lucide-react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard do Dia — Consultor de Saúde" },
      { name: "description", content: "Acompanhe água, refeições, exercício, sono e peso do dia." },
    ],
  }),
  component: ProtectedDashboardPage,
});

function ProtectedDashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardPage />
    </ProtectedRoute>
  );
}

export function DashboardPage() {
  const [weeklyMetric, setWeeklyMetric] = useState<WeeklyMetric | null>(null);
  const summary = useQuery({
    queryKey: ["daily-summary"],
    queryFn: () => getDailySummary(),
    refetchOnWindowFocus: true,
  });
  const sleepReviews = useQuery({
    queryKey: ["sleep-reviews"],
    queryFn: getSleepReviews,
    refetchOnWindowFocus: true,
  });
  return (
    <AppShell title="Dashboard do Dia">
      <div className="h-full min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4">
        <div className="mx-auto flex min-w-0 max-w-2xl flex-col gap-3 pb-[env(safe-area-inset-bottom)]">
          <Link
            to="/analises"
            className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BookOpen className="size-4 text-primary" /> Consultar análises anteriores
          </Link>
          <RecordDateDialog />
          <QueryRefreshNotice query={summary} />
          {summary.isError && !summary.data ? (
            <section role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
              <h2 className="text-sm font-semibold">Não foi possível carregar o resumo do dia.</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {getApiErrorMessage(summary.error)}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={summary.isFetching}
                onClick={() => void summary.refetch()}
              >
                {summary.isFetching ? "Tentando novamente..." : "Tentar novamente"}
              </Button>
            </section>
          ) : summary.isPending ? (
            <>
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-40 w-full rounded-2xl" />
              <div className="grid min-w-0 grid-cols-3 gap-2 sm:gap-3">
                <Skeleton className="h-24 rounded-2xl" />
                <Skeleton className="h-24 rounded-2xl" />
                <Skeleton className="h-24 rounded-2xl" />
              </div>
            </>
          ) : (
            <>
              {sleepReviews.data && sleepReviews.data.length > 0 && (
                <Card>
                  <div className="flex items-start gap-3">
                    <Moon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        Há registros antigos de sono para revisar
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        Confira os valores salvos e informe o total correto antes de consolidar.
                      </p>
                      <Link
                        to="/perfil"
                        className="mt-3 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
                      >
                        Revisar registros de sono
                      </Link>
                    </div>
                  </div>
                </Card>
              )}
              <button
                type="button"
                className="rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setWeeklyMetric("agua")}
              >
                <Card interactive>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Droplet className="size-4 text-primary" />
                      <span className="text-sm font-medium">Hidratação</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {summary.data.agua_ml} / {summary.data.agua_meta_ml} ml
                    </span>
                  </div>
                  <Progress value={Math.min(100, (summary.data.agua_ml / summary.data.agua_meta_ml) * 100)} />
                  <p className="mt-2 text-xs text-muted-foreground">Toque para ver a semana</p>
                </Card>
              </button>
              <WaterHistoryDialog />

                <Card>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                    <Utensils className="size-4 text-primary" />
                    <span className="text-sm font-medium">Refeições</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setWeeklyMetric("refeicoes")}>
                      Ver semana
                    </Button>
                  </div>
                  <MealSummaryList meals={summary.data.refeicoes} emptyMessage="Nada registrado ainda hoje." />
                </Card>
                <MealCorrectionDialog meals={summary.data.refeicoes} />

              <div className="grid min-w-0 grid-cols-3 gap-2 sm:gap-3">
                <MiniCard
                  icon={<Activity className="size-4" />}
                  label="Exercício"
                  value={summary.data.exercicio ?? "—"}
                  onClick={() => setWeeklyMetric("exercicio")}
                />
                <MiniCard
                  icon={<Moon className="size-4" />}
                  label="Sono"
                  value={summary.data.sono_horas !== null ? formatSleepHours(summary.data.sono_horas) : "—"}
                  onClick={() => setWeeklyMetric("sono")}
                />
                <MiniCard
                  icon={<Scale className="size-4" />}
                  label="Peso"
                  value={summary.data.peso_kg !== null ? `${summary.data.peso_kg} kg` : "—"}
                  onClick={() => setWeeklyMetric("peso")}
                />
              </div>

              {summary.data.tendencia && (
                <Card>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Tendência
                  </p>
                  <p className="mt-1 text-sm">{summary.data.tendencia}</p>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
      <WeeklyDetailDialog
        metric={weeklyMetric}
        onOpenChange={(open) => {
          if (!open) setWeeklyMetric(null);
        }}
      />
    </AppShell>
  );
}

function formatSleepHours(hours: number) {
  const totalMinutes = Math.round(hours * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${wholeHours}h ${minutes}min` : `${wholeHours}h`;
}

function Card({
  children,
  interactive = false,
}: {
  children: React.ReactNode;
  interactive?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-border bg-card p-4 ${
        interactive ? "transition-colors hover:border-primary/40 hover:bg-accent/30" : ""
      }`}
    >
      {children}
    </div>
  );
}

function MiniCard({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-0 rounded-2xl border border-border bg-card p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-3"
      aria-label={`Ver detalhes semanais de ${label}`}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="min-w-0 truncate text-xs">{label}</span>
      </div>
      <p className="mt-1.5 truncate text-sm font-medium" title={value}>
        {value}
      </p>
      <span className="mt-1 block text-[10px] text-muted-foreground">Ver semana</span>
    </button>
  );
}
