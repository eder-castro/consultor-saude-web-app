import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MealSummaryList } from "@/components/dashboard/MealSummaryList";
import { MealCorrectionDialog } from "./MealCorrectionDialog";
import { getApiErrorMessage, getMealsForDay } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function MealDayDetails({ date }: { date: string }) {
  const [retrying, setRetrying] = useState(false);
  const meals = useQuery({
    queryKey: ["meals-for-day", date],
    queryFn: () => getMealsForDay(date),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const heading = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(`${date}T12:00:00`));

  function retry() {
    setRetrying(true);
    void meals.refetch().then(
      () => setRetrying(false),
      () => setRetrying(false),
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-live="polite">
      <h3 className="mb-3 text-sm font-semibold capitalize">Refeições de {heading}</h3>
      {meals.isPending || retrying ? (
        <div role="status" className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {retrying ? "Tentando carregar novamente as refeições deste dia..." : "Carregando refeições do dia..."}
          </p>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-48" />
        </div>
      ) : meals.isError ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-destructive">
            Não foi possível carregar as refeições: {getApiErrorMessage(meals.error)}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={retry}>
            Tentar novamente
          </Button>
        </div>
      ) : meals.data.data !== date ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-destructive">
            As refeições recebidas não correspondem ao dia selecionado. Tente novamente.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={retry}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <MealSummaryList meals={meals.data.refeicoes} emptyMessage="Nenhuma refeição registrada neste dia." />
          {!!meals.data.refeicoes.length && <MealCorrectionDialog meals={meals.data.refeicoes} date={date} />}
        </div>
      )}
    </section>
  );
}