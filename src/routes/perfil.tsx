import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getHealthContext,
  prepareHealthExamFile,
  processHealthExam,
  reviewHealthExam,
} from "@/lib/api";
import type { Exam, ExamMarker } from "@/lib/api-schemas";
import { useAuth } from "@/providers/auth-context";

export const Route = createFileRoute("/perfil")({
  head: () => ({
    meta: [
      { title: "Perfil — Consultor de Saúde" },
      { name: "description", content: "Consulte sua conta, contexto clínico e exames." },
    ],
  }),
  component: ProtectedPerfilPage,
});

function ProtectedPerfilPage() {
  return (
    <ProtectedRoute>
      <PerfilPage />
    </ProtectedRoute>
  );
}

function PerfilPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const context = useQuery({
    queryKey: ["health-context"],
    queryFn: getHealthContext,
    refetchOnWindowFocus: true,
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Selecione um exame para analisar.");
      const prepared = await prepareHealthExamFile(file);
      return processHealthExam({ ...prepared, notes: notes.trim() || undefined });
    },
    onSuccess: () => {
      setFile(null);
      setNotes("");
      toast.success("Exame analisado. Revise os dados antes de confirmar.");
      void queryClient.invalidateQueries({ queryKey: ["health-context"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Falha ao analisar exame."),
  });

  return (
    <AppShell title="Perfil e exames">
      <div className="h-full overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-6">
          <section className="rounded-2xl border border-border bg-card p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Sua conta</p>
            <h2 className="mt-2 text-lg font-semibold">{user?.email}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Seus registros são privados e ficam associados apenas a esta conta.
            </p>
            <Button variant="outline" className="mt-5 min-h-10" onClick={() => void logout()}>
              Encerrar sessão
            </Button>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-base font-semibold">Contexto clínico privado</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {clinicalSummary(context.data?.profile?.clinical_profile)}
            </p>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <Upload className="size-4 text-primary" />
              <h2 className="font-semibold">Enviar exame</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Envie uma foto ou PDF para extrair informações que você poderá revisar.
            </p>
            <label className="mt-4 block text-sm font-medium" htmlFor="exam-file">
              Arquivo do exame
            </label>
            <Input
              id="exam-file"
              className="mt-1 h-11 pt-2"
              type="file"
              accept="image/*,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {file && <p className="mt-1 text-xs text-muted-foreground">{file.name}</p>}
            <label className="mt-4 block text-sm font-medium" htmlFor="exam-notes">
              Observações <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <Textarea
              id="exam-notes"
              className="mt-1"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Ex.: exame realizado em jejum"
            />
            <Button
              className="mt-4 min-h-11 w-full"
              disabled={!file || upload.isPending}
              onClick={() => upload.mutate()}
            >
              {upload.isPending && <Loader2 className="size-4 animate-spin" />}
              {upload.isPending ? "Analisando exame..." : "Analisar exame"}
            </Button>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              O arquivo original é usado apenas durante a análise e não é armazenado. Só os dados
              extraídos ficam pendentes até sua confirmação.
            </p>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold">Exames recentes</h2>
            {context.isLoading ? (
              <p className="mt-3 text-sm text-muted-foreground">Carregando exames...</p>
            ) : context.isError ? (
              <p className="mt-3 text-sm text-destructive">
                Não foi possível carregar seus exames.
              </p>
            ) : context.data?.exams.length ? (
              <ul className="mt-3 space-y-2">
                {context.data.exams.map((exam) => (
                  <li key={exam.id} className="rounded-lg border border-border px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {exam.exam_type || exam.file_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {exam.exam_date || formatDate(exam.created_at)}
                        </p>
                      </div>
                      <StatusBadge status={exam.status} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Nenhum exame enviado ainda.</p>
            )}
          </section>

          {context.data?.exams
            .filter((exam) => exam.status === "pending")
            .map((exam) => (
              <ExamReview key={exam.id} exam={exam} />
            ))}
        </div>
      </div>
    </AppShell>
  );
}

function ExamReview({ exam }: { exam: Exam }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => draftFromExam(exam));
  useEffect(() => setDraft(draftFromExam(exam)), [exam]);
  const review = useMutation({
    mutationFn: (status: "confirmed" | "discarded") =>
      reviewHealthExam(
        status === "discarded"
          ? { exam_id: exam.id, status }
          : {
              exam_id: exam.id,
              status,
              exam_type: draft.exam_type || undefined,
              exam_date: draft.exam_date || null,
              summary: draft.summary,
              extracted_data: {
                tipo_exame: draft.exam_type || null,
                data_exame: draft.exam_date || null,
                resumo: draft.summary,
                marcadores: draft.markers,
                achados: lines(draft.findings),
                incertezas: lines(draft.uncertainties),
                precisa_revisao: false,
              },
              uncertainties: lines(draft.uncertainties),
            },
      ),
    onSuccess: (_, status) => {
      toast.success(status === "confirmed" ? "Exame confirmado." : "Exame descartado.");
      void queryClient.invalidateQueries({ queryKey: ["health-context"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Falha ao revisar exame."),
  });
  const updateMarker = (index: number, key: keyof ExamMarker, value: string) =>
    setDraft((current) => ({
      ...current,
      markers: current.markers.map((marker, markerIndex) =>
        markerIndex === index ? { ...marker, [key]: value || null } : marker,
      ),
    }));

  return (
    <section className="rounded-2xl border border-primary/30 bg-card p-5">
      <div className="flex items-center gap-2">
        <FileText className="size-4 text-primary" />
        <h2 className="font-semibold">Revise antes de salvar</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{exam.file_name}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Tipo de exame">
          <Input
            value={draft.exam_type}
            onChange={(e) => setDraft({ ...draft, exam_type: e.target.value })}
          />
        </Field>
        <Field label="Data do exame">
          <Input
            type="date"
            value={draft.exam_date}
            onChange={(e) => setDraft({ ...draft, exam_date: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Resumo" className="mt-3">
        <Textarea
          value={draft.summary}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
        />
      </Field>
      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Marcadores</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDraft({ ...draft, markers: [...draft.markers, emptyMarker()] })}
          >
            <Plus /> Adicionar
          </Button>
        </div>
        <div className="mt-2 space-y-3">
          {draft.markers.map((marker, index) => (
            <div key={index} className="rounded-lg border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label={`Nome do marcador ${index + 1}`}
                  placeholder="Nome"
                  value={marker.nome}
                  onChange={(e) => updateMarker(index, "nome", e.target.value)}
                />
                <Input
                  aria-label={`Valor do marcador ${index + 1}`}
                  placeholder="Valor"
                  value={marker.valor ?? ""}
                  onChange={(e) => updateMarker(index, "valor", e.target.value)}
                />
                <Input
                  aria-label={`Unidade do marcador ${index + 1}`}
                  placeholder="Unidade"
                  value={marker.unidade ?? ""}
                  onChange={(e) => updateMarker(index, "unidade", e.target.value)}
                />
                <Input
                  aria-label={`Referência do marcador ${index + 1}`}
                  placeholder="Referência"
                  value={marker.referencia ?? ""}
                  onChange={(e) => updateMarker(index, "referencia", e.target.value)}
                />
              </div>
              <Button
                className="mt-2"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDraft({ ...draft, markers: draft.markers.filter((_, i) => i !== index) })
                }
              >
                <Trash2 /> Remover marcador
              </Button>
            </div>
          ))}
        </div>
      </div>
      <Field label="Achados (um por linha)" className="mt-4">
        <Textarea
          value={draft.findings}
          onChange={(e) => setDraft({ ...draft, findings: e.target.value })}
        />
      </Field>
      <Field label="Incertezas (um por linha)" className="mt-3">
        <Textarea
          value={draft.uncertainties}
          onChange={(e) => setDraft({ ...draft, uncertainties: e.target.value })}
        />
      </Field>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button
          className="min-h-11 flex-1"
          disabled={review.isPending}
          onClick={() => review.mutate("confirmed")}
        >
          Confirmar dados
        </Button>
        <Button
          className="min-h-11 flex-1"
          variant="destructive"
          disabled={review.isPending}
          onClick={() => review.mutate("discarded")}
        >
          Descartar exame
        </Button>
      </div>
    </section>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-sm font-medium ${className ?? ""}`}>
      <span>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function draftFromExam(exam: Exam) {
  return {
    exam_type: exam.exam_type ?? exam.extracted_data.tipo_exame ?? "",
    exam_date: (exam.exam_date ?? exam.extracted_data.data_exame ?? "").slice(0, 10),
    summary: exam.summary || exam.extracted_data.resumo,
    markers: exam.extracted_data.marcadores,
    findings: exam.extracted_data.achados.join("\n"),
    uncertainties: (exam.uncertainties.length
      ? exam.uncertainties
      : exam.extracted_data.incertezas
    ).join("\n"),
  };
}

function emptyMarker(): ExamMarker {
  return { nome: "", valor: null, unidade: null, referencia: null, observacao: null };
}
function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR");
}
function clinicalSummary(profile: unknown) {
  if (!profile) return "Nenhum contexto clínico registrado ainda.";
  if (typeof profile === "string") return profile;
  return "Seu contexto clínico está registrado de forma privada para personalizar seu acompanhamento.";
}
function StatusBadge({ status }: { status: Exam["status"] }) {
  const labels = {
    pending: "Aguardando revisão",
    confirmed: "Confirmado",
    discarded: "Descartado",
  };
  const colors = {
    pending: "bg-amber-100 text-amber-800",
    confirmed: "bg-emerald-100 text-emerald-800",
    discarded: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${colors[status]}`}>
      {labels[status]}
    </span>
  );
}
