import { useEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ValidationCard } from "./ValidationCard";
import type { ValidationPayload } from "@/lib/api-schemas";

export type ChatMessage =
  | { id: string; role: "user"; kind: "text"; text: string }
  | { id: string; role: "user"; kind: "image"; imageUrl: string; caption: string }
  | { id: string; role: "assistant"; kind: "loading" }
  | { id: string; role: "assistant"; kind: "text"; text: string }
  | {
      id: string;
      role: "assistant";
      kind: "validation";
      payload: ValidationPayload;
      status: "pending" | "saved" | "discarded";
    };

export function ChatFeed({
  messages,
  onValidationResolved,
}: {
  messages: ChatMessage[];
  onValidationResolved: (id: string, status: "saved" | "discarded") => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {messages.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Comece registrando algo: digite o que comeu/bebeu ou envie uma foto da refeição.
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} onResolved={(s) => onValidationResolved(m.id, s)} />
        ))}
        <div ref={bottomRef} />
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
