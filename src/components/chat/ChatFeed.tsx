import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ValidationCard } from "./ValidationCard";
import type { ChatMessage } from "@/providers/chat-context";

export function ChatFeed({
  messages,
  onValidationResolved,
  onRetry,
}: {
  messages: ChatMessage[];
  onValidationResolved: (id: string, status: "saved" | "discarded") => void;
  onRetry: (id: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  return (
    <div className="h-full min-w-0 w-full overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-5 sm:px-8 sm:py-10">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-end gap-7">
        {/* Saudação limpa e fixa no topo do histórico */}
        <div className="pb-2">
          <GreetingHeader />
        </div>

        {/* As mensagens do chat entram aqui embaixo */}
        {messages.map((m) => (
          <Bubble
            key={m.id}
            m={m}
            onResolved={(s) => onValidationResolved(m.id, s)}
            onRetry={() => onRetry(m.id)}
          />
        ))}

        <div ref={bottomRef} />
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
      <div className="text-base leading-relaxed text-muted-foreground sm:text-lg">
        <p>Como posso ajudar no seu registro de hoje?</p>
        <ul className="mt-4 space-y-2 text-sm sm:text-base">
          <li>Enviando uma foto de uma refeição</li>
          <li>Enviando um print de aplicativo (Sono / Atividade Física)</li>
          <li>Conversando naturalmente pelo chat</li>
        </ul>
      </div>
    </div>
  );
}

function Bubble({
  m,
  onResolved,
  onRetry,
}: {
  m: ChatMessage;
  onResolved: (s: "saved" | "discarded") => void;
  onRetry: () => void;
}) {
  if (m.role === "user") {
    if (m.kind === "image") {
      const imageUrls = m.imageUrls ?? (m.imageUrl ? [m.imageUrl] : []);
      return (
        <div className="flex justify-end">
          <div className="max-w-[98%] text-base leading-relaxed sm:max-w-[88%]">
            <div className={`grid gap-3 ${imageUrls.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {imageUrls.length ? (
                imageUrls.map((url, index) => (
                  <div
                    key={`${url}-${index}`}
                    className="overflow-hidden rounded-2xl border border-border/70 bg-transparent p-0.5"
                  >
                    <img
                      src={url}
                      alt={`imagem enviada ${index + 1}`}
                      className="max-h-[32rem] min-h-40 w-full rounded-xl object-contain"
                    />
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  {(m.imageCount ?? 1) === 1
                    ? "Imagem analisada"
                    : `${m.imageCount} imagens analisadas em conjunto`}
                </p>
              )}
            </div>
            {m.caption && (
              <p className="mt-3 break-words px-1 text-muted-foreground">{m.caption}</p>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-end">
        <div className="max-w-[92%] rounded-2xl rounded-tr-sm bg-muted px-5 py-3 text-base leading-relaxed text-foreground sm:max-w-[85%]">
          <p className="whitespace-pre-wrap break-words">{m.text}</p>
        </div>
      </div>
    );
  }

  if (m.kind === "loading") {
    return (
      <div className="flex justify-start">
        <div
          className="w-full max-w-[90%] space-y-3 rounded-2xl rounded-tl-sm border border-border/60 bg-card/50 p-4"
          aria-label="Analisando registro"
        >
          <p className="text-sm text-muted-foreground">Analisando seu registro...</p>
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    );
  }

  if (m.kind === "text") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[92%] px-1 py-2 text-base leading-relaxed sm:max-w-[85%]">
          {m.text}
        </div>
      </div>
    );
  }

  if (m.kind === "error") {
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[92%] space-y-3 rounded-3xl rounded-tl-sm border border-destructive/30 bg-destructive/5 px-4 py-3 text-base leading-relaxed sm:max-w-[85%]">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-1 size-4 shrink-0 text-destructive" />
            <p className="min-w-0 break-words">{m.text}</p>
          </div>
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
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-full">
        <ValidationCard payload={m.payload} status={m.status} onResolved={onResolved} />
      </div>
    </div>
  );
}
