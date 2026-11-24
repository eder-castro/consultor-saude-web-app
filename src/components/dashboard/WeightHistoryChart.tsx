import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { getApiErrorMessage, getWeightHistory, type WeightPeriod } from "@/lib/api";
import { sessionDay } from "@/lib/session-state";
import { weightDomain } from "@/lib/health-chart-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { QueryRefreshNotice } from "@/components/QueryRefreshNotice";

export function WeightHistoryChart() {
  const [period, setPeriod] = useState<WeightPeriod>("semana");
  const [selection, setSelection] = useState(() => {
    const today = sessionDay();
    return { semana: today, dia: today, mes: today.slice(0, 7), ano: today.slice(0, 4) };
  });
  const date = period === "dia" || period === "semana" ? selection[period]
    : period === "mes" ? `${selection.mes}-01` : `${selection.ano}-01-01`;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T12:00:00Z`)) &&
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
  const query = useQuery({
    queryKey: ["weight-history", period, date],
    queryFn: () => getWeightHistory(period, date),
    enabled: validDate,
  });
  const recordedPoints = query.data?.pontos ?? [];
  const periodPoints = period === "semana" && query.data
    ? Array.from({ length: 7 }, (_, index) => {
      const day = new Date(`${query.data.periodo.inicio}T12:00:00Z`);
      day.setUTCDate(day.getUTCDate() + index);
      const date = day.toISOString().slice(0, 10);
      return recordedPoints.find((point) => point.data === date) ??
        { data: date, horario: null, peso_kg: null };
    }) : recordedPoints;
  const points = periodPoints.map((point) => ({
    ...point,
    label: period === "dia" ? point.horario?.slice(0, 5) ?? "Sem horário"
      : new Intl.DateTimeFormat("pt-BR", period === "semana" ? { weekday: "short", day: "2-digit" }
        : period === "mes" ? { day: "2-digit" } : { month: "short" })
        .format(new Date(`${point.data}T12:00:00`)),
  }));

  return (
    <section className="min-w-0 space-y-4" aria-label="Histórico de peso">
      <div role="group" aria-label="Período do peso" className="grid grid-cols-4 gap-2">
        {(["semana", "dia", "mes", "ano"] as const).map((value) => (
          <Button key={value} variant={period === value ? "default" : "outline"}
            aria-pressed={period === value} onClick={() => setPeriod(value)}>
            {value === "semana" ? "Semana" : value === "dia" ? "Dia" : value === "mes" ? "Mês" : "Ano"}
          </Button>
        ))}
      </div>
      <label className="block space-y-2 text-sm">
        <span>{period === "semana" ? "Semana encerrada em" : period === "dia" ? "Selecionar dia" : period === "mes" ? "Selecionar mês" : "Selecionar ano"}</span>
        <Input
          type={period === "dia" || period === "semana" ? "date" : period === "mes" ? "month" : "number"}
          min={period === "ano" ? 1900 : period === "mes" ? "1900-01" : "1900-01-01"}
          max={period === "ano" ? 9999 : undefined}
          value={selection[period]}
          onChange={(event) => {
            setSelection((current) => ({ ...current, [period]: event.target.value }));
          }}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {period === "semana" ? "Última pesagem de cada dia nos últimos 7 dias." :
          period === "dia" ? "Todas as pesagens do dia, por horário." :
          period === "mes" ? "Última pesagem registrada em cada dia do mês." :
            "Última pesagem registrada em cada mês do ano."}
        {" "}Eixo vertical com faixa mínima de 5 kg. Não são calculadas médias.
      </p>
      {validDate && query.data && <p className="text-xs text-muted-foreground">
        {query.data.periodo.inicio.split("-").reverse().join("/")} a {query.data.periodo.fim.split("-").reverse().join("/")}
      </p>}
      <QueryRefreshNotice query={query} />
      {!validDate ? <p>Selecione uma data ou período válido.</p> : query.isPending ? <p role="status">Carregando peso...</p> :
        query.isError && !query.data ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>{getApiErrorMessage(query.error)}</p>
            <Button variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button>
          </div>
        ) : !recordedPoints.length ? <p>Nenhum peso registrado neste período.</p> : (
          <>
            <ChartContainer config={{ peso: { label: "Peso", color: "var(--primary)" } }}
              className="h-60 min-w-0 w-full">
              <ComposedChart data={points} margin={{ left: 8, right: 10, top: 8, bottom: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} minTickGap={20} />
                <YAxis domain={weightDomain(points.map((point) => point.peso_kg))}
                  allowDataOverflow width={64} tickLine={false} axisLine={false}
                  tickFormatter={(value) => `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`}
                  tick={{ fontSize: 10 }} />
                <ChartTooltip content={<ChartTooltipContent
                  labelFormatter={(_label, entries) => {
                    const point = entries[0]?.payload;
                    return point ? `${point.data.split("-").reverse().join("/")} · ${point.horario?.slice(0, 5) ?? "Sem horário"}` : "";
                  }}
                  formatter={(value) => <span className="font-mono">{Number(value).toLocaleString("pt-BR")} kg</span>}
                />} />
                <Line dataKey="peso_kg" name="Peso" stroke="var(--color-peso)" strokeWidth={3}
                  type="linear" connectNulls dot={{ r: 4 }} />
              </ComposedChart>
            </ChartContainer>
            <details className="text-sm">
              <summary className="cursor-pointer">Ver valores do período</summary>
              <ul className="mt-2 space-y-1">
                {recordedPoints.map((point, index) => <li key={`${point.data}-${index}`}>
                  {point.data.split("-").reverse().join("/")} {point.horario?.slice(0, 5)} — {point.peso_kg.toLocaleString("pt-BR")} kg
                </li>)}
              </ul>
            </details>
          </>
        )}
    </section>
  );
}
