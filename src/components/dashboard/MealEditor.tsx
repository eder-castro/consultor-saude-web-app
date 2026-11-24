import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteMeal, updateMeal } from "@/lib/api";

export function MealEditor({
  id, initialItem, initialQuantity, initialDate, initialTime, onDone,
}: {
  id: string;
  initialItem: string;
  initialQuantity: string;
  initialDate: string;
  initialTime: string;
  onDone: () => void;
}) {
  const [item, setItem] = useState(initialItem);
  const [quantity, setQuantity] = useState(initialQuantity);
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function save() {
    if (!item.trim() || !quantity.trim() || !date || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      toast.error("Preencha o item, a quantidade, a data e o horário.");
      return;
    }
    setBusy(true);
    try {
      await updateMeal(id, item.trim(), quantity.trim(), { data: date, horario: time });
      toast.success("Item corrigido.");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível corrigir o item.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteMeal(id);
      toast.success("Item removido.");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível remover o item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-primary/30 bg-background p-3">
      <p className="text-sm font-medium">Corrigir item salvo</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1 text-sm">
          <span>Dia do registro</span>
          <Input type="date" value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Horário do registro</span>
          <Input type="time" value={time} disabled={busy} onChange={(event) => setTime(event.target.value)} />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span>Alimento ou bebida</span>
        <Input value={item} maxLength={200} disabled={busy} onChange={(event) => setItem(event.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Quantidade — use “não informado” se não souber</span>
        <Input value={quantity} maxLength={100} disabled={busy} onChange={(event) => setQuantity(event.target.value)} />
      </label>
      {confirmRemove && (
        <p className="text-sm text-destructive" role="alert">
          Remover este item apagará o registro salvo. Esta ação não pode ser desfeita.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save()}>Salvar correção</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onDone}>Cancelar</Button>
        {confirmRemove ? (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>
            Confirmar remoção
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRemove(true)}>
            Remover item duplicado
          </Button>
        )}
      </div>
    </div>
  );
}