import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { getApiErrorMessage, updateMealTime } from "@/lib/api";
import type { DailySummary } from "@/lib/api-schemas";

export function MealTimeDialog({ meal }: { meal: DailySummary["refeicoes"][number] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(meal.hora);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!meal.itens.length || meal.itens.some((item) => !item.id)) return null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError("Informe um horário válido.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateMealTime(meal.itens.map((item) => item.id!), time);
      setOpen(false);
      toast.success("Horário da refeição corrigido.");
      await Promise.all(
        ["daily-summary", "meals-for-day", "weekly-summary", "weekly-meals", "health-context"]
          .map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      );
    } catch (cause) {
      setError(getApiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (busy) return;
      setOpen(next);
      if (next) { setTime(meal.hora); setError(null); }
    }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={`Editar horário da refeição das ${meal.hora}`}>
          Editar horário
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar horário da refeição</DialogTitle>
          <DialogDescription>
            Horário salvo: {meal.hora}. Informe quando você comeu, não quando enviou a mensagem.
            A data, os alimentos e as quantidades não serão alterados.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void save(event)} className="space-y-4">
          <ul className="space-y-1 text-sm">
            {meal.itens.map((item) => <li key={item.id}>{item.item} ({item.quantidade})</li>)}
          </ul>
          <label className="block space-y-2 text-sm">
            <span>Horário em que você comeu</span>
            <Input type="time" required value={time} disabled={busy} onChange={(event) => setTime(event.target.value)} />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || time === meal.hora}>{busy ? "Salvando..." : "Salvar horário"}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
