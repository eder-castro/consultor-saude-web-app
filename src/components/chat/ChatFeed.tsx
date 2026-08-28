import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ValidationCard } from "./ValidationCard";
import type { ChatMessage } from "@/providers/chat-context";

export function ChatFeed({
  messages,
  onValidationResolved,
}: {
  messages: ChatMessage[];
  onValidationResolved: (id: string, status: "saved" | "discarded") => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  return (
    <div className="h-full w-full overflow-y-auto px-4 py-4">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-end gap-3">
        {/* Saudação limpa e fixa no topo do histórico */}
        <div className="pb-2">
          <GreetingHeader />
        </div>

        {/* As mensagens do chat entram aqui embaixo */}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} onResolved={(s) => onValidationResolved(m.id, s)} />
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
    <div className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">{greeting}</h2>
      <div className="text-sm leading-relaxed text-muted-foreground">
        <p>Faça um registro:</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Enviando uma foto de uma refeição</li>
          <li>Enviando um print de aplicativo (Sono / Atividade Física)</li>
          <li>Conversando naturally pelo chat</li>
        </ul>
      </div>
    </div>
  );
}

function Bubble({
  m,
  onResolved,
}: {
  m: ChatMessage;
  onResolved: (s: "saved" | "discarded") => void;
}) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
          {m.kind === "image" ? (
            <div className="space-y-2">
              <img
                src={m.imageUrl}
                alt="enviada"
                className="max-h-64 w-full rounded-lg object-cover"
              />
              {m.caption && <p>{m.caption}</p>}
            </div>
          ) : (
            <p className="whitespace-pre-wrap">{m.text}</p>
          )}
        </div>
      </div>
    );
  }

  if (m.kind === "loading") {
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[90%] space-y-2 rounded-2xl rounded-tl-sm border border-border bg-card p-3">
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
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-border bg-card px-3.5 py-2.5 text-sm">
          {m.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[95%]">
        <ValidationCard payload={m.payload} status={m.status} onResolved={onResolved} />
      </div>
    </div>
  );
}
