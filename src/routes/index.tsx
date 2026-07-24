import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ChatFeed, type ChatMessage } from "@/components/chat/ChatFeed";
import { Composer, type ComposerSubmit } from "@/components/chat/Composer";
import { fileToBase64, processInput } from "@/lib/api";
import { toast } from "sonner";
import { Sun, CloudSun, Moon } from "lucide-react";

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
  component: ChatPage,
});

const uid = () => Math.random().toString(36).slice(2, 10);

function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
    setMessages((m) => [
      ...m,
      userMsg,
      { id: loadingId, role: "assistant", kind: "loading" },
    ]);

    try {
      const payload =
        s.kind === "text"
          ? await processInput({ text: s.text })
          : await processInput({
              imageBase64: await fileToBase64(s.file),
              text: s.caption || undefined,
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
      setMessages((m) =>
        m.map((msg) =>
          msg.id === loadingId
            ? {
                id: loadingId,
                role: "assistant",
                kind: "text",
                text: "Não consegui analisar agora. Tente novamente.",
              }
            : msg,
        ),
      );
      toast.error(e instanceof Error ? e.message : "Erro de processamento.");
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
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">
          <GreetingHeader />
          <ChatFeed messages={messages} onValidationResolved={resolveValidation} />
        </div>
        <Composer disabled={busy} onSubmit={handleSubmit} />
      </div>
    </AppShell>
  );
}

type DayPeriod = "morning" | "afternoon" | "evening";

const MESSAGES: Record<DayPeriod, string[]> = {
  morning: [
    "Vamos cuidar da sua saúde hoje?",
    "Pronto para registrar suas refeições?",
    "Comece o dia com o pé direito.",
    "Um bom dia começa com bons hábitos.",
  ],
  afternoon: [
    "Como vai o seu dia?",
    "Hora de acompanhar seus hábitos.",
    "Mantenha o ritmo!",
    "A tarde é ótima para uma pausa saudável.",
  ],
  evening: [
    "Vamos revisar o dia?",
    "Registre o jantar e descanse.",
    "Bom trabalho hoje!",
    "Termine o dia com consciência tranquila.",
  ],
};

function getPeriod(hour: number): DayPeriod {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

function GreetingHeader() {
  const now = new Date();
  const period = getPeriod(now.getHours());
  const greeting =
    period === "morning" ? "Bom dia" : period === "afternoon" ? "Boa tarde" : "Boa noite";

  const message = useMemo(() => {
    const list = MESSAGES[period];
    return list[Math.floor(Math.random() * list.length)];
  }, [period]);

  const Icon = period === "morning" ? Sun : period === "afternoon" ? CloudSun : Moon;
  const iconColor =
    period === "morning"
      ? "text-amber-300"
      : period === "afternoon"
        ? "text-orange-300"
        : "text-indigo-300";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm">
        <div className="absolute -right-6 -top-6 size-24 rounded-full bg-primary/10 blur-2xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">
              {greeting}, usuário
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>
          </div>
          <div
            className={`flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background/80 ${iconColor} glow-primary`}
          >
            <Icon className="size-6" />
          </div>
        </div>
      </div>
    </div>
  );
}
