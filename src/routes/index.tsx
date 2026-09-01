import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ChatFeed } from "@/components/chat/ChatFeed";
import { Composer, type ComposerSubmit } from "@/components/chat/Composer";
import {
  getApiErrorMessage,
  isRetryableApiError,
  prepareHealthExamFile,
  processInput,
} from "@/lib/api";
import { toast } from "sonner";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useChat, type ChatMessage, type RetryInput } from "@/providers/chat-context";

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
  const { messages, setMessages } = useChat();
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
            imageUrl: s.previewUrl,
            caption: s.caption,
          };
    const loadingId = uid();
    setMessages((m) => [...m, userMsg, { id: loadingId, role: "assistant", kind: "loading" }]);

    let retryInput: RetryInput | undefined;
    try {
      retryInput = await makeRetryInput(s);
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
      current.map((item) => (item.id === id ? { id, role: "assistant", kind: "loading" } : item)),
    );
    try {
      await analyze(id, message.retryInput);
    } catch (e) {
      showAnalysisError(id, e, message.retryInput);
    } finally {
      setBusy(false);
    }
  }

  async function analyze(id: string, input: RetryInput) {
    const payload = await processInput(
      input.kind === "text"
        ? { text: input.text }
        : {
            imageBase64: input.imageBase64,
            text: input.caption || undefined,
            mimeType: input.mimeType,
          },
    );
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
    setMessages((current) =>
      current.map((message) =>
        message.id === id
          ? {
              id,
              role: "assistant",
              kind: "error",
              text: `Não consegui analisar este registro. ${errorMessage}`,
              retryable: isRetryableApiError(error),
              retryInput,
            }
          : message,
      ),
    );
    toast.error(errorMessage);
  }

  function resolveValidation(id: string, status: "saved" | "discarded") {
    setMessages((m) =>
      m.map((msg) =>
        msg.id === id && msg.role === "assistant" && msg.kind === "validation"
          ? { ...msg, status }
          : msg,
      ),
    );
  }

  return (
    <AppShell title="Consultor de Saúde">
      <div className="flex h-full w-full flex-col overflow-hidden">
        {/* O ChatFeed ocupa todo o espaço vertical disponível */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatFeed
            messages={messages}
            onValidationResolved={resolveValidation}
            onRetry={retryAnalysis}
          />
        </div>

        {/* O Composer fica preso na parte inferior sem empurrar a tela */}
        <Composer disabled={busy} onSubmit={handleSubmit} />
      </div>
    </AppShell>
  );
}

async function makeRetryInput(s: ComposerSubmit): Promise<RetryInput> {
  if (s.kind === "text") return { kind: "text", text: s.text };
  const prepared = await prepareHealthExamFile(s.file);
  return {
    kind: "image",
    imageBase64: prepared.file_base64,
    mimeType: prepared.mime_type,
    caption: s.caption,
  };
}
