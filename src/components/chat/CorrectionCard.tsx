import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  applyMealCorrection, getApiErrorMessage, getDailySummary, getMealCorrectionStatuses,
} from "@/lib/api";

type Props = {
  correctionId: string;
  sourceText: string;
  targetCount: number;
  status: "pending" | "applied" | "dismissed" | "unverified";
  onResolved: (status: "applied" | "dismissed" | "unverified") => void;
};

type SelectedRow = {
  id: string;
  data: string;
  horario: string;
  item: string;
  quantidade: string;
};

type ReviewedCorrection = {
  rows: SelectedRow[];
  keepId: string;
  item: string;
  quantidade: string;
};

export function CorrectionCard({ correctionId, sourceText, targetCount, status, onResolved }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["daily-summary"],
    queryFn: () => getDailySummary(),
    enabled: status === "pending",
    refetchOnMount: "always",
  });
  const [description, setDescription] = useState(sourceText);
  const [quantity, setQuantity] = useState("conforme descrição; demais não informadas");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [keepId, setKeepId] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<ReviewedCorrection | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  if (status !== "pending") {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-sm">
        {status === "unverified"
          ? "Não foi possível verificar se esta correção já foi aplicada. Atualize a página antes de tentar novamente."
          : status === "applied"
          ? "Correção confirmada. Os dados atuais estão na tela Dia."
          : "Proposta de correção descartada. Nenhum registro foi alterado."}
        <Link to="/dashboard" className="ml-2 font-medium text-primary underline">Ver Dia</Link>
        {status === "unverified" && (
          <Button variant="outline" size="sm" className="mt-2 block" onClick={() => window.location.reload()}>
            Verificar novamente
          </Button>
        )}
      </div>
    );
  }

  const meals = data?.refeicoes ?? [];
  const rows: SelectedRow[] = meals.flatMap((meal) => meal.itens.flatMap((item) =>
    item.id ? [{
      id: item.id, data: data!.data, horario: meal.hora,
      item: item.item, quantidade: item.quantidade,
    }] : [],
  ));
  const selectedRows = rows.filter((row) => selectedIds.includes(row.id));
  const valid = selectedRows.length > 0 && selectedRows.length === selectedIds.length &&
    selectedRows.length <= 100 && !!keepId && selectedIds.includes(keepId) &&
    description.trim().length > 0 &&
    description.trim().length <= 200 && quantity.trim().length > 0 &&
    quantity.trim().length <= 100;

  function setSelection(ids: string[]) {
    setSelectedIds(ids);
    if (keepId && !ids.includes(keepId)) setKeepId(null);
    setReviewed(null);
    setSaveError("");
  }

  async function apply() {
    if (!valid || busy) return;
    if (!reviewed) {
      setReviewed({
        rows: selectedRows.map((row) => ({ ...row })),
        keepId: keepId!,
        item: description.trim(),
        quantidade: quantity.trim(),
      });
      return;
    }
    setBusy(true);
    setSaveError("");
    try {
      await applyMealCorrection({
        correction_id: correctionId,
        record_ids: reviewed.rows.map((row) => row.id),
        keep_record_id: reviewed.keepId,
        expected_rows: reviewed.rows,
        item: reviewed.item,
        quantidade: reviewed.quantidade,
      });
      onResolved("applied");
      toast.success("Refeição corrigida, sem criar outra.");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["daily-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["meals-for-day"] }),
        queryClient.invalidateQueries({ queryKey: ["weekly-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["weekly-meals"] }),
        queryClient.invalidateQueries({ queryKey: ["health-context"] }),
      ]).catch(() => toast.error("Correção salva. Atualize Dia para conferir os dados."));
    } catch (cause) {
      let applied: string[] | null = null;
      try {
        applied = await getMealCorrectionStatuses([correctionId]);
      } catch {
        // If both calls fail, do not risk asking for another destructive write.
      }
      if (applied?.includes(correctionId)) {
        onResolved("applied");
        toast.success("A correção já tinha sido salva. Confira em Dia.");
        void queryClient.invalidateQueries({ queryKey: ["daily-summary"] });
        void queryClient.invalidateQueries({ queryKey: ["meals-for-day"] });
        return;
      }
      if (applied === null) {
        onResolved("unverified");
        toast.error("Não foi possível verificar o resultado. Atualize a página antes de tentar de novo.");
        return;
      }
      const message = getApiErrorMessage(cause);
      setSaveError(message);
      setReviewed(null);
      void queryClient.invalidateQueries({ queryKey: ["daily-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["meals-for-day"] });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0 space-y-4 rounded-3xl border border-primary/40 bg-card p-4 sm:p-6">
      <div>
        <h3 className="text-base font-semibold">Corrigir refeição já salva</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Entendi que isto se refere a uma refeição anterior. Nenhuma nova refeição foi criada.
          {targetCount === 2
            ? " Você mencionou dois registros: selecione exatamente os itens dos dois cartões."
            : " Selecione exatamente os itens que precisam ser corrigidos."}
          {" "}Nada será selecionado automaticamente.
        </p>
      </div>

      {isLoading && <p className="text-sm">Buscando refeições salvas...</p>}
      {error && (
        <div className="space-y-2 text-sm" role="alert">
          <p>Não foi possível carregar os registros: {getApiErrorMessage(error)}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>Tentar novamente</Button>
        </div>
      )}
      {!isLoading && !error && meals.length === 0 && (
        <p className="text-sm">Nenhuma refeição salva hoje para corrigir. Nenhum registro foi alterado.</p>
      )}
      {meals.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Quais itens salvos pertencem a esta correção?</legend>
          {meals.map((meal) => (
            <div key={meal.hora} className="space-y-2 rounded-xl border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{meal.hora} — {meal.itens.length} item(ns)</strong>
                <Button
                  variant="outline" size="sm" disabled={busy || meal.itens.some((item) => !item.id)}
                  onClick={() => {
                    const ids = meal.itens.map((item) => item.id!);
                    const allSelected = ids.every((id) => selectedIds.includes(id));
                    setSelection(allSelected
                      ? selectedIds.filter((id) => !ids.includes(id))
                      : [...new Set([...selectedIds, ...ids])]);
                  }}
                >
                  {meal.itens.every((item) => item.id && selectedIds.includes(item.id))
                    ? "Desmarcar horário" : "Selecionar itens deste horário"}
                </Button>
              </div>
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {meal.itens.map((item, index) => (
                  <div key={item.id ?? index} className="flex items-start gap-2 rounded-lg bg-background p-2">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                      <input
                        type="checkbox" className="mt-1 size-4 shrink-0 accent-primary"
                        checked={!!item.id && selectedIds.includes(item.id)}
                        disabled={busy || !item.id}
                        onChange={() => {
                          if (!item.id) return;
                          setSelection(selectedIds.includes(item.id)
                            ? selectedIds.filter((id) => id !== item.id)
                            : [...selectedIds, item.id]);
                        }}
                      />
                      <span className="min-w-0 break-words">{item.item} ({item.quantidade})</span>
                    </label>
                    {item.id && selectedIds.includes(item.id) && (
                      <label className="flex shrink-0 items-center gap-1 text-xs">
                        <input
                          type="radio" name="keep-meal-record" checked={keepId === item.id}
                          disabled={busy}
                          onChange={() => { setKeepId(item.id!); setReviewed(null); }}
                        />
                        Manter
                      </label>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      )}

      <label className="block space-y-1 text-sm">
        <span className="font-medium">Descrição correta da refeição</span>
        <textarea
          className="min-h-28 w-full rounded-xl border border-input bg-background p-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={description}
          maxLength={200}
          disabled={busy}
          onChange={(event) => { setDescription(event.target.value); setReviewed(null); }}
          placeholder="Descreva somente o que você confirmou."
        />
        <span className="block text-xs text-muted-foreground">{description.length}/200 caracteres. Não estime porções desconhecidas.</span>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Quantidade ou observação</span>
        <Input
          value={quantity} maxLength={100} disabled={busy}
          onChange={(event) => { setQuantity(event.target.value); setReviewed(null); }}
        />
      </label>

      <p className="text-xs text-muted-foreground">
        Isto substituirá somente os itens marcados por um único registro com o texto acima, mantendo
        a data e o horário do item marcado como “Manter”. Se você só quer corrigir um ingrediente,
        edite apenas esse item em <Link to="/dashboard" className="text-primary underline">Dia → Refeições</Link>.
      </p>
      {reviewed && (
        <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm" role="alert">
          <strong>Confira antes de substituir {reviewed.rows.length} item(ns):</strong>
          <ul className="max-h-40 list-inside list-disc overflow-y-auto">
            {reviewed.rows.map((row) => (
              <li key={row.id}>
                {row.horario} — {row.item} ({row.quantidade})
                {row.id === reviewed.keepId ? " — manter este registro" : " — remover"}
              </li>
            ))}
          </ul>
          <p>Nova descrição: {reviewed.item} ({reviewed.quantidade}). Nenhuma refeição nova será criada.</p>
        </div>
      )}
      {!valid && selectedIds.length > 0 && (
        <p className="text-sm text-destructive">
          Escolha qual item manter e confira a descrição (até 200 caracteres) e a quantidade.
        </p>
      )}
      {saveError && <p className="text-sm text-destructive" role="alert">{saveError}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!valid || busy} onClick={() => void apply()}>
          {reviewed ? "Confirmar substituição" : "Revisar substituição"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => onResolved("dismissed")}>
          Não corrigir
        </Button>
      </div>
    </div>
  );
}