import { useCallback, useRef, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { ReviewItemRow } from "./ReviewItemRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ExerciseReview } from "@/components/chat/ExerciseReview";
import { ApiError, getApiErrorMessage, saveRecords } from "@/lib/api";
import { useSleepConflictReview } from "./useSleepConflictReview";
import {
  ExercicioDetailsSchema,
  type EventoTipo,
  type Item,
  type SavedRecordRef,
  type ValidationGroup,
  type ValidationPayload,
} from "@/lib/api-schemas";
import { parseExerciseDurationSeconds } from "@/lib/exercise-duration";
import { formatSleepDuration, parseSleepClock, sleepDurationForReview, sleepDurationForStorage, sleepStageMismatch } from "@/lib/sleep-duration";
import { toast } from "sonner";

const TIPO_LABEL: Record<EventoTipo, string> = {
  alimentacao: "Alimentação",
  hidratacao: "Hidratação",
  exercicio: "Exercício",
  sono: "Sono",
  peso: "Peso",
  outro: "Registro",
};

const SLEEP_PHASES = [
  { field: "sono_profundo_min", label: "Sono profundo" },
  { field: "sono_leve_min", label: "Sono leve" },
  { field: "sono_rem_min", label: "Sono REM" },
  { field: "acordado_min", label: "Acordado" },
] as const satisfies ReadonlyArray<{ field: keyof Item; label: string }>;

function prepareGroupsForReview(groups: ValidationGroup[]): ValidationGroup[] {
  return groups.map((group) => {
    if (group.evento_tipo === "exercicio") {
      return {
        ...group,
        itens: group.itens.map((item) => {
          const hasReviewedDuration = item.exercicio !== undefined &&
            item.exercicio !== null &&
            Object.prototype.hasOwnProperty.call(item.exercicio, "duracao_segundos");
          if (hasReviewedDuration) return item;
          const legacyDuration = parseExerciseDurationSeconds(item.quantidade_estimada);
          return legacyDuration === null ? item : {
            ...item,
            exercicio: { ...(item.exercicio ?? {}), duracao_segundos: legacyDuration },
          };
        }),
      };
    }
    return group.evento_tipo !== "sono" ? group : ({
      ...group,
      itens: group.itens.map((item) => ({
        ...item,
        quantidade_estimada: sleepDurationForReview(item.quantidade_estimada),
        sono_profundo_min: sleepDurationForReview(item.sono_profundo_min),
        sono_leve_min: sleepDurationForReview(item.sono_leve_min),
        sono_rem_min: sleepDurationForReview(item.sono_rem_min),
        acordado_min: sleepDurationForReview(item.acordado_min),
      })),
    });
  });
}

type Props = {
  operationId: string;
  payload: ValidationPayload;
  status: "pending" | "saved" | "discarded";
  onResolved: (status: "saved" | "discarded", reviewedGroups?: ValidationGroup[], recordRefs?: SavedRecordRef[]) => void;
  onEdited?: (groups: ValidationGroup[]) => void;
};

export function ValidationCard({ operationId, payload, status, onResolved, onEdited }: Props) {
  const [groups, setLocalGroups] = useState<ValidationGroup[]>(() => prepareGroupsForReview(payload.grupos));
  const draftRef = useRef(groups);
  function setGroups(update: ValidationGroup[] | ((current: ValidationGroup[]) => ValidationGroup[])) {
    const next = typeof update === "function" ? update(draftRef.current) : update;
    draftRef.current = next;
    setLocalGroups(next);
    if (status === "pending") onEdited?.(next);
  }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [durationError, setDurationError] = useState<string | null>(null);
  const [invalidExerciseDurations, setInvalidExerciseDurations] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const readonly = status !== "pending";
  const sleepReview = useSleepConflictReview(groups, !readonly);

  const setExerciseDurationValidity = useCallback((id: string, valid: boolean) => {
    setInvalidExerciseDurations((current) => {
      if (current.has(id) === !valid) return current;
      const next = new Set(current);
      if (valid) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function update(groupIndex: number, id: string, patch: Partial<Item>) {
    setDurationError(null);
    setGroups((current) =>
      current.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              itens: group.itens.map((item) => (item.id === id ? { ...item, ...patch } : item)),
            }
          : group,
      ),
    );
  }
  function updateGroup(groupIndex: number, patch: Partial<ValidationGroup>) {
    setGroups((current) =>
      current.map((group, index) => (index === groupIndex ? { ...group, ...patch } : group)),
    );
  }
  function remove(groupIndex: number, id: string) {
    setEditingId(null);
    setRemovingId(null);
    setGroups((current) =>
      current.map((group, index) =>
        index === groupIndex
          ? { ...group, itens: group.itens.filter((item) => item.id !== id) }
          : group,
      ),
    );
  }
  function add(groupIndex: number) {
    const id = Math.random().toString(36).slice(2, 10);
    setRemovingId(null);
    setEditingId(id);
    setGroups((current) =>
      current.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              itens: [
                ...group.itens,
                {
                  id,
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
    setDurationError(null);
    setEditingId(null);
    setRemovingId(null);
    if (sleepReview.blocked) return;
    const invalidDate = groups.some((group) => !/^\d{4}-\d{2}-\d{2}$/.test(group.data ?? ""));
    if (invalidDate) {
      toast.error("Confira a data do registro antes de salvar.");
      return;
    }
    const invalidMealTime = groups.some(
      (group) =>
        group.evento_tipo === "alimentacao" &&
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(group.horario ?? ""),
    );
    if (invalidMealTime) {
      toast.error("Confira o horário da refeição antes de salvar.");
      return;
    }
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
    const invalidSleep = selectedGroups.some((group) =>
      group.evento_tipo === "sono" && group.itens.some((item) =>
        !parseSleepClock(item.quantidade_estimada) ||
        SLEEP_PHASES.some(({ field }) => {
          const value = item[field];
          return value !== null && value !== undefined && value.trim() !== "" &&
            parseSleepClock(value) === null;
        }),
      ),
    );
    if (invalidSleep) {
      const message = "Confira as durações do sono em hh:mm (ex.: 07:30). O total deve ser maior que 00:00.";
      setDurationError(message);
      toast.error(message);
      return;
    }
    if (selectedGroups.some((group) =>
      group.evento_tipo === "sono" && group.itens.some((item) => sleepStageMismatch(item) !== null)
    )) {
      const message = "A soma das fases dormidas difere do total de sono. Corrija o total ou as fases antes de salvar.";
      setDurationError(message);
      toast.error(message);
      return;
    }
    const invalidExercise = selectedGroups.some((group) =>
      group.evento_tipo === "exercicio" && group.itens.some((item) =>
        invalidExerciseDurations.has(item.id) ||
        (item.exercicio != null && !ExercicioDetailsSchema.safeParse(item.exercicio).success),
      ),
    );
    if (invalidExercise) {
      const message = "Confira a duração e os valores informados do exercício antes de salvar.";
      setDurationError(message);
      toast.error(message);
      return;
    }
    const normalizedGroups = selectedGroups.map((group) => group.evento_tipo !== "sono" ? group : ({
      ...group,
      itens: group.itens.map((item) => ({
        ...item,
        quantidade_estimada: sleepDurationForStorage(item.quantidade_estimada)!,
        sono_profundo_min: item.sono_profundo_min
          ? sleepDurationForStorage(item.sono_profundo_min) : null,
        sono_leve_min: item.sono_leve_min ? sleepDurationForStorage(item.sono_leve_min) : null,
        sono_rem_min: item.sono_rem_min ? sleepDurationForStorage(item.sono_rem_min) : null,
        acordado_min: item.acordado_min ? sleepDurationForStorage(item.acordado_min) : null,
      })),
    }));
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveRecords({ operation_id: operationId, grupos: normalizedGroups,
        sleep_replacements: sleepReview.replacements });
      toast.success(`${selectedCount} item(s) salvos.`);
      setGroups(selectedGroups);
      onResolved("saved", selectedGroups, saved.record_refs);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) sleepReview.refresh();
      const message = getApiErrorMessage(e);
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const formatDate = (value?: string | null) => (value ? value.split("-").reverse().join("/") : "sem data");

  return (
    <div className="min-w-0 overflow-hidden rounded-[20px] border border-border bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 pt-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Registros detectados
          </p>
          {status === "pending" && (
            <p className="mt-0.5 text-xs text-muted-foreground">Toque para corrigir · segure para remover</p>
          )}
          {status === "saved" && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Salvos. Para ver os dados atuais, abra Dia.
              {payload.grupos.some((group) => group.evento_tipo === "alimentacao") &&
                " Para corrigir uma refeição, use a seção Refeições."}
            </p>
          )}
        </div>
        {status === "saved" && (
          <span className="flex h-9 shrink-0 items-center gap-1 text-sm font-semibold text-primary">
            <Check className="size-4" strokeWidth={2.5} /> Salvo
          </span>
        )}
        {status === "discarded" && (
          <span className="flex h-9 shrink-0 items-center text-sm text-muted-foreground">Descartado</span>
        )}
        {status === "pending" && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Descartar"
              title="Descartar"
              className="size-11 rounded-full text-muted-foreground"
              disabled={saving}
              onClick={() => onResolved("discarded")}
            >
              <X className="size-5" />
            </Button>
            <Button
              type="button"
              className="h-11 rounded-full px-4 text-sm font-semibold"
              disabled={saving || sleepReview.blocked}
              onClick={confirm}
            >
              <Check className="size-4" strokeWidth={2.5} /> {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        )}
      </div>

      {status === "pending" && payload.avisos_extracao?.map((warning, index) => (
        <p key={index} role="alert" className="mt-3 rounded-xl bg-amber-100/10 p-3 text-sm text-foreground">
          {warning}
        </p>
      ))}

      <div className="mt-2">
        {groups.map((group, groupIndex) => {
          const simpleItems = group.evento_tipo !== "sono" && group.evento_tipo !== "exercicio";
          return (
          <section
            key={`${group.evento_tipo}-${group.data ?? "sem-data"}-${groupIndex}`}
            className="space-y-2 border-t border-border/60 py-3 first:border-t-0 first:pt-1"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {TIPO_LABEL[group.evento_tipo]}
              {readonly && ` · ${formatDate(group.data)}`}
              {readonly && group.evento_tipo === "alimentacao" && group.horario && ` · ${group.horario}`}
            </h3>
            {!readonly && group.data_imagem && (
              <p className="text-xs text-muted-foreground">
                Data lida na imagem: {formatDate(group.data_imagem)}.
                {group.data !== group.data_imagem && " Você escolheu uma data diferente; confira antes de salvar."}
              </p>
            )}
            {group.evento_tipo === "hidratacao" && group.itens.some((item) => item.total_diario) && (
              <p className="text-sm text-muted-foreground">
                Total de água do dia, não um novo copo. Ao confirmar, substitui o total informado anteriormente
                sem somar novamente a água já registrada.
              </p>
            )}
            {!readonly && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Input
                  type="date"
                  value={group.data ?? ""}
                  required
                  onChange={(event) => updateGroup(groupIndex, { data: event.target.value })}
                  className="h-9 w-auto min-w-0 rounded-full bg-background px-3 text-sm text-foreground"
                  aria-label={`Data de ${TIPO_LABEL[group.evento_tipo]}`}
                />
                {([0, -1] as const).map((offset) => (
                  <Button
                    key={offset}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-full px-3"
                    onClick={() => {
                      const day = new Date(`${today}T12:00:00Z`);
                      day.setUTCDate(day.getUTCDate() + offset);
                      updateGroup(groupIndex, { data: day.toISOString().slice(0, 10) });
                    }}
                  >
                    {offset === 0 ? "Hoje" : "Ontem"}
                  </Button>
                ))}
                {group.evento_tipo === "alimentacao" && (
                  <Input
                    type="time"
                    value={group.horario ?? ""}
                    required
                    aria-label="Horário da refeição"
                    onChange={(event) => updateGroup(groupIndex, { horario: event.target.value })}
                    className="h-9 w-auto min-w-0 rounded-full bg-background px-3 text-sm text-foreground"
                  />
                )}
              </div>
            )}
            <ul className={simpleItems ? "divide-y divide-border/50" : "space-y-3"}>
              {group.itens.map((it) => {
                if (simpleItems) {
                  return (
                    <ReviewItemRow
                      key={it.id}
                      item={it}
                      readonly={readonly}
                      mode={editingId === it.id ? "edit" : removingId === it.id ? "confirm-remove" : "view"}
                      quantityPlaceholder={group.evento_tipo === "peso" ? "Ex.: 93,7 kg" : "Ex.: 2 colheres"}
                      onEdit={() => { setRemovingId(null); setEditingId(it.id); }}
                      onDone={() => {
                        // Quem corrigiu o item quer salvá-lo: marca como incluído.
                        setEditingId(null);
                        if (it.item.trim() && !it.confirmado) update(groupIndex, it.id, { confirmado: true });
                      }}
                      onAskRemove={() => { setEditingId(null); setRemovingId(it.id); }}
                      onCancelRemove={() => setRemovingId(null)}
                      onRemove={() => remove(groupIndex, it.id)}
                      onChange={(patch) => update(groupIndex, it.id, patch)}
                    />
                  );
                }
                const isExercise = group.evento_tipo === "exercicio";
                const stageTotal = !readonly && group.evento_tipo === "sono" && it.confirmado && it.item.trim()
                  ? sleepStageMismatch(it) : null;
                return (
                <li key={it.id} className="space-y-2">
                  <div className={`grid min-w-0 items-center gap-2 sm:gap-3 ${
                    isExercise
                      ? "grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                      : "grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_7rem_auto]"
                  }`}>
                    <Checkbox
                      checked={it.confirmado}
                      disabled={readonly}
                      onCheckedChange={(v) => update(groupIndex, it.id, { confirmado: !!v })}
                      className="size-5 shrink-0 rounded-full"
                      aria-label={`Incluir ${it.item || "item"}`}
                    />
                    <Input
                      value={it.item}
                      disabled={readonly}
                      onChange={(e) => update(groupIndex, it.id, { item: e.target.value })}
                      placeholder="Item"
                      className="h-10 min-w-0 bg-background text-base"
                    />
                    {!isExercise && (
                      <Input
                        value={it.quantidade_estimada}
                        disabled={readonly}
                        onChange={(e) =>
                          update(groupIndex, it.id, { quantidade_estimada: e.target.value })
                        }
                        placeholder="hh:mm"
                        inputMode="numeric"
                        aria-label={`Duração de ${it.item || "sono"} em hh:mm`}
                        aria-invalid={it.confirmado && (!parseSleepClock(it.quantidade_estimada))}
                        className="col-start-2 h-10 min-w-0 bg-background text-base sm:col-start-auto sm:w-28"
                      />
                    )}
                    {!readonly && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remover ${it.item || "item"}`}
                        onClick={() => remove(groupIndex, it.id)}
                        className="col-start-3 row-start-1 size-11 shrink-0 text-muted-foreground hover:text-destructive sm:col-start-auto sm:row-start-auto"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                  {isExercise && (
                    <ExerciseReview
                      value={it.exercicio}
                      disabled={readonly}
                      testIdPrefix={`exercise-${it.id}`}
                      onChange={(exercicio) => update(groupIndex, it.id, { exercicio })}
                      onValidityChange={(valid) => setExerciseDurationValidity(it.id, valid)}
                    />
                  )}
                  {group.evento_tipo === "sono" && (
                    <div className="ml-7 grid gap-x-3 gap-y-2 sm:grid-cols-2">
                      {SLEEP_PHASES.map(({ field, label }) => (
                        <label
                          key={field}
                          className="grid grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-2 text-sm text-muted-foreground"
                        >
                          <span>{label}</span>
                          <Input
                            value={it[field] ?? ""}
                            disabled={readonly}
                            onChange={(e) =>
                              update(groupIndex, it.id, { [field]: e.target.value })
                            }
                            placeholder="hh:mm"
                            inputMode="numeric"
                            aria-label={`${label} em hh:mm`}
                            aria-invalid={it.confirmado && Boolean(it[field]) &&
                              parseSleepClock(it[field] ?? "") === null}
                            className="h-10 min-w-0 bg-background text-base text-foreground"
                          />
                        </label>
                      ))}
                      {(["profundo", "leve", "rem", "acordado"] as const).map((phase) => (
                        <label key={`level-${phase}`} className="grid grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-2 text-sm text-muted-foreground">
                          <span>Nível {phase === "rem" ? "REM" : phase}</span>
                          <select
                            aria-label={`Nível ${phase === "rem" ? "REM" : phase}`}
                            className="h-10 min-w-0 rounded-md border border-input bg-background px-2 text-foreground"
                            value={it.sono_niveis?.[phase] ?? ""}
                            disabled={readonly}
                            onChange={(event) => update(groupIndex, it.id, {
                              sono_niveis: { ...it.sono_niveis, [phase]: event.target.value || null } as Item["sono_niveis"],
                            })}
                          >
                            <option value="">Não informado</option>
                            <option value="baixo">Baixo</option>
                            <option value="normal">Normal</option>
                            <option value="alto">Alto</option>
                          </select>
                        </label>
                      ))}
                    </div>
                  )}
                  {group.evento_tipo === "sono" && !readonly && (
                    <p className="ml-7 text-xs text-muted-foreground">
                      Duração total e fases em hh:mm. Deixe fases não informadas vazias.
                    </p>
                  )}
                  {stageTotal !== null && (
                    <p role="alert" className="ml-7 text-sm text-destructive">
                      As fases dormidas somam {formatSleepDuration(stageTotal)}, mas o total é{" "}
                      {it.quantidade_estimada}. Corrija antes de salvar. Tempo acordado não entra nessa soma.
                    </p>
                  )}
                </li>
                );
              })}
            </ul>
            {!readonly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => add(groupIndex)}
                className="-ml-2 h-10 text-sm text-muted-foreground"
              >
                <Plus className="size-4" /> Adicionar item
              </Button>
            )}
          </section>
          );
        })}
      </div>

      {durationError && <p role="alert" className="mt-2 text-sm text-destructive">{durationError}</p>}
      {!readonly && sleepReview.loading && (
        <p role="status" className="mt-2 text-sm text-muted-foreground">Conferindo se já existe sono nessa data...</p>
      )}
      {!readonly && sleepReview.error && (
        <div role="alert" className="mt-2 space-y-2 text-sm">
          <p>Não foi possível conferir o sono salvo. {sleepReview.error}</p>
          <Button type="button" variant="outline" onClick={sleepReview.refresh}>Conferir novamente</Button>
        </div>
      )}
      {!readonly && sleepReview.conflicts.map(day => (
        <div key={day.data} role="alert" className="mt-2 space-y-2 rounded-xl border border-amber-500/40 p-3 text-sm">
          <p>Já existe sono salvo em <strong>{formatDate(day.data)}</strong>
            {day.count > 1 ? ` (${day.count} registros)` : ""}. O novo envio não será somado ao anterior.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 size-5 shrink-0" disabled={saving}
              checked={sleepReview.approved(day)}
              onChange={event => sleepReview.approve(day, event.target.checked)} />
            <span>Substituir o sono salvo desse dia pelos dados revisados acima.</span>
          </label>
          <p className="text-xs text-muted-foreground">Para manter os dados atuais, descarte este envio. A substituição só ocorre ao salvar.</p>
        </div>
      ))}

      {saveError && (
        <p
          role="alert"
          className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Não foi possível salvar ainda. {saveError}
        </p>
      )}
    </div>
  );
}
