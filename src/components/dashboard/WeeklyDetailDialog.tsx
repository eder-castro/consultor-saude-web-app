import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { useId, useState } from "react";
import { WeightHistoryChart } from "./WeightHistoryChart";
import { sleepClockHours, weightDomain } from "@/lib/health-chart-format";
import { Activity, Droplet, Moon, Scale, TrendingUp, Utensils } from "lucide-react";
import { getWeeklyMeals, getWeeklySummary } from "@/lib/api";
import { MealDayDetails } from "@/components/dashboard/MealDayDetails";
import { SavedSleepEditor } from "@/components/dashboard/SavedSleepEditor";
import { type WeeklyMeals, type WeeklySummary } from "@/lib/api-schemas";
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
    description: "Quantidade por dia. Selecione um dia para ver horários e itens registrados.",
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

function chartDays(data: WeeklySummary | WeeklyMeals) {
  return data.dias.map((day) => ({ ...day, label: shortDate(day.data) }));
}

function formatSleepDuration(value: unknown) {
  return sleepClockHours(value);
}

const LEVELS = {
  baixo: { label: "Baixo" },
  normal: { label: "Normal" },
  alto: { label: "Alto" },
  desconhecido: { label: "Sem classificação" },
  misto: { label: "Níveis diferentes no dia" },
};
const PHASES = [
  { key: "profundo", dataKey: "sono_profundo_horas", label: "Profundo" },
  { key: "leve", dataKey: "sono_leve_horas", label: "Leve" },
  { key: "rem", dataKey: "sono_rem_horas", label: "REM" },
  { key: "acordado", dataKey: "acordado_horas", label: "Acordado" },
] as const;

function SleepPattern({ id, color, level }: {
  id: string; color: string; level: keyof typeof LEVELS;
}) {
  return (
    <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill={color} />
      {level === "normal" && <path d="M-2 2L2 -2M0 8L8 0M6 10L10 6"
        stroke="#101014" strokeOpacity={0.65} strokeWidth={1.5} />}
      {level === "baixo" && <circle cx="4" cy="4" r="1.5" fill="#101014" fillOpacity={0.7} />}
      {level === "desconhecido" && <path d="M0 0H8V8"
        stroke="#101014" strokeOpacity={0.65} strokeWidth={1.5} strokeDasharray="2 2" />}
      {level === "misto" && <path d="M0 0L8 8M0 8L8 0"
        stroke="#101014" strokeOpacity={0.65} strokeWidth={1.5} />}
    </pattern>
  );
}

function dayLevel(day: unknown, phase: string): keyof typeof LEVELS {
  const value = (day as { sono_niveis?: Record<string, string> })?.sono_niveis?.[phase];
  return value && value in LEVELS ? value as keyof typeof LEVELS : "desconhecido";
}

function hydrationTicks(days: ReturnType<typeof chartDays>) {
  const maximum = Math.max(0, ...days.map((day) => "agua_ml" in day ? day.agua_ml : 0));
  const upperBound = Math.max(250, Math.ceil(maximum / 250) * 250);
  return Array.from({ length: upperBound / 250 + 1 }, (_, index) => index * 250);
}

function MetricChart({
  metric, data, onMealDaySelect,
}: {
  metric: WeeklyMetric;
  data: WeeklySummary | WeeklyMeals;
  onMealDaySelect?: (date: string) => void;
}) {
  const details = metricDetails[metric];
  const patternId = useId().replace(/:/g, "");
  const days = chartDays(data);
  const waterTicks = metric === "agua" ? hydrationTicks(days) : undefined;

  if (metric === "sono") {
    return (
      <div className="min-w-0 max-w-full">
        <div className="mb-2 grid grid-cols-2 justify-items-start gap-x-3 gap-y-1 px-1 text-[10px] text-muted-foreground min-[390px]:flex min-[390px]:flex-wrap min-[390px]:justify-center min-[390px]:text-[11px]">
          {[...PHASES.map((phase) => chartConfig[phase.key]), chartConfig.total].map(({ label, color }) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1 whitespace-nowrap ${
                label === "Sono total" ? "col-span-2 justify-self-center" : ""
              }`}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
              {label}
            </span>
          ))}
        </div>
        <div className="mb-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          {Object.entries(LEVELS).filter(([level]) =>
            level !== "misto" || days.some((day) => PHASES.some((phase) => dayLevel(day, phase.key) === "misto"))
          ).map(([level, config]) => (
            <span key={level} className="inline-flex items-center gap-1">
              <svg width="16" height="12" aria-hidden="true" className="shrink-0 rounded-sm">
                <defs>
                  <SleepPattern id={`${patternId}-legend-${level}`} color="#979797" level={level as keyof typeof LEVELS} />
                </defs>
                <rect width="16" height="12" fill={`url(#${patternId}-legend-${level})`} />
              </svg>
              {level === "normal" ? "Normal / médio" : level === "misto" ? "Misto" : config.label}
            </span>
          ))}
        </div>
        <p className="mb-2 text-center text-xs text-muted-foreground">
          Cores por fase; texturas por nível.
          Linha: sono total, sem tempo acordado.
        </p>
        <ChartContainer config={chartConfig} className="h-60 min-w-0 max-w-full overflow-hidden">
          <ComposedChart data={days} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
            <defs>
              {PHASES.flatMap((phase) => Object.keys(LEVELS).map((level) => (
                <SleepPattern key={`${phase.key}-${level}`} id={`${patternId}-${phase.key}-${level}`}
                  color={chartConfig[phase.key].color} level={level as keyof typeof LEVELS} />
              )))}
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={7}
              height={32}
              minTickGap={24}
              tick={{ fontSize: 10 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={54}
              tick={{ fontSize: 10 }}
              tickFormatter={formatSleepDuration}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name, entry) => (
                    <>
                      <span className="text-muted-foreground">
                        {name}
                        {PHASES.find((phase) => phase.label === name) &&
                          ` · ${LEVELS[dayLevel(entry.payload, PHASES.find((phase) => phase.label === name)!.key)].label}`}
                      </span>
                      <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
                        {formatSleepDuration(value)}
                      </span>
                    </>
                  )}
                />
              }
            />
            {PHASES.map((phase) => (
              <Bar key={phase.key} dataKey={phase.dataKey} name={phase.label}
                stackId="sleep-phases" maxBarSize={38} radius={0}
                stroke="var(--card)" strokeWidth={1}>
                {days.map((day) => <Cell key={`${day.data}-${phase.key}`}
                  fill={`url(#${patternId}-${phase.key}-${dayLevel(day, phase.key)})`} />)}
              </Bar>
            ))}
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
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer">Ver durações e classificações</summary>
          <ul className="mt-2 space-y-3">
            {days.map((day) => (
              <li key={day.data}>
                <strong>{periodDate(day.data)}</strong>
                {PHASES.map((phase) => <p key={phase.key}>
                  {phase.label}: {formatSleepDuration((day as Record<string, unknown>)[phase.dataKey])}
                  {" · "}{LEVELS[dayLevel(day, phase.key)].label}
                </p>)}
              </li>
            ))}
          </ul>
        </details>
      </div>
    );
  }

  if (metric === "peso") {
    return (
      <ChartContainer config={chartConfig} className="h-60 min-w-0 max-w-full overflow-hidden">
        <ComposedChart data={days} margin={{ left: 8, right: 10, top: 8, bottom: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={7}
            height={32}
            minTickGap={24}
            tick={{ fontSize: 10 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            domain={weightDomain(days.map((day) => "peso_kg" in day ? day.peso_kg : null))}
            unit="kg"
            tick={{ fontSize: 10 }}
          />
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
    <ChartContainer config={chartConfig} className="h-60 min-w-0 max-w-full overflow-hidden">
      <BarChart data={days} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={7}
          height={32}
          minTickGap={24}
          tick={{ fontSize: 10 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          unit={metric === "exercicio" ? undefined : details.unit}
          tickFormatter={metric === "exercicio" ? (value) => sleepClockHours(Number(value) / 60) : undefined}
          tick={{ fontSize: 10 }}
          domain={waterTicks ? [0, waterTicks[waterTicks.length - 1]] : undefined}
          ticks={waterTicks}
        />
        <ChartTooltip content={<ChartTooltipContent
          formatter={metric === "exercicio" ? (value) => <span className="font-mono">{sleepClockHours(Number(value) / 60)}</span> : undefined}
        />} />
        <Bar
          dataKey={details.dataKey}
          name={details.title}
          fill="var(--color-value)"
          radius={[6, 6, 2, 2]}
          cursor={metric === "refeicoes" ? "pointer" : undefined}
          onClick={metric === "refeicoes" ? (_entry, index) => {
            if (days[index]) onMealDaySelect?.(days[index].data);
          } : undefined}
        />
      </BarChart>
    </ChartContainer>
  );
}

function MealDayPicker({
  data, selectedDate, onSelect,
}: {
  data: WeeklySummary | WeeklyMeals;
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Selecionar dia para ver refeições">
      {data.dias.map((day) => {
        const fullDate = new Intl.DateTimeFormat("pt-BR", {
          weekday: "long", day: "numeric", month: "long", year: "numeric",
        }).format(new Date(`${day.data}T12:00:00`));
        return (
          <button
            key={day.data}
            type="button"
            onClick={() => onSelect(day.data)}
            aria-label={`Ver refeições de ${fullDate}: ${day.refeicoes} registradas`}
            aria-pressed={selectedDate === day.data}
            aria-controls="meal-day-details"
            className="flex min-h-11 min-w-0 flex-col items-center justify-center rounded-lg border border-border px-0.5 py-1 text-[11px] leading-tight transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-primary/10"
          >
            <span className="truncate">{shortDate(day.data)}</span>
            <span className="font-semibold tabular-nums">{day.refeicoes}</span>
          </button>
        );
      })}
    </div>
  );
}

export function WeeklyDetailDialog({
  metric,
  onOpenChange,
}: {
  metric: WeeklyMetric | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [selectedMealDate, setSelectedMealDate] = useState<string | null>(null);
  const weekly = useQuery({
    queryKey: ["weekly-summary"],
    queryFn: getWeeklySummary,
    enabled: metric !== null && metric !== "refeicoes" && metric !== "peso",
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const mealWeek = useQuery({
    queryKey: ["weekly-meals"],
    queryFn: getWeeklyMeals,
    enabled: metric === "refeicoes",
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const selectedWeek = metric === "refeicoes" ? mealWeek : weekly;
  const activeMealDate = metric === "refeicoes" &&
    mealWeek.data?.dias.some((day) => day.data === selectedMealDate) ? selectedMealDate : null;
  const details = metric ? metricDetails[metric] : null;
  const Icon = details?.icon;

  return (
    <Dialog open={metric !== null} onOpenChange={(open) => {
      if (!open) setSelectedMealDate(null);
      onOpenChange(open);
    }}>
      <DialogContent className="inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] top-auto max-h-[calc(100dvh_-_max(1.5rem,env(safe-area-inset-bottom)))] min-w-0 w-auto max-w-none translate-x-0 translate-y-0 gap-3 overflow-x-hidden overflow-y-auto rounded-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:max-h-[90dvh] sm:w-[calc(100%_-_3rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:gap-4 sm:p-6">
        <DialogHeader className="min-w-0 pr-8 text-left">
          <DialogTitle className="flex min-w-0 items-start gap-2 leading-snug">
            {Icon && <Icon className="mt-0.5 size-5 shrink-0 text-primary" />}
            <span className="min-w-0">{details?.title} — {metric === "peso" ? "evolução por período" : "últimos 7 dias"}</span>
          </DialogTitle>
          <DialogDescription className="pr-2">{details?.description}</DialogDescription>
        </DialogHeader>

        {metric === "peso" ? <WeightHistoryChart /> : selectedWeek.isLoading || !metric ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : selectedWeek.isError || !selectedWeek.data ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
            Não foi possível carregar o detalhamento semanal. Feche e tente novamente.
          </div>
        ) : (
          <>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {periodDate(selectedWeek.data.periodo.inicio)} a {periodDate(selectedWeek.data.periodo.fim)}
            </p>
            <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card p-1.5 sm:p-3">
              <MetricChart metric={metric} data={selectedWeek.data} onMealDaySelect={setSelectedMealDate} />
            </div>
            {metric === "refeicoes" && (
              <div className="space-y-3">
                <MealDayPicker
                  data={selectedWeek.data}
                  selectedDate={activeMealDate}
                  onSelect={setSelectedMealDate}
                />
                <div id="meal-day-details">
                  {activeMealDate ? (
                    <MealDayDetails key={activeMealDate} date={activeMealDate} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Selecione um dos sete dias para ver as refeições salvas.
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <TrendingUp className="size-4 text-primary" />
                Análise da semana
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {metric === "refeicoes"
                  ? mealWeek.data?.tendencia
                  : weekly.data?.tendencias[metric]}
              </p>
            </div>
          </>
        )}
        {metric === "sono" && <SavedSleepEditor />}

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
