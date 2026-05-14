import { useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { saveRecords } from "@/lib/api";
import type { EventoTipo, Item, ValidationPayload } from "@/lib/api-schemas";
import { toast } from "sonner";

const TIPO_LABEL: Record<EventoTipo, string> = {
  alimentacao: "Refeição detectada",
  hidratacao: "Hidratação",
  exercicio: "Exercício",
  sono: "Sono",
  peso: "Peso",
  outro: "Registro",
};

type Props = {
  payload: ValidationPayload;
  status: "pending" | "saved" | "discarded";
  onResolved: (status: "saved" | "discarded") => void;
};

export function ValidationCard({ payload, status, onResolved }: Props) {
  const [items, setItems] = useState<Item[]>(payload.itens);
  const [saving, setSaving] = useState(false);
  const readonly = status !== "pending";

  function update(id: string, patch: Partial<Item>) {
    setItems((s) => s.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }
  function remove(id: string) {
    setItems((s) => s.filter((i) => i.id !== id));
  }
  function add() {
    setItems((s) => [
      ...s,
      {
        id: Math.random().toString(36).slice(2, 10),
        item: "",
        quantidade_estimada: "",
        confirmado: true,
      },
    ]);
  }

  async function confirm() {
    const selected = items.filter((i) => i.confirmado && i.item.trim());
    if (selected.length === 0) {
      toast.error("Marque ao menos um item para salvar.");
      return;
    }
    setSaving(true);
    try {
      await saveRecords({ evento_tipo: payload.evento_tipo, itens: selected });
      toast.success(`${selected.length} item(s) salvos.`);
      onResolved("saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {TIPO_LABEL[payload.evento_tipo]}
          </p>
          {payload.resumo && (
            <p className="mt-0.5 text-sm text-foreground/80">{payload.resumo}</p>
          )}
        </div>
        {status === "saved" && (
          <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-xs text-primary">
            <Check className="size-3" /> Salvo
          </span>
        )}
        {status === "discarded" && (
          <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
            Descartado
          </span>
        )}
      </div>

      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2">
            <Checkbox
              checked={it.confirmado}
              disabled={readonly}
              onCheckedChange={(v) => update(it.id, { confirmado: !!v })}
              className="size-5 shrink-0"
            />
            <Input
              value={it.item}
              disabled={readonly}
              onChange={(e) => update(it.id, { item: e.target.value })}
              placeholder="Item"
              className="h-9 flex-1 bg-background"
            />
            <Input
              value={it.quantidade_estimada}
              disabled={readonly}
              onChange={(e) => update(it.id, { quantidade_estimada: e.target.value })}
              placeholder="Qtd"
              className="h-9 w-24 bg-background"
            />
            {!readonly && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => remove(it.id)}
                className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>

      {!readonly && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={add}
            className="mt-2 h-8 text-muted-foreground"
          >
            <Plus className="size-4" /> Adicionar item
          </Button>

          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={saving}
              onClick={() => onResolved("discarded")}
            >
              <X className="size-4" /> Descartar
            </Button>
            <Button className="flex-1" disabled={saving} onClick={confirm}>
              <Check className="size-4" /> {saving ? "Salvando..." : "Confirmar"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
