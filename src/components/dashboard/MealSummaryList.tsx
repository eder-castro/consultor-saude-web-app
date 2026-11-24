import type { DailySummary } from "@/lib/api-schemas";
import { MealTimeDialog } from "./MealTimeDialog";

export function MealSummaryList({
  meals,
  emptyMessage,
}: {
  meals: DailySummary["refeicoes"];
  emptyMessage: string;
}) {
  if (!meals.length) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul className="space-y-3">
      {meals.map((meal, index) => (
        <li key={`${meal.hora}-${index}`} className="border-l-2 border-primary/40 pl-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <time className="text-xs text-muted-foreground" dateTime={meal.hora}>{meal.hora}</time>
            <MealTimeDialog meal={meal} />
          </div>
          <ul className="space-y-1">
            {meal.itens.map((item, itemIndex) => (
              <li key={item.id ?? itemIndex} className="break-words text-sm">
                {item.item} ({item.quantidade})
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}