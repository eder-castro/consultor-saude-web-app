import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDailyAnalysisSummary } from "@/lib/api";
import { saoPauloDay } from "@/lib/daily-analysis-summary";
import { useAuth } from "@/providers/auth-context";
import { Button } from "@/components/ui/button";

function shortDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" })
    .format(new Date(`${value}T12:00:00`));
}

function duration(value: number | null) {
  if (value === null) return "sem registro";
  const minutes = Math.round(value);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}min`;
}

export function DailyAnalysisSummaryNotice() {
  const { user } = useAuth();
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setToday(saoPauloDay());
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const context = useQuery({
    queryKey: ["daily-analysis-summary", user?.id, today],
    queryFn: getDailyAnalysisSummary,
    enabled: !!user?.id && !!today,
    staleTime: Infinity,
    retry: 1,
  });

  if (!today || context.isPending) {
    // Warm the daily context without making opening the chat look like a
    // blocking analysis. The backend still requires context before analyzing.
    return null;
  }
  if (!context.data || context.data.para_dia !== today) {
    return (
      <div className="rounded-xl border border-border bg-card/50 p-3 text-sm" aria-live="polite">
        <p>O contexto dos sete dias não carregou. Seus registros podem ser salvos, mas a análise precisa deste contexto.</p>
        <Button size="sm" variant="outline" className="mt-2" disabled={context.isFetching}
          onClick={() => void context.refetch()}>
          {context.isFetching ? "Carregando contexto..." : "Tentar carregar contexto"}
        </Button>
      </div>
    );
  }
  const snapshot = context.data;
  return (
    <details className="max-w-2xl rounded-xl border border-border bg-card/40 p-3 text-sm">
      <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Contexto de hoje: {shortDate(snapshot.periodo.inicio)} a {shortDate(snapshot.periodo.fim)}
      </summary>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Resumo fixo dos sete dias anteriores. A análise usa este contexto, mas comenta somente o novo envio.
        Os registros salvos hoje complementam este contexto e são consultados novamente a cada análise.
        A base dos sete dias é atualizada na virada do dia, no horário de São Paulo.
      </p>
      {snapshot.origem === "primeiro_uso" && <p className="mt-2 text-xs text-muted-foreground">
        O resumo de hoje ainda não existia e foi criado no primeiro acesso. Ele ficará fixo até a próxima virada do dia.
      </p>}
      <ul className="mt-3 space-y-3">
        {snapshot.resumo.dias.map((day) => (
          <li key={day.data} className="rounded-lg bg-muted/40 p-2 text-xs leading-relaxed">
            <p className="font-medium">{shortDate(day.data)} — {day.refeicoes} refeições registradas</p>
            <p className="text-muted-foreground">
              Água: {day.agua_ml === null ? "sem registro" : `${day.agua_ml} ml`}
              {" · "}Exercício: {duration(day.exercicio_min)}
              {" · "}Sono: {duration(day.sono_min)}
              {" · "}Peso: {day.peso_kg === null ? "sem registro" : `${day.peso_kg} kg`}
            </p>
            {day.alimentos.length > 0 && <p className="mt-1 break-words">
              {day.alimentos.map((food) => `${food.item} (${food.ocorrencias}×)`).join(", ")}
              {day.alimentos_omitidos > 0 && `; mais ${day.alimentos_omitidos} alimentos distintos não listados`}
            </p>}
            {day.atividades.length > 0 && <p className="mt-1 break-words">
              Atividades: {day.atividades.map((activity) => `${activity.tipo} (${activity.ocorrencias}×)`).join(", ")}
              {day.atividades_omitidas > 0 && `; mais ${day.atividades_omitidas} tipos não listados`}
            </p>}
            {day.avisos.map((warning, index) => <p key={index} className="mt-1 text-muted-foreground">{warning}</p>)}
          </li>
        ))}
      </ul>
    </details>
  );
}