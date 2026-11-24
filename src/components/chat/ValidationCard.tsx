import { useCallback, useRef, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
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
    setGroups((current) =>
      current.map((group, index) =>
        index === groupIndex
          ? { ...group, itens: group.itens.filter((item) => item.id !== id) }
          : group,
      ),
    );
  }
  function add(groupIndex: number) {
    setGroups((current) =>
      current.map((group, index) =>
        index === groupIndex
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
    setDurationError(null);
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

  return (
    <div className="min-w-0 overflow-hidden rounded-3xl border border-border bg-card p-3.5 shadow-sm sm:p-6">
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
      {status === "saved" && (
        <p className="mb-3 text-xs text-muted-foreground">
          Itens confirmados e salvos. Para ver os dados atuais, abra Dia.
          {payload.grupos.some((group) => group.evento_tipo === "alimentacao") &&
            " Para corrigir uma refeição, use a seção Refeições."}
        </p>
      )}

      {status === "pending" && payload.avisos_extracao?.map((warning, index) => (
        <p key={index} role="alert" className="mb-3 rounded-lg bg-amber-100/10 p-3 text-sm text-foreground">
          {warning}
        </p>
      ))}
      <div className="space-y-4 sm:space-y-5">
        {groups.map((group, groupIndex) => (
          <section
            key={`${group.evento_tipo}-${group.data ?? "sem-data"}-${groupIndex}`}
            className="space-y-2"
          >
            <h3 className="text-base font-semibold text-foreground">
              {TIPO_LABEL[group.evento_tipo]}
            </h3>
            {!readonly && group.data_imagem && (
              <p className="text-xs text-muted-foreground">
                Data lida na imagem: {group.data_imagem.split("-").reverse().join("/")}.
                {group.data !== group.data_imagem && " Você escolheu uma data diferente; confira antes de salvar."}
              </p>
            )}
            {group.evento_tipo === "hidratacao" && group.itens.some((item) => item.total_diario) && (
              <p className="text-sm text-muted-foreground">
                Total de água do dia, não um novo copo. Ao confirmar, substitui o total informado anteriormente
                sem somar novamente a água já registrada.
              </p>
            )}
            <label className="flex max-w-56 items-center gap-3 text-sm text-muted-foreground">
              <span className="shrink-0">Data do registro</span>
              <Input
                type="date"
                value={group.data ?? ""}
                disabled={readonly}
                required
                onChange={(event) => updateGroup(groupIndex, { data: event.target.value })}
                className="h-10 min-w-0 bg-background text-base text-foreground"
                aria-label={`Data de ${TIPO_LABEL[group.evento_tipo]}`}
              />
            </label>
            {!readonly && (
              <div className="space-y-1">
                <div className="flex gap-2">
                  {([0, -1] as const).map((offset) => (
                    <Button
                      key={offset}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const today = new Intl.DateTimeFormat("en-CA", {
                          timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
                        }).format(new Date());
                        const day = new Date(`${today}T12:00:00Z`);
                        day.setUTCDate(day.getUTCDate() + offset);
                        updateGroup(groupIndex, { data: day.toISOString().slice(0, 10) });
                      }}
                    >
                      {offset === 0 ? "Hoje" : "Ontem"}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Use a data em que aconteceu. Se enviou depois da meia-noite, confira se foi ontem.
                </p>
              </div>
            )}
            {group.evento_tipo === "alimentacao" && (
              <label className="flex max-w-48 items-center gap-3 text-sm text-muted-foreground">
                <span className="shrink-0">Horário</span>
                <Input
                  type="time"
                  value={group.horario ?? ""}
                  disabled={readonly}
                  required
                  onChange={(event) =>
                    updateGroup(groupIndex, { horario: event.target.value })
                  }
                  className="h-10 min-w-0 bg-background text-base text-foreground"
                />
              </label>
            )}
            <ul className="space-y-3">
              {group.itens.map((it) => {
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
                      className="size-6 shrink-0"
                    />
                    <Input
                      value={it.item}
                      disabled={readonly}
                      onChange={(e) => update(groupIndex, it.id, { item: e.target.value })}
                      placeholder="Item"
                      className="h-11 min-w-0 bg-background text-base"
                    />
                    {!isExercise && (
                      <Input
                        value={it.quantidade_estimada}
                        disabled={readonly}
                        onChange={(e) =>
                          update(groupIndex, it.id, { quantidade_estimada: e.target.value })
                        }
                        placeholder={group.evento_tipo === "sono" ? "hh:mm" : "Qtd"}
                        inputMode={group.evento_tipo === "sono" ? "numeric" : undefined}
                        aria-label={group.evento_tipo === "sono" ? `Duração de ${it.item || "sono"} em hh:mm` : undefined}
                        aria-invalid={group.evento_tipo === "sono" && it.confirmado &&
                          (!parseSleepClock(it.quantidade_estimada))}
                        className="col-start-2 h-11 min-w-0 bg-background text-base sm:col-start-auto sm:w-28"
                      />
                    )}
                    {!readonly && (
                      <Button
                        size="icon"
                        variant="ghost"
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
                    <div className="ml-8 grid gap-x-3 gap-y-2 sm:ml-9 sm:grid-cols-2">
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
                  {group.evento_tipo === "sono" && (
                    <p className="ml-8 text-xs text-muted-foreground sm:ml-9">
                      Duração total e fases em hh:mm. Deixe fases não informadas vazias.
                    </p>
                  )}
                  {stageTotal !== null && (
                    <p role="alert" className="ml-8 text-sm text-destructive sm:ml-9">
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
                className="h-10 text-base text-muted-foreground"
              >
                <Plus className="size-4" /> Adicionar item
              </Button>
            )}
          </section>
        ))}
      </div>

      {durationError && <p role="alert" className="mt-3 text-sm text-destructive">{durationError}</p>}
      {!readonly && sleepReview.loading && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">Conferindo se já existe sono nessa data...</p>
      )}
      {!readonly && sleepReview.error && (
        <div role="alert" className="mt-3 space-y-2 text-sm">
          <p>Não foi possível conferir o sono salvo. {sleepReview.error}</p>
          <Button type="button" variant="outline" onClick={sleepReview.refresh}>Conferir novamente</Button>
        </div>
      )}
      {!readonly && sleepReview.conflicts.map(day => (
        <div key={day.data} role="alert" className="mt-3 space-y-2 rounded-xl border border-amber-500/40 p-3 text-sm">
          <p>Já existe sono salvo em <strong>{day.data.split("-").reverse().join("/")}</strong>
            {day.count > 1 ? ` (${day.count} registros)` : ""}. O novo envio não será somado ao anterior.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 size-5 shrink-0" disabled={saving}
              checked={sleepReview.approved(day)}
              onChange={event => sleepReview.approve(day, event.target.checked)} />
            <span>Substituir o sono salvo desse dia pelos dados revisados acima.</span>
          </label>
          <p className="text-xs text-muted-foreground">Para manter os dados atuais, descarte este envio. A substituição só ocorre ao confirmar.</p>
        </div>
      ))}

      {status === "pending" && (
        <p className="mt-5 border-t border-border/60 pt-4 text-sm text-muted-foreground">
          Confira os itens detectados. A análise dos registros será feita depois da confirmação.
        </p>
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
            <Button className="h-11 flex-1 text-base" disabled={saving || sleepReview.blocked} onClick={confirm}>
              <Check className="size-4" /> {saving ? "Salvando..." : "Confirmar"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
