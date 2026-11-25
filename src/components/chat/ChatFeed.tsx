import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Clock3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatHistoryStatus } from "@/providers/chat-context";
import { ValidationCard } from "./ValidationCard";
import { CorrectionCard } from "./CorrectionCard";
import { DailyAnalysisSummaryNotice } from "./DailyAnalysisSummaryNotice";
import { AnalysisLoading } from "./AnalysisLoading";
import { AnalysisText } from "./AnalysisText";
import { MessageTime } from "./MessageTime";
import { ImagePreview } from "./ImagePreview";
import { stageLabel } from "@/lib/analysis-progress";
import type { ChatMessage } from "@/providers/chat-context";
import type { SavedRecordRef, ValidationGroup } from "@/lib/api-schemas";

export function ChatFeed({
  messages,
  onValidationResolved,
  onValidationEdited,
  onCorrectionResolved,
  onRetry,
  onRetrySavedAnalysis,
  onCancelPhoto,
  historyStatus,
  onRetryHistory,
  onDismissPhotoError,
}: {
  messages: ChatMessage[];
  onValidationResolved: (
    id: string, status: "saved" | "discarded",
    reviewedGroups?: ValidationGroup[], recordRefs?: SavedRecordRef[],
  ) => void;
  onValidationEdited?: (id: string, groups: ValidationGroup[]) => void;
  onCorrectionResolved: (id: string, status: "applied" | "dismissed" | "unverified") => void;
  onRetry: (id: string) => void;
  onRetrySavedAnalysis: (id: string) => void;
  onCancelPhoto: (id: string) => void;
  historyStatus: ChatHistoryStatus;
  onRetryHistory: () => void;
  onDismissPhotoError: (id: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages.at(-1);
  // Review edits update shared draft state, but must not scroll the field the
  // user is editing out of view. Scroll only for new messages/results.
  const scrollKey = lastMessage
    ? `${messages.length}:${lastMessage.id}:${lastMessage.kind}:${"status" in lastMessage ? lastMessage.status : ""}:${
      lastMessage.kind === "validation"
        ? `${lastMessage.analysis?.status ?? ""}:${lastMessage.analysis?.text?.length ?? 0}`
        : "text" in lastMessage ? lastMessage.text.length : ""
    }`
    : "";

  useEffect(() => {
    if (scrollKey) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [scrollKey]);

  return (
    <div className="h-full min-w-0 w-full overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-4 pb-8 [scroll-padding-bottom:1.5rem] sm:px-8 sm:py-10 sm:pb-12">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-end gap-6">
        {/* Saudação limpa e fixa no topo do histórico */}
        <div className="pb-2">
          <GreetingHeader />
          <DailyAnalysisSummaryNotice />
        </div>

        {historyStatus === "loading" ? (
          <div data-testid="status-chat-history" className="mx-auto w-full max-w-2xl">
            <AnalysisLoading label="Carregando o histórico do chat..." compact />
          </div>
        ) : historyStatus === "error" ? (
          <section
            role="alert"
            data-testid="alert-chat-history"
            className="mx-auto w-full max-w-2xl space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
          >
            <p className="text-sm text-destructive">
              Não foi possível carregar o histórico do chat. Suas conversas não foram alteradas;
              tente novamente antes de enviar novos registros.
            </p>
            <Button
              type="button" size="sm" variant="outline"
              data-testid="button-retry-chat-history"
              onClick={onRetryHistory}
            >
              <RefreshCw className="size-4" /> Tentar carregar histórico novamente
            </Button>
          </section>
        ) : null}

        {/* As mensagens do chat entram aqui embaixo */}
        {messages.map((m) => (
          <div key={m.id} className="min-w-0 space-y-1" data-message-id={m.id}>
            <Bubble
              m={m}
              onResolved={(s, groups, refs) => onValidationResolved(m.id, s, groups, refs)}
              onEdited={(groups) => onValidationEdited?.(m.id, groups)}
              onCorrectionResolved={(s) => onCorrectionResolved(m.id, s)}
              onRetry={() => onRetry(m.id)}
              onRetrySavedAnalysis={() => onRetrySavedAnalysis(m.id)}
              onCancelPhoto={() => { if (m.kind === "deferred") onCancelPhoto(m.jobId); }}
              onDismissPhotoError={() => { if (m.kind === "error") onDismissPhotoError(m.id); }}
            />
            <MessageTime value={m.createdAt} outgoing={m.role === "user"} />
          </div>
        ))}

        <div ref={bottomRef} className="h-2 shrink-0 scroll-mb-6" />
      </div>
    </div>
  );
}

function GreetingHeader() {
  const [greeting, setGreeting] = useState("Olá");

  useEffect(() => {
    const updateGreeting = () => {
      const hour = new Date().getHours();
      setGreeting(
        hour >= 5 && hour < 12 ? "Bom dia" : hour >= 12 && hour < 18 ? "Boa tarde" : "Boa noite",
      );
    };

    updateGreeting();
    const timer = window.setInterval(updateGreeting, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="max-w-2xl space-y-4 pb-4 pt-6 sm:pt-12">
      <h2 className="text-3xl font-normal tracking-tight sm:text-4xl">{greeting}</h2>
      <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
        Registre seu dia do jeito mais fácil para você. Envie uma foto da refeição, compartilhe seus
        dados de sono ou atividade, ou simplesmente conte como foi. Eu organizo tudo para você
        revisar antes de salvar.
      </p>
    </div>
  );
}

function Bubble({
  m,
  onResolved,
  onEdited,
  onCorrectionResolved,
  onRetry,
  onRetrySavedAnalysis,
  onCancelPhoto,
  onDismissPhotoError,
}: {
  m: ChatMessage;
  onResolved: (s: "saved" | "discarded", reviewedGroups?: ValidationGroup[], recordRefs?: SavedRecordRef[]) => void;
  onEdited?: (groups: ValidationGroup[]) => void;
  onCorrectionResolved: (s: "applied" | "dismissed" | "unverified") => void;
  onRetry: () => void;
  onRetrySavedAnalysis: () => void;
  onCancelPhoto: () => void;
  onDismissPhotoError: () => void;
}) {
  if (m.role === "user") {
    if (m.kind === "image") {
      const imageUrls = m.imageUrls ?? (m.imageUrl ? [m.imageUrl] : []);
      return (
        <div className="flex justify-end">
          <div className="flex max-w-[92%] flex-col items-end gap-2 text-base leading-relaxed sm:max-w-[85%]">
            <div className="flex flex-wrap justify-end gap-2">
              {imageUrls.length ? (
                imageUrls.map((url, index) => (
                  <ImagePreview key={`${url}-${index}`} src={url} index={index} />
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  {(m.imageCount ?? 1) === 1
                    ? "Imagem enviada (prévia indisponível)"
                    : `${m.imageCount} imagens enviadas (prévias indisponíveis)`}
                </p>
              )}
            </div>
            {m.caption && (
              <p className="whitespace-pre-wrap break-words rounded-[22px] bg-muted px-[18px] py-3 text-foreground">
                {m.caption}
              </p>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[22px] bg-muted px-[18px] py-3 text-base leading-relaxed text-foreground sm:max-w-[75%]">
          <p className="whitespace-pre-wrap break-words">{m.text}</p>
        </div>
      </div>
    );
  }

  if (m.kind === "correction") {
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[92%] sm:max-w-[85%]">
          <CorrectionCard
            correctionId={m.id}
            sourceText={m.sourceText}
            targetCount={m.targetCount}
            status={m.status}
            onResolved={onCorrectionResolved}
          />
        </div>
      </div>
    );
  }

  if (m.kind === "loading") {
    return (
      <div className="flex justify-start">
        <AnalysisLoading
          label={stageLabel(m.stage, m.inputKind === "image" ? "Analisando sua foto..." : "Analisando seu registro...")}
          className="max-w-[92%] sm:max-w-[85%]"
        />
      </div>
    );
  }

  if (m.kind === "deferred") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[92%] space-y-2 rounded-2xl border border-border bg-card px-4 py-3 sm:max-w-[85%]">
          {m.processing ? (
            <AnalysisLoading label="A nova tentativa de análise da foto está em andamento..." compact />
          ) : (
            <p className="flex items-center gap-2"><Clock3 className="size-4" /> Foto aguardando nova análise</p>
          )}
          <p className="text-sm text-muted-foreground">
            A análise da foto não foi concluída nesta tentativa. Vamos tentar novamente enquanto o serviço
            estiver ativo e retomar quando você voltar ao app, por até 7 dias. A foto fica guardada
            temporariamente e protegida, e será apagada após o resultado, cancelamento ou prazo.
            Você verá o aviso neste app quando o resultado estiver pronto; nada será salvo sem sua aprovação.
          </p>
          <Button variant="outline" size="sm" className="min-h-10" onClick={onCancelPhoto}>
            Cancelar novas tentativas
          </Button>
        </div>
      </div>
    );
  }

  if (m.kind === "text") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[92%] px-1 py-2 sm:max-w-[85%]">
          <AnalysisText text={m.text} />
        </div>
      </div>
    );
  }

  if (m.kind === "error") {
    return (
      <div className="flex justify-start">
        <div
          role={m.acknowledged ? "status" : "alert"}
          className={`w-full max-w-[92%] space-y-3 rounded-3xl rounded-tl-sm border px-4 py-3 text-base leading-relaxed sm:max-w-[85%] ${
            m.acknowledged
              ? "border-border bg-muted/40 text-muted-foreground"
              : "border-destructive/30 bg-destructive/5"
          }`}
        >
          <div className="flex items-start gap-2">
            <AlertCircle className={`mt-1 size-4 shrink-0 ${m.acknowledged ? "text-muted-foreground" : "text-destructive"}`} />
            <p className="min-w-0 break-words">{m.text}</p>
          </div>
          {m.photoJobId && (
            <p className="text-sm text-muted-foreground">Nenhum registro foi salvo a partir desta análise.</p>
          )}
          {m.photoJobId && !m.acknowledged && (
            <Button
              type="button" variant="outline" size="sm"
              data-testid={`button-dismiss-photo-error-${m.id}`}
              onClick={onDismissPhotoError}
            >
              Dispensar aviso
            </Button>
          )}
          {m.photoJobId && m.acknowledged && (
            <p className="text-sm text-muted-foreground">Aviso dispensado. O histórico foi mantido.</p>
          )}
          {m.retryable && (
            <Button
              variant="outline"
              size="sm"
              className="min-h-10"
              onClick={onRetry}
              data-testid="retry-analysis"
            >
              <RefreshCw className="size-4" /> Tentar novamente
            </Button>
          )}
          {m.editMeals && (
            <Button asChild variant="outline" size="sm" className="min-h-10">
              <Link to="/dashboard">Corrigir refeição no Dia</Link>
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-full">
        <ValidationCard operationId={m.id} payload={m.payload} status={m.status} onResolved={onResolved} onEdited={onEdited} />
        {m.status === "saved" && m.analysis && (
          <section className="mt-5 px-1" aria-live="polite" aria-label="Análise dos registros confirmados">
            {m.analysis.status === "pending" ? (
              <AnalysisLoading compact
                label={stageLabel(m.analysis.stage, "Analisando o registro salvo, com o histórico como referência...")} />
            ) : m.analysis.status === "ready" ? (
              <AnalysisText text={m.analysis.text ?? ""} />
            ) : (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-muted-foreground">
                  Os registros foram salvos, mas a análise não ficou pronta. {m.analysis.text}
                </p>
                {m.analysis.recordRefs.length > 0 && (
                  <Button variant="outline" size="sm" onClick={onRetrySavedAnalysis}>
                    <RefreshCw className="size-4" /> Tentar análise novamente
                  </Button>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
