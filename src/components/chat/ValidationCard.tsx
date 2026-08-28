import { useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { saveRecords } from "@/lib/api";
import type { EventoTipo, Item, ValidationGroup, ValidationPayload } from "@/lib/api-schemas";
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
  const [groups, setGroups] = useState<ValidationGroup[]>(payload.grupos);
  const [saving, setSaving] = useState(false);
  const readonly = status !== "pending";

  function update(groupType: EventoTipo, id: string, patch: Partial<Item>) {
    setGroups((current) =>
      current.map((group) =>
        group.evento_tipo === groupType
          ? {
              ...group,
              itens: group.itens.map((item) => (item.id === id ? { ...item, ...patch } : item)),
            }
          : group,
      ),
    );
  }
  function remove(groupType: EventoTipo, id: string) {
    setGroups((current) =>
      current.map((group) =>
        group.evento_tipo === groupType
          ? { ...group, itens: group.itens.filter((item) => item.id !== id) }
          : group,
      ),
    );
  }
  function add(groupType: EventoTipo) {
    setGroups((current) =>
      current.map((group) =>
        group.evento_tipo === groupType
          ? {
              ...group,
              itens: [
                ...group.itens,
                {
                  id: Math.random().toString(36).slice(2, 10),
                  item: "",
                  quantidade_estimada: "",
                  confirmado: true,
                },
              ],
            }
          : group,
      ),
    );
  }

  async function confirm() {
    const selectedGroups = groups
      .map((group) => ({
        ...group,
        itens: group.itens.filter((item) => item.confirmado && item.item.trim()),
      }))
      .filter((group) => group.itens.length > 0);
    const selectedCount = selectedGroups.reduce((total, group) => total + group.itens.length, 0);
    if (selectedCount === 0) {
      toast.error("Marque ao menos um item para salvar.");
      return;
    }
    setSaving(true);
    try {
      await saveRecords({ grupos: selectedGroups });
      toast.success(`${selectedCount} item(s) salvos.`);
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
            Registros detectados
          </p>
          {payload.resumo && <p className="mt-0.5 text-sm text-foreground/80">{payload.resumo}</p>}
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

      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.evento_tipo} className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">
              {TIPO_LABEL[group.evento_tipo]}
            </h3>
            <ul className="space-y-2">
              {group.itens.map((it) => (
                <li key={it.id} className="flex items-center gap-2">
                  <Checkbox
                    checked={it.confirmado}
                    disabled={readonly}
                    onCheckedChange={(v) => update(group.evento_tipo, it.id, { confirmado: !!v })}
                    className="size-5 shrink-0"
                  />
                  <Input
                    value={it.item}
                    disabled={readonly}
                    onChange={(e) => update(group.evento_tipo, it.id, { item: e.target.value })}
                    placeholder="Item"
                    className="h-9 flex-1 bg-background"
                  />
                  <Input
                    value={it.quantidade_estimada}
                    disabled={readonly}
                    onChange={(e) =>
                      update(group.evento_tipo, it.id, { quantidade_estimada: e.target.value })
                    }
                    placeholder="Qtd"
                    className="h-9 w-24 bg-background"
                  />
                  {!readonly && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => remove(group.evento_tipo, it.id)}
                      className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {!readonly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => add(group.evento_tipo)}
                className="h-8 text-muted-foreground"
              >
                <Plus className="size-4" /> Adicionar item
              </Button>
            )}
          </section>
        ))}
      </div>

      {!readonly && (
        <>
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
