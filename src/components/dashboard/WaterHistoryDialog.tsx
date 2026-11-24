import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { correctWaterTotal, getApiErrorMessage, getWaterHistory } from "@/lib/api";

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

type Confirmation = { action: "update"; amount: number } | { action: "delete" };

export function WaterHistoryDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayInSaoPaulo);
  const [amount, setAmount] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [error, setError] = useState("");
  const history = useQuery({
    queryKey: ["water-history", date],
    queryFn: () => getWaterHistory(date),
    enabled: open,
    refetchOnWindowFocus: true,
  });
  const total = history.data?.total_declarado;
  const mutation = useMutation({
    mutationFn: (review: Confirmation) => {
      if (!total) throw new Error("Atualize o histórico para selecionar o total diário.");
      return correctWaterTotal({
        data: date,
        import_key: total.import_key,
        expected_quantity: total.quantidade,
        action: review.action,
        new_total_ml: review.action === "update" ? review.amount : null,
      });
    },
    onSuccess: () => {
      setEditing(false);
      setConfirmation(null);
      setError("");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["water-history"] }),
        queryClient.invalidateQueries({ queryKey: ["daily-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["weekly-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["health-context"] }),
      ]);
    },
    onError: (cause) => {
      setError(getApiErrorMessage(cause));
      setConfirmation(null);
      void queryClient.invalidateQueries({ queryKey: ["water-history"] });
    },
  });

  function reviewUpdate() {
    const parsed = Number(amount);
    if (!/^\d+$/.test(amount) || !Number.isInteger(parsed) || parsed < 1 || parsed > 15000) {
      setError("Informe um total entre 1 e 15.000 ml.");
      return;
    }
    if (parsed === total?.quantidade_ml) {
      setError("O valor informado já é o total salvo.");
      return;
    }
    setError("");
    setConfirmation({ action: "update", amount: parsed });
  }

  function resetSelection() {
    setEditing(false);
    setConfirmation(null);
    setError("");
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (mutation.isPending) return;
      setOpen(next);
      if (!next) resetSelection();
    }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="self-start">
          Ver e corrigir histórico de água
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] min-w-0 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histórico de água</DialogTitle>
          <DialogDescription>
            O total declarado e as doses são registros diferentes. Corrigir ou excluir o total não altera as doses.
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Dia
          <input
            type="date"
            value={date}
            max={todayInSaoPaulo()}
            disabled={mutation.isPending}
            onChange={(event) => {
              setDate(event.target.value);
              resetSelection();
            }}
            className="min-h-11 rounded-md border border-input bg-background px-3 text-foreground"
          />
        </label>
        {history.isPending ? (
          <p className="text-sm text-muted-foreground">Carregando registros...</p>
        ) : history.isError ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>Não foi possível carregar o histórico: {getApiErrorMessage(history.error)}</p>
            <Button size="sm" variant="outline" onClick={() => void history.refetch()}>Tentar novamente</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <h3 className="text-sm font-semibold">Total diário declarado</h3>
              {total ? (
                <>
                  <p className="mt-1 text-sm">{total.quantidade} · {total.horario || "Sem horário"}</p>
                  {!editing && !confirmation && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => {
                        setAmount(String(total.quantidade_ml));
                        setEditing(true);
                        setError("");
                      }}>Editar total</Button>
                      <Button size="sm" variant="destructive" onClick={() => {
                        setEditing(false);
                        setError("");
                        setConfirmation({ action: "delete" });
                      }}>Excluir total</Button>
                    </div>
                  )}
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Nenhum total declarado neste dia.</p>
              )}
            </section>
            {editing && total && !confirmation && (
              <div className="space-y-3 rounded-xl border border-border p-3">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Novo total em ml
                  <input
                    type="number"
                    min={1}
                    max={15000}
                    step={1}
                    inputMode="numeric"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="min-h-11 rounded-md border border-input bg-background px-3 text-foreground"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={reviewUpdate}>Revisar alteração</Button>
                  <Button size="sm" variant="outline" onClick={resetSelection}>Cancelar</Button>
                </div>
              </div>
            )}
            {confirmation && total && (
              <div className="space-y-3 rounded-xl border border-border p-3">
                <p className="text-sm font-medium">
                  {confirmation.action === "update"
                    ? `Confirmar mudança de ${total.quantidade} para ${confirmation.amount} ml?`
                    : `Excluir o total declarado de ${total.quantidade}?`}
                </p>
                <p className="text-xs text-muted-foreground">
                  As doses continuam salvas. O resumo do dia e o gráfico semanal serão atualizados.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={confirmation.action === "delete" ? "destructive" : "default"}
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate(confirmation)}
                  >
                    {mutation.isPending ? "Salvando..." :
                      confirmation.action === "delete" ? "Confirmar exclusão" : "Confirmar correção"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={resetSelection}>
                    Voltar
                  </Button>
                </div>
              </div>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <section>
              <h3 className="text-sm font-semibold">Doses registradas</h3>
              {history.data.doses.length ? (
                <ul className="mt-2 space-y-2">
                  {history.data.doses.map((dose, index) => (
                    <li key={`${dose.horario}-${index}`} className="rounded-xl border border-border p-3 text-sm">
                      <span className="text-muted-foreground">{dose.horario || "Sem horário"} · </span>
                      {dose.item} · {dose.quantidade}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-muted-foreground">Nenhuma dose registrada neste dia.</p>}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}