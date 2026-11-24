import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MealEditor } from "@/components/dashboard/MealEditor";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import type { DailySummary } from "@/lib/api-schemas";
import { MealTimeDialog } from "./MealTimeDialog";
import { sessionDay } from "@/lib/session-state";

type MealItem = { id: string; item: string; quantidade: string; horario: string };

export function MealCorrectionList({
  meals,
  onSelect,
}: {
  meals: DailySummary["refeicoes"];
  onSelect: (item: MealItem) => void;
}) {
  return meals.length ? (
    <ul className="space-y-3">
      {meals.map((meal, index) => (
        <li key={`${meal.hora}-${index}`} className="rounded-xl border border-border p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{meal.hora}</p>
            <MealTimeDialog meal={meal} />
          </div>
          <ul className="space-y-2">
            {meal.itens.map((item, itemIndex) => (
              <li key={item.id ?? itemIndex} className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words text-sm">{item.item} ({item.quantidade})</span>
                {item.id && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-9 shrink-0"
                    onClick={() => onSelect({ id: item.id!, item: item.item, quantidade: item.quantidade, horario: meal.hora })}
                    aria-label={`Corrigir ${item.item} das ${meal.hora}`}
                  >
                    Corrigir
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-sm text-muted-foreground">Nenhuma refeição registrada hoje.</p>
  );
}

export function MealCorrectionDialog({ meals, date }: { meals: DailySummary["refeicoes"]; date?: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MealItem | null>(null);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) setEditing(null);
    }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="self-start">
          Corrigir uma refeição salva
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] min-w-0 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Corrigir refeição salva</DialogTitle>
          <DialogDescription>Selecione um item para corrigir alimento, quantidade, dia e horário, ou remover.</DialogDescription>
        </DialogHeader>
        <MealCorrectionList meals={meals} onSelect={setEditing} />
        {editing && (
          <MealEditor
            key={editing.id}
            id={editing.id}
            initialItem={editing.item}
            initialQuantity={editing.quantidade}
            initialDate={date ?? sessionDay()}
            initialTime={editing.horario}
            onDone={() => {
              setEditing(null);
              void queryClient.invalidateQueries({ queryKey: ["daily-summary"] });
              void queryClient.invalidateQueries({ queryKey: ["meals-for-day"] });
              void queryClient.invalidateQueries({ queryKey: ["weekly-summary"] });
              void queryClient.invalidateQueries({ queryKey: ["weekly-meals"] });
              void queryClient.invalidateQueries({ queryKey: ["health-context"] });
              void queryClient.invalidateQueries({ queryKey: ["dated-records"] });
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}