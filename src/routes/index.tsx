import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { ChatFeed } from "@/components/chat/ChatFeed";
import { Composer, type ComposerSubmit } from "@/components/chat/Composer";
import {
  ApiError,
  analyzeSavedRecords,
  getApiErrorMessage,
  isRetryableApiError,
  cancelPhotoJob,
  prepareHealthImages,
  processInput,
  reviewPhotoJob,
} from "@/lib/api";
import { toast } from "sonner";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useChat, type ChatMessage, type RetryInput } from "@/providers/chat-context";
import type { SavedRecordRef, ValidationGroup } from "@/lib/api-schemas";
import type { AnalysisStage } from "@/lib/analysis-progress";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Consultor de Saúde — Chat" },
      {
        name: "description",
        content:
          "Registre alimentação, hidratação, exercícios, sono e peso por chat com validação inteligente.",
      },
    ],
  }),
  component: ProtectedChatPage,
});

const uid = () => Math.random().toString(36).slice(2, 10);

function ProtectedChatPage() {
  return (
    <ProtectedRoute>
      <ChatPage />
    </ProtectedRoute>
  );
}

function ChatPage() {
  const queryClient = useQueryClient();
  const { messages, setMessages, historyStatus, retryHistory, historySyncError } = useChat();
  const [busy, setBusy] = useState(false);

  async function handleSubmit(s: ComposerSubmit) {
    setBusy(true);
    const userMsg: ChatMessage =
      s.kind === "text"
        ? { id: uid(), role: "user", kind: "text", text: s.text }
        : {
            id: uid(),
            role: "user",
            kind: "image",
            imageUrls: s.previewUrls,
            imageCount: s.previewUrls.length,
            caption: s.caption,
          };
    const loadingId = crypto.randomUUID();
    setMessages((m) => [...m, userMsg, {
      id: loadingId, role: "assistant", kind: "loading", inputKind: s.kind,
      stage: s.kind === "image" ? "preparing_images" : "sending_input",
    }]);

    let retryInput: RetryInput | undefined;
    try {
      retryInput = await makeRetryInput(s);
      if (retryInput.kind === "text") {
        const previousUser = [...messages].reverse().find((message) => message.role === "user");
        retryInput.previousUserText = previousUser?.kind === "text"
          ? previousUser.text : previousUser?.kind === "image" ? previousUser.caption : undefined;
      }
      await analyze(loadingId, retryInput);
    } catch (e) {
      showAnalysisError(loadingId, e, retryInput);
    } finally {
      setBusy(false);
    }
  }

  async function retryAnalysis(id: string) {
    const message = messages.find(
      (item): item is Extract<ChatMessage, { kind: "error" }> =>
        item.id === id && item.role === "assistant" && item.kind === "error",
    );
    if (!message?.retryInput || busy) return;

    setBusy(true);
    setMessages((current) =>
      current.map((item) => (item.id === id
        ? { id, role: "assistant", kind: "loading", inputKind: message.retryInput?.kind,
            stage: "sending_input" }
        : item)),
    );
    try {
      await analyze(id, message.retryInput);
    } catch (e) {
      showAnalysisError(id, e, message.retryInput);
    } finally {
      setBusy(false);
    }
  }

  function updateStage(id: string, stage: AnalysisStage) {
    setMessages((current) => current.map((message) =>
      message.id === id && message.kind === "loading"
        ? { ...message, stage }
        : message,
    ));
  }

  async function analyze(id: string, input: RetryInput) {
    updateStage(id, "sending_input");
    const payload = await processInput(
      input.kind === "text"
        ? { text: input.text, previousUserMessage: input.previousUserText }
        : {
            images: input.images,
            text: input.caption || undefined,
          },
      (stage) => updateStage(id, stage),
    );
    if ("pending_job_id" in payload) {
      const jobId = payload.pending_job_id;
      setMessages((current) =>
        current.map((message) =>
          message.id === id
            ? { id: `photo-job:${jobId}`, role: "assistant", kind: "deferred", jobId, createdAt: message.createdAt }
            : message,
        ),
      );
      toast.info("Foto aguardando nova tentativa. Avisaremos neste app quando estiver pronta.");
      return;
    }
    if ("kind" in payload && (payload.kind === "day_analysis" || payload.kind === "period_analysis")) {
      setMessages((current) =>
        current.map((message) =>
          message.id === id
            ? {
                id,
                role: "assistant",
                kind: "text",
                createdAt: message.createdAt,
                text: payload.kind === "day_analysis"
                  ? `Análise do dia — ${payload.date.split("-").reverse().join("/")}\n\n${payload.analysis}`
                  : `Análise do período — ${payload.start_date.split("-").reverse().join("/")} a ${payload.end_date.split("-").reverse().join("/")}\n\n${payload.analysis}`,
              }
            : message,
        ),
      );
      return;
    }
    if ("kind" in payload && payload.kind === "meal_correction") {
      setMessages((current) =>
        current.map((message) =>
          message.id === id
            ? {
                id, role: "assistant", kind: "correction",
                sourceText: payload.source_text, targetCount: payload.target_count,
                status: "pending",
              }
            : message,
        ),
      );
      return;
    }
    setMessages((current) =>
      current.map((message) =>
        message.id === id
          ? {
              id,
              role: "assistant",
              kind: "validation",
              payload,
              status: "pending",
            }
          : message,
      ),
    );
  }

  function showAnalysisError(id: string, error: unknown, retryInput?: RetryInput) {
    const errorMessage = getApiErrorMessage(error);
    const editMeals = error instanceof ApiError && error.status === 409;
    const displayMessage = retryInput?.kind === "image" && !errorMessage.includes("Nenhum registro foi criado")
      ? `${errorMessage} A foto não foi analisada e nenhum registro foi criado.`
      : errorMessage;
    setMessages((current) =>
      current.map((message) =>
        message.id === id
          ? {
              id,
              role: "assistant",
              kind: "error",
              text: editMeals ? displayMessage : `Não consegui analisar este registro. ${displayMessage}`,
              retryable: isRetryableApiError(error),
              editMeals,
              retryInput,
            }
          : message,
      ),
    );
    toast.error(displayMessage);
  }

  async function runSavedAnalysis(id: string, recordRefs: SavedRecordRef[]) {
    try {
      const text = await analyzeSavedRecords(recordRefs, (stage) => {
        setMessages((current) => current.map((message) =>
          message.id === id && message.kind === "validation" && message.analysis?.status === "pending"
            ? { ...message, analysis: { ...message.analysis, stage } }
            : message,
        ));
      });
      setMessages((current) => current.map((message) =>
        message.id === id && message.kind === "validation" && message.status === "saved"
          ? { ...message, analysis: { status: "ready", recordRefs, text } }
          : message,
      ));
    } catch (error) {
      const text = getApiErrorMessage(error);
      setMessages((current) => current.map((message) =>
        message.id === id && message.kind === "validation" && message.status === "saved"
          ? { ...message, analysis: { status: "failed", recordRefs, text } }
          : message,
      ));
    }
  }

  function retrySavedAnalysis(id: string) {
    const message = messages.find((item) => item.id === id);
    if (message?.kind !== "validation" || message.status !== "saved" ||
        message.analysis?.status !== "failed" || !message.analysis.recordRefs.length) return;
    const refs = message.analysis.recordRefs;
    setMessages((current) => current.map((item) =>
      item.id === id && item.kind === "validation"
        ? { ...item, analysis: { status: "pending", recordRefs: refs,
            stage: "loading_saved_context" } }
        : item,
    ));
    void runSavedAnalysis(id, refs);
  }

  function resolveValidation(
    id: string, status: "saved" | "discarded",
    reviewedGroups?: ValidationGroup[], recordRefs?: SavedRecordRef[],
  ) {
    setMessages((m) =>
      m.map((msg) =>
        msg.id === id && msg.role === "assistant" && msg.kind === "validation"
          ? {
              ...msg, status,
              payload: reviewedGroups ? { ...msg.payload, grupos: reviewedGroups } : msg.payload,
              analysis: status === "saved"
                 ? { status: recordRefs?.length ? "pending" : "failed", recordRefs: recordRefs ?? [],
                     stage: "loading_saved_context",
                    ...(recordRefs?.length ? {} : { text: "Não foi possível vincular os registros salvos à análise." }) }
                : undefined,
            }
          : msg,
      ),
    );
    if (status === "saved" && recordRefs?.length) void runSavedAnalysis(id, recordRefs);
    if (status === "saved") {
      for (const key of ["daily-summary", "weekly-summary", "sleep-records", "sleep-reviews",
        "dated-records", "health-context"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    }
    if (id.startsWith("photo-job:")) {
      void reviewPhotoJob(id.slice("photo-job:".length)).catch(() =>
        toast.error("Não foi possível atualizar o status da análise. Tente abrir o app novamente."),
      );
    }
  }

  function editValidationDraft(id: string, groups: ValidationGroup[]) {
    setMessages((current) => current.map((message) =>
      message.id === id && message.kind === "validation" && message.status === "pending"
        ? { ...message, payload: { ...message.payload, grupos: groups } }
        : message,
    ));
  }

  function resolveCorrection(id: string, status: "applied" | "dismissed" | "unverified") {
    setMessages((current) => current.map((message) =>
      message.id === id && message.kind === "correction"
        ? { ...message, status }
        : message,
    ));
  }

  function dismissFailedPhotoError(id: string) {
    setMessages((current) => current.map((message) =>
      message.id === id && message.kind === "error" && message.photoJobId
        ? { ...message, acknowledged: true }
        : message,
    ));
  }

  async function cancelPendingPhoto(jobId: string) {
    try {
      await cancelPhotoJob(jobId);
      setMessages((current) =>
        current.map((message) =>
          message.id === `photo-job:${jobId}`
            ? {
                id: message.id, role: "assistant", kind: "error", retryable: false,
                text: "Novas tentativas canceladas. A foto temporária foi excluída.",
              }
            : message,
        ),
      );
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  }

  return (
    <AppShell title="Consultor de Saúde">
      <div className="flex h-full w-full flex-col overflow-hidden">
        {historySyncError && historyStatus === "ready" && (
          <div role="alert" className="shrink-0 border-b border-border px-4 py-2 text-sm">
            Não foi possível atualizar as conversas anteriores. Você pode continuar usando o chat;
            as novas mensagens desta aba serão sincronizadas quando o histórico carregar.
            {" "}<button className="underline" onClick={retryHistory}>Tentar novamente</button>
          </div>
        )}
        {/* O ChatFeed ocupa todo o espaço vertical disponível */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatFeed
            messages={messages}
            historyStatus={historyStatus}
            onRetryHistory={retryHistory}
            onDismissPhotoError={dismissFailedPhotoError}
          onValidationResolved={resolveValidation}
          onValidationEdited={editValidationDraft}
            onCorrectionResolved={resolveCorrection}
            onRetry={retryAnalysis}
            onRetrySavedAnalysis={retrySavedAnalysis}
            onCancelPhoto={(jobId) => void cancelPendingPhoto(jobId)}
          />
        </div>

        {/* O Composer fica preso na parte inferior sem empurrar a tela */}
        <Composer
          disabled={busy || messages.some((message) => message.kind === "loading") || historyStatus !== "ready"}
          onSubmit={handleSubmit}
        />
      </div>
    </AppShell>
  );
}

async function makeRetryInput(s: ComposerSubmit): Promise<RetryInput> {
  if (s.kind === "text") return { kind: "text", text: s.text };
  const prepared = await prepareHealthImages(s.files);
  return {
    kind: "image",
    images: prepared.map((image) => ({
      imageBase64: image.file_base64,
      mimeType: image.mime_type,
    })),
    caption: s.caption,
  };
}
