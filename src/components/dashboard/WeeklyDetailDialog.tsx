import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, XAxis, YAxis } from "recharts";
import { Activity, Droplet, Moon, Scale, TrendingUp, Utensils } from "lucide-react";
import { getWeeklySummary } from "@/lib/api";
import { type WeeklySummary } from "@/lib/api-schemas";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

export type WeeklyMetric = "agua" | "refeicoes" | "exercicio" | "sono" | "peso";

const metricDetails = {
  agua: {
    title: "Hidratação",
    description: "Volume de água registrado por dia",
    dataKey: "agua_ml",
    unit: "ml",
    icon: Droplet,
  },
  refeicoes: {
    title: "Refeições",
    description: "Quantidade de refeições registradas por dia",
    dataKey: "refeicoes",
    unit: "",
    icon: Utensils,
  },
  exercicio: {
    title: "Exercício",
    description: "Tempo de atividade registrado por dia",
    dataKey: "exercicio_min",
    unit: "min",
    icon: Activity,
  },
  sono: {
    title: "Sono",
    description: "Duração total e fases do sono registradas",
    dataKey: "sono_horas",
    unit: "h",
    icon: Moon,
  },
  peso: {
    title: "Peso",
    description: "Último peso registrado em cada dia",
    dataKey: "peso_kg",
    unit: "kg",
    icon: Scale,
  },
} as const;

const chartConfig = {
  value: { label: "Valor", color: "var(--primary)" },
  total: { label: "Sono total", color: "var(--foreground)" },
  profundo: { label: "Profundo", color: "#6366f1" },
  leve: { label: "Leve", color: "#38bdf8" },
  rem: { label: "REM", color: "#a78bfa" },
  acordado: { label: "Acordado", color: "#f59e0b" },
} satisfies ChartConfig;

function shortDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit" })
    .format(new Date(`${value}T12:00:00`))
    .replace(".", "");
}

function periodDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" })
    .format(new Date(`${value}T12:00:00`))
    .replace(".", "");
}

function chartDays(data: WeeklySummary) {
  return data.dias.map((day) => ({ ...day, label: shortDate(day.data) }));
}

function MetricChart({ metric, data }: { metric: WeeklyMetric; data: WeeklySummary }) {
  const details = metricDetails[metric];
  const days = chartDays(data);

  if (metric === "sono") {
    return (
      <ChartContainer config={chartConfig} className="h-64 w-full">
        <ComposedChart data={days} margin={{ left: -14, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={36} unit="h" />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Legend />
          <Bar
            dataKey="sono_profundo_horas"
            name="Profundo"
            stackId="fases"
            fill="var(--color-profundo)"
            radius={[0, 0, 3, 3]}
          />
          <Bar dataKey="sono_leve_horas" name="Leve" stackId="fases" fill="var(--color-leve)" />
          <Bar dataKey="sono_rem_horas" name="REM" stackId="fases" fill="var(--color-rem)" />
          <Bar
            dataKey="acordado_horas"
            name="Acordado"
            stackId="fases"
            fill="var(--color-acordado)"
            radius={[3, 3, 0, 0]}
          />
          <Line
            dataKey="sono_horas"
            name="Sono total"
            type="monotone"
            stroke="var(--color-total)"
            strokeWidth={2.5}
            connectNulls
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ChartContainer>
    );
  }

  if (metric === "peso") {
    return (
      <ChartContainer config={chartConfig} className="h-64 w-full">
        <ComposedChart data={days} margin={{ left: -8, right: 10, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} unit="kg" />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line
            dataKey={details.dataKey}
            name={details.title}
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={3}
            connectNulls
            dot={{ r: 4, fill: "var(--color-value)" }}
          />
        </ComposedChart>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-64 w-full">
      <BarChart data={days} margin={{ left: -10, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={42} unit={details.unit} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar
          dataKey={details.dataKey}
          name={details.title}
          fill="var(--color-value)"
          radius={[6, 6, 2, 2]}
        />
      </BarChart>
    </ChartContainer>
  );
}

export function WeeklyDetailDialog({
  metric,
  onOpenChange,
}: {
  metric: WeeklyMetric | null;
  onOpenChange: (open: boolean) => void;
}) {
  const weekly = useQuery({
    queryKey: ["weekly-summary"],
    queryFn: getWeeklySummary,
    enabled: metric !== null,
    staleTime: 60_000,
  });
  const details = metric ? metricDetails[metric] : null;
  const Icon = details?.icon;

  return (
    <Dialog open={metric !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto rounded-2xl p-5 sm:p-6">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="flex items-center gap-2">
            {Icon && <Icon className="size-5 text-primary" />}
            {details?.title} — últimos 7 dias
          </DialogTitle>
          <DialogDescription>{details?.description}</DialogDescription>
        </DialogHeader>

        {weekly.isLoading || !metric ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : weekly.isError || !weekly.data ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
            Não foi possível carregar o detalhamento semanal. Feche e tente novamente.
          </div>
        ) : (
          <>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {periodDate(weekly.data.periodo.inicio)} a {periodDate(weekly.data.periodo.fim)}
            </p>
            <div className="rounded-xl border border-border bg-card p-2 sm:p-3">
              <MetricChart metric={metric} data={weekly.data} />
            </div>
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <TrendingUp className="size-4 text-primary" />
                Análise da semana
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {weekly.data.tendencias[metric]}
              </p>
            </div>
          </>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" className="w-full sm:w-auto">
              Fechar
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
