import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ChatFeed } from "@/components/chat/ChatFeed";
import { Composer, type ComposerSubmit } from "@/components/chat/Composer";
import { fileToBase64, getApiErrorMessage, processInput } from "@/lib/api";
import { toast } from "sonner";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useChat } from "@/providers/chat-context";

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

    try {
      const payload =
        s.kind === "text"
          ? await processInput({ text: s.text })
          : await processInput({
              imageBase64: await fileToBase64(s.file),
              text: s.caption || undefined,
              mimeType: s.file.type,
            });

      setMessages((m) =>
        m.map((msg) =>
          msg.id === loadingId
            ? {
                id: loadingId,
                role: "assistant",
                kind: "validation",
                payload,
                status: "pending",
              }
            : msg,
        ),
      );
    } catch (e) {
      const errorMessage = getApiErrorMessage(e);
      setMessages((m) =>
        m.map((msg) =>
          msg.id === loadingId
            ? {
                id: loadingId,
                role: "assistant",
                kind: "text",
                text: `Não consegui analisar este registro. ${errorMessage}`,
              }
            : msg,
        ),
      );
      toast.error(errorMessage);
    } finally {
      setBusy(false);
    }
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
          <ChatFeed messages={messages} onValidationResolved={resolveValidation} />
        </div>

        {/* O Composer fica preso na parte inferior sem empurrar a tela */}
        <Composer disabled={busy} onSubmit={handleSubmit} />
      </div>
    </AppShell>
  );
}
