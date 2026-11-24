import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getApiErrorMessage, getDatedRecords, updateRecordDates } from "@/lib/api";
import type { DatedRecord } from "@/lib/api-schemas";
import { CalendarClock, Check, RotateCcw } from "lucide-react";

type RecordRef = { table: DatedRecord["table"]; id: string };
type ReviewedMove = {
  operation_id: string;
  source_date: string;
  target_date: string;
  records: RecordRef[];
};

const recordTypes: Record<DatedRecord["table"], string> = {
  alimentacao: "Alimentação",
  hidratacao: "Hidratação",
  exercicios: "Exercício",
  sono: "Sono",
  peso: "Peso",
};

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function recordKey(record: RecordRef) {
  return JSON.stringify([record.table, record.id]);
}

function isDeclaredWaterTotal(record: DatedRecord) {
  if (record.table !== "hidratacao" && record.evento_tipo !== "hidratacao") return false;
  const description = `${record.evento_tipo} ${record.item}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /total/.test(description) &&
    /(diario|declarad|total)/.test(description);
}

function formatDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function RecordDateDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sourceDate, setSourceDate] = useState(todayInSaoPaulo);
  const [targetDate, setTargetDate] = useState(() => shiftDate(todayInSaoPaulo(), -1));
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [reviewedMove, setReviewedMove] = useState<ReviewedMove | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const today = todayInSaoPaulo();

  const recordsQuery = useQuery({
    queryKey: ["dated-records", sourceDate],
    queryFn: () => getDatedRecords(sourceDate),
    enabled: open,
    refetchOnWindowFocus: true,
  });

  const matchingRecords = recordsQuery.data?.data === sourceDate
    ? recordsQuery.data.registros
    : undefined;

  useEffect(() => {
    setSelectedKeys([]);
    setReviewedMove(null);
  }, [recordsQuery.data]);

  const selectedRecords = useMemo(() => {
    if (!matchingRecords) return [];
    const selected = new Set(selectedKeys);
    return matchingRecords
      .filter((record) => selected.has(recordKey(record)))
      .map(({ table, id }) => ({ table, id }));
  }, [matchingRecords, selectedKeys]);

  const includesDeclaredWaterTotal = matchingRecords?.some(
    (record) => selectedKeys.includes(recordKey(record)) && isDeclaredWaterTotal(record),
  ) ?? false;
  const totalMovesToPast = includesDeclaredWaterTotal && targetDate < today;
  const payloadMatchesCurrentSelection = reviewedMove !== null &&
    reviewedMove.source_date === sourceDate &&
    reviewedMove.target_date === targetDate &&
    JSON.stringify(reviewedMove.records) === JSON.stringify(selectedRecords);

  const mutation = useMutation({
    mutationFn: (move: ReviewedMove) => updateRecordDates(move),
    onSuccess: async (result) => {
      setSuccess(`${result.updated} ${result.updated === 1 ? "registro movido" : "registros movidos"} com sucesso.`);
      setError("");
      setReviewedMove(null);
      setSelectedKeys([]);
      await Promise.all(
        [
          ["dated-records"],
          ["daily-summary"],
          ["meals-for-day"],
          ["weekly-meals"],
          ["weekly-summary"],
          ["sleep-records"],
          ["sleep-reviews"],
          ["water-history"],
          ["health-context"],
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
    onError: (cause) => {
      // Keep the reviewed payload and operation id so an ambiguous failure can be retried safely.
      setError(getApiErrorMessage(cause));
    },
  });

  function resetReview() {
    setReviewedMove(null);
    setError("");
    setSuccess("");
  }

  function changeSourceDate(date: string) {
    setSourceDate(date);
    setSelectedKeys([]);
    resetReview();
  }

  function changeTargetDate(date: string) {
    setTargetDate(date);
    resetReview();
  }

  function toggleRecord(record: DatedRecord) {
    const key = recordKey(record);
    setSelectedKeys((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
    );
    resetReview();
  }

  function toggleAll() {
    if (!matchingRecords) return;
    setSelectedKeys(selectedKeys.length === matchingRecords.length
      ? []
      : matchingRecords.map(recordKey));
    resetReview();
  }

  function reviewMove() {
    if (!matchingRecords || matchingRecords.length === 0) {
      setError("Não há registros para selecionar neste dia.");
      return;
    }
    if (selectedRecords.length === 0) {
      setError("Selecione pelo menos um registro para continuar.");
      return;
    }
    if (!targetDate || targetDate > today || targetDate === sourceDate) {
      setError("Escolha uma data de destino válida, diferente do dia de origem e não futura.");
      return;
    }
    setError("");
    setSuccess("");
    setReviewedMove({
      operation_id: crypto.randomUUID(),
      source_date: sourceDate,
      target_date: targetDate,
      records: selectedRecords,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (mutation.isPending) return;
        setOpen(next);
        if (next) {
          setSourceDate(todayInSaoPaulo());
          setTargetDate(shiftDate(todayInSaoPaulo(), -1));
          setSelectedKeys([]);
          resetReview();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-start sm:w-auto">
          <CalendarClock className="mr-2 size-4" />
          Corrigir datas de registros
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90dvh] min-w-0 overflow-y-auto sm:max-w-xl"
        onEscapeKeyDown={(event) => {
          if (mutation.isPending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (mutation.isPending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Corrigir datas de registros</DialogTitle>
          <DialogDescription>
            Mova registros já salvos para o dia em que aconteceram. Os demais dados não serão alterados.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Dia atual dos registros
            <input
              type="date"
              data-testid="input-record-date-source"
              value={sourceDate}
              max={today}
              disabled={mutation.isPending}
              onChange={(event) => changeSourceDate(event.target.value)}
              className="min-h-11 rounded-md border border-input bg-background px-3 text-foreground"
            />
          </label>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Registros salvos</h3>
              {matchingRecords && matchingRecords.length > 0 && !payloadMatchesCurrentSelection && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={toggleAll}
                  data-testid="button-select-all-records"
                >
                  {selectedKeys.length === matchingRecords.length ? "Desmarcar todos" : "Selecionar todos"}
                </Button>
              )}
            </div>

            {recordsQuery.isPending ? (
              <div role="status" className="space-y-2 rounded-xl border border-border p-3">
                <p className="text-sm text-muted-foreground">Carregando registros do dia...</p>
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            ) : recordsQuery.isError ? (
              <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm">Não foi possível carregar os registros: {getApiErrorMessage(recordsQuery.error)}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={recordsQuery.isFetching || mutation.isPending}
                  onClick={() => void recordsQuery.refetch()}
                >
                  <RotateCcw className="mr-2 size-3.5" />
                  {recordsQuery.isFetching ? "Tentando novamente..." : "Tentar novamente"}
                </Button>
              </div>
            ) : !matchingRecords ? (
              <div role="alert" className="rounded-xl border border-amber-600/30 bg-amber-500/5 p-3 text-sm">
                A resposta não corresponde ao dia escolhido. Atualize os registros antes de selecionar.
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2 flex"
                  disabled={recordsQuery.isFetching || mutation.isPending}
                  onClick={() => void recordsQuery.refetch()}
                >
                  {recordsQuery.isFetching ? "Atualizando..." : "Atualizar registros"}
                </Button>
              </div>
            ) : matchingRecords.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-5 text-center">
                <p className="text-sm font-medium">Nenhum registro salvo neste dia.</p>
                <p className="mt-1 text-xs text-muted-foreground">Escolha outra data para localizar o que deseja corrigir.</p>
              </div>
            ) : (
              <fieldset disabled={mutation.isPending || payloadMatchesCurrentSelection} className="space-y-2">
                <legend className="sr-only">Escolha os registros que terão a data corrigida</legend>
                {matchingRecords.map((record) => {
                  const key = recordKey(record);
                  const checked = selectedKeys.includes(key);
                  return (
                    <label
                      key={key}
                      data-testid={`record-row-${record.table}-${record.id}`}
                      className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                        checked ? "border-primary/50 bg-primary/5" : "border-border hover:bg-accent/40"
                      } ${mutation.isPending || payloadMatchesCurrentSelection ? "cursor-not-allowed opacity-75" : ""}`}
                    >
                      <input
                        type="checkbox"
                        data-testid={`checkbox-record-${record.id}`}
                        checked={checked}
                        disabled={mutation.isPending || payloadMatchesCurrentSelection}
                        onChange={() => toggleRecord(record)}
                        className="mt-0.5 size-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                            {recordTypes[record.table]}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {record.horario || "Sem horário"}
                          </span>
                        </span>
                        <span className="mt-1 block break-words text-sm font-medium">{record.item}</span>
                        {record.quantidade && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">{record.quantidade}</span>
                        )}
                      </span>
                      {checked && <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />}
                    </label>
                  );
                })}
              </fieldset>
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Corrigir para
              <input
                type="date"
                data-testid="input-record-date-target"
                value={targetDate}
                max={today}
                disabled={mutation.isPending || payloadMatchesCurrentSelection}
                onChange={(event) => changeTargetDate(event.target.value)}
                className="min-h-11 rounded-md border border-input bg-background px-3 text-foreground"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={mutation.isPending || payloadMatchesCurrentSelection}
                onClick={() => changeTargetDate(today)}
              >
                Hoje
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={mutation.isPending || payloadMatchesCurrentSelection}
                onClick={() => changeTargetDate(shiftDate(today, -1))}
              >
                Ontem
              </Button>
            </div>
          </div>

          {totalMovesToPast && (
            <p className="rounded-lg border border-amber-600/25 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              O total diário declarado de água ficará com o encerramento do dia às 23:59.
            </p>
          )}

          {payloadMatchesCurrentSelection && reviewedMove && (
            <section
              aria-label="Revisão da correção"
              data-testid="record-date-review"
              className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-3"
            >
              <h3 className="text-sm font-semibold">Confira antes de confirmar</h3>
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div className="rounded-lg bg-background/70 p-2.5">
                  <span className="block text-xs text-muted-foreground">De</span>
                  <span className="font-medium">{formatDate(reviewedMove.source_date)}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {reviewedMove.records.length} {reviewedMove.records.length === 1 ? "registro selecionado" : "registros selecionados"}
                  </span>
                </div>
                <span className="hidden text-muted-foreground sm:block" aria-hidden="true">→</span>
                <div className="rounded-lg bg-background/70 p-2.5">
                  <span className="block text-xs text-muted-foreground">Para</span>
                  <span className="font-medium">{formatDate(reviewedMove.target_date)}</span>
                </div>
              </div>
              <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {matchingRecords
                  ?.filter((record) => reviewedMove.records.some((item) => item.id === record.id && item.table === record.table))
                  .map((record) => (
                    <li key={recordKey(record)} className="break-words">
                      {recordTypes[record.table]} · {record.item}{record.quantidade ? ` · ${record.quantidade}` : ""}
                    </li>
                  ))}
              </ul>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Somente esses registros terão a data alterada. Refeições, quantidades, horários e outros dados serão preservados.
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="sm:flex-1"
                  disabled={mutation.isPending}
                  onClick={resetReview}
                >
                  Voltar e revisar
                </Button>
                <Button
                  type="button"
                  className="sm:flex-1"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate(reviewedMove)}
                  data-testid="button-confirm-record-date"
                >
                  {mutation.isPending ? "Salvando..." : "Confirmar mudança de data"}
                </Button>
              </div>
            </section>
          )}

          {!payloadMatchesCurrentSelection && (
            <Button
              type="button"
              className="w-full"
              disabled={
                mutation.isPending ||
                recordsQuery.isPending ||
                recordsQuery.isError ||
                !matchingRecords ||
                matchingRecords.length === 0 ||
                selectedRecords.length === 0 ||
                !targetDate ||
                targetDate > today ||
                targetDate === sourceDate
              }
              onClick={reviewMove}
              data-testid="button-review-record-date"
            >
              Revisar mudança
            </Button>
          )}

          {error && <p role="alert" data-testid="status-record-date-error" className="text-sm text-destructive">{error}</p>}
          {success && <p role="status" data-testid="status-record-date-success" className="text-sm text-primary">{success}</p>}
          <p className="text-xs leading-relaxed text-muted-foreground">
            A correção não altera históricos de conversa nem recria análises anteriores.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
