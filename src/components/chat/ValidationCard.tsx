import { useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { saveRecords } from "@/lib/api";
import type { EventoTipo, Item, ValidationGroup, ValidationPayload } from "@/lib/api-schemas";
import { toast } from "sonner";

const TIPO_LABEL: Record<EventoTipo, string> = {
  alimentacao: "Alimentação",
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
  const [saveError, setSaveError] = useState<string | null>(null);
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
    setSaveError(null);
    try {
      await saveRecords({ grupos: selectedGroups });
      toast.success(`${selectedCount} item(s) salvos.`);
      onResolved("saved");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha ao salvar.";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm uppercase tracking-wider text-muted-foreground">
            Registros detectados
          </p>
        </div>
        {status === "saved" && (
          <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-xs text-primary">
            <Check className="size-3" /> Salvo
          </span>
        )}
        {status === "pending" && (
          <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">
            Revise antes de confirmar
          </span>
        )}
        {status === "discarded" && (
          <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
            Descartado
          </span>
        )}
      </div>

      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.evento_tipo} className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              {TIPO_LABEL[group.evento_tipo]}
            </h3>
            <ul className="space-y-3">
              {group.itens.map((it) => (
                <li
                  key={it.id}
                  className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_7rem_auto] sm:gap-3"
                >
                  <Checkbox
                    checked={it.confirmado}
                    disabled={readonly}
                    onCheckedChange={(v) => update(group.evento_tipo, it.id, { confirmado: !!v })}
                    className="size-6 shrink-0"
                  />
                  <Input
                    value={it.item}
                    disabled={readonly}
                    onChange={(e) => update(group.evento_tipo, it.id, { item: e.target.value })}
                    placeholder="Item"
                    className="h-11 min-w-0 bg-background text-base"
                  />
                  <Input
                    value={it.quantidade_estimada}
                    disabled={readonly}
                    onChange={(e) =>
                      update(group.evento_tipo, it.id, { quantidade_estimada: e.target.value })
                    }
                    placeholder="Qtd"
                    className="col-start-2 h-11 min-w-0 bg-background text-base sm:col-start-auto sm:w-28"
                  />
                  {!readonly && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => remove(group.evento_tipo, it.id)}
                      className="col-start-3 row-start-1 size-11 shrink-0 text-muted-foreground hover:text-destructive sm:col-start-auto sm:row-start-auto"
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
                className="h-10 text-base text-muted-foreground"
              >
                <Plus className="size-4" /> Adicionar item
              </Button>
            )}
          </section>
        ))}
      </div>

      {payload.resumo && (
        <section className="mt-6 border-t border-border/60 pt-5">
          <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Análise
          </p>
          <p className="mt-2 text-base leading-relaxed text-foreground/80">{payload.resumo}</p>
        </section>
      )}

      {saveError && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Não foi possível salvar ainda. {saveError}
        </p>
      )}

      {!readonly && (
        <>
          <div className="mt-5 flex flex-col gap-2 min-[380px]:flex-row min-[380px]:gap-3">
            <Button
              variant="outline"
              className="h-11 flex-1 text-base"
              disabled={saving}
              onClick={() => onResolved("discarded")}
            >
              <X className="size-4" /> Descartar
            </Button>
            <Button className="h-11 flex-1 text-base" disabled={saving} onClick={confirm}>
              <Check className="size-4" /> {saving ? "Salvando..." : "Confirmar"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
