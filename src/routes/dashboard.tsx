import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { generateDailyReport, getDailySummary } from "@/lib/api";
import { Activity, Droplet, Moon, Scale, Utensils, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard do Dia — Consultor de Saúde" },
      { name: "description", content: "Acompanhe água, refeições, exercício, sono e peso do dia." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["daily-summary"],
    queryFn: getDailySummary,
    refetchOnWindowFocus: true,
  });
  const report = useMutation({
    mutationFn: generateDailyReport,
    onSuccess: () => toast.success("Relatório do dia gerado."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha no relatório."),
  });

  return (
    <AppShell title="Dashboard do Dia">
      <div className="h-full overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {isLoading || !data ? (
            <>
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-40 w-full rounded-2xl" />
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="h-24 rounded-2xl" />
                <Skeleton className="h-24 rounded-2xl" />
                <Skeleton className="h-24 rounded-2xl" />
              </div>
            </>
          ) : (
            <>
              <Card>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Droplet className="size-4 text-primary" />
                    <span className="text-sm font-medium">Hidratação</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {data.agua_ml} / {data.agua_meta_ml} ml
                  </span>
                </div>
                <Progress value={Math.min(100, (data.agua_ml / data.agua_meta_ml) * 100)} />
              </Card>

              <Card>
                <div className="mb-3 flex items-center gap-2">
                  <Utensils className="size-4 text-primary" />
                  <span className="text-sm font-medium">Refeições</span>
                </div>
                {data.refeicoes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nada registrado ainda hoje.</p>
                ) : (
                  <ul className="space-y-3">
                    {data.refeicoes.map((r, i) => (
                      <li key={i} className="border-l-2 border-primary/40 pl-3">
                        <p className="text-xs text-muted-foreground">{r.hora}</p>
                        <p className="text-sm">
                          {r.itens.map((it) => `${it.item} (${it.quantidade})`).join(", ")}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <div className="grid grid-cols-3 gap-3">
                <MiniCard
                  icon={<Activity className="size-4" />}
                  label="Exercício"
                  value={data.exercicio ?? "—"}
                />
                <MiniCard
                  icon={<Moon className="size-4" />}
                  label="Sono"
                  value={data.sono_horas !== null ? `${data.sono_horas}h` : "—"}
                />
                <MiniCard
                  icon={<Scale className="size-4" />}
                  label="Peso"
                  value={data.peso_kg !== null ? `${data.peso_kg} kg` : "—"}
                />
              </div>

              {data.tendencia && (
                <Card>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Tendência
                  </p>
                  <p className="mt-1 text-sm">{data.tendencia}</p>
                </Card>
              )}

              <Button
                size="lg"
                className="mt-2"
                disabled={report.isPending}
                onClick={() => {
                  report.mutate();
                  qc.invalidateQueries({ queryKey: ["daily-summary"] });
                }}
              >
                <FileText className="size-4" />
                {report.isPending ? "Gerando..." : "Gerar relatório do dia"}
              </Button>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-card p-4">{children}</div>;
}

function MiniCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1.5 truncate text-sm font-medium" title={value}>
        {value}
      </p>
    </div>
  );
}
