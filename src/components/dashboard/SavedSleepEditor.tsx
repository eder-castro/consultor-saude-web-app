import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { getApiErrorMessage, getSavedSleepRecords, updateSavedSleepRecord, type SavedSleepUpdate } from "@/lib/api";
import type { SavedSleepRecord } from "@/lib/api-schemas";
import { formatSleepDuration, parseSleepClock, parseSleepDuration, sleepDurationForReview } from "@/lib/sleep-duration";
import { Button } from "@/components/ui/button";

const fields = [
  { key: "sono_profundo_min", label: "Profundo" },
  { key: "sono_leve_min", label: "Leve" },
  { key: "sono_rem_min", label: "REM" },
  { key: "acordado_min", label: "Acordado" },
] as const;

function labelFor(record: SavedSleepRecord) {
  const day = record.data.split("-").reverse().join("/");
  const interval = record.inicio || record.fim ? ` · ${record.inicio ?? "?"}–${record.fim ?? "?"}` : "";
  return `${day}${interval} · ${sleepDurationForReview(record.duracao_minutos) || "sem total"}`;
}

function SleepForm({ record, onDone }: { record: SavedSleepRecord; onDone: () => void }) {
  const queryClient = useQueryClient();
  const initial = parseSleepDuration(record.duracao_minutos ?? "");
  const [total, setTotal] = useState(initial === null ? (record.duracao_minutos ?? "") : formatSleepDuration(initial));
  const [stages, setStages] = useState<Record<typeof fields[number]["key"], string>>(
    Object.fromEntries(fields.map(({ key }) => [key, sleepDurationForReview(record[key])])) as Record<typeof fields[number]["key"], string>,
  );
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: (input: SavedSleepUpdate) => updateSavedSleepRecord(record.id, input),
    onSuccess: (updated) => {
      queryClient.setQueryData<SavedSleepRecord[]>(["saved-sleep-records"], (current) =>
        current?.map((item) => item.id === updated.id ? updated : item),
      );
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["saved-sleep-records"] }),
        queryClient.invalidateQueries({ queryKey: ["daily-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["weekly-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["health-context"] }),
      ]);
      onDone();
    },
    onError: (cause) => setError(getApiErrorMessage(cause)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const minutes = parseSleepClock(total);
    const values = fields.map(({ key }) => stages[key].trim() ? parseSleepClock(stages[key]) : null);
    if (minutes === null || minutes < 1 || fields.some(({ key }, index) => stages[key].trim() && values[index] === null)) {
      setError("Informe durações válidas em hh:mm (até 24:00). O total deve ser maior que zero.");
      return;
    }
    const known = values.slice(0, 3).filter((value): value is number => value !== null);
    const sum = known.reduce((value, part) => value + part, 0);
    if (sum > minutes || (known.length === 3 && sum !== minutes)) {
      setError("As fases dormidas devem somar o total quando todas são informadas. Acordado não entra na soma.");
      return;
    }
    mutation.mutate({
      total_sleep_min: minutes,
      sono_profundo_min: values[0],
      sono_leve_min: values[1],
      sono_rem_min: values[2],
      acordado_min: values[3],
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-primary/30 p-3">
      <p className="text-sm font-medium">Corrigir noite de {record.data.split("-").reverse().join("/")}</p>
      <p className="text-xs text-muted-foreground">Durações em hh:mm. Deixe vazias as fases não conhecidas. Acordado não conta no total dormido.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span>Total dormido *</span>
          <input required inputMode="numeric" placeholder="07:30" value={total} onChange={(event) => setTotal(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2" />
        </label>
        {fields.map(({ key, label }) => (
          <label key={key} className="space-y-1 text-sm">
            <span>{label}</span>
            <input inputMode="numeric" placeholder="hh:mm" value={stages[key]}
              onChange={(event) => setStages((previous) => ({ ...previous, [key]: event.target.value }))}
              className="w-full rounded-md border border-input bg-background px-3 py-2" />
          </label>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Salvando..." : "Salvar correção"}</Button>
        <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onDone}>Cancelar</Button>
      </div>
    </form>
  );
}

export function SavedSleepEditor() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const records = useQuery({
    queryKey: ["saved-sleep-records"],
    queryFn: getSavedSleepRecords,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const selected = records.data?.find((item) => item.id === selectedId);

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">Corrigir uma noite salva</h3>
      {records.isPending ? <p className="text-sm text-muted-foreground">Carregando noites...</p> :
        records.isError ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>Não foi possível carregar as noites: {getApiErrorMessage(records.error)}</p>
            <Button type="button" variant="outline" onClick={() => void records.refetch()}>Tentar novamente</Button>
          </div>
        ) : !records.data?.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma noite consolidada encontrada. Registros antigos com fases separadas podem ser revisados no perfil.</p>
        ) : (
          <>
            <label className="block space-y-1 text-sm">
              <span>Selecione a noite</span>
              <select value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value || null)}
                className="w-full rounded-md border border-input bg-background px-3 py-2">
                <option value="">Escolher noite salva</option>
                {records.data.map((record) => <option key={record.id} value={record.id}>{labelFor(record)}</option>)}
              </select>
            </label>
            {selected && <SleepForm key={selected.id} record={selected} onDone={() => setSelectedId(null)} />}
          </>
        )}
    </section>
  );
}