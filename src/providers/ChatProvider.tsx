import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChatContext, type ChatMessage } from "@/providers/chat-context";
import { useAuth } from "@/providers/auth-context";
import { getChatHistory, saveChatHistory, type ChatHistoryRow } from "@/lib/api";
import { ValidationPayloadSchema } from "@/lib/api-schemas";

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hydratedOwnerId, setHydratedOwnerId] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) {
      setMessages([]);
      setHydratedOwnerId(null);
      return;
    }
    let cancelled = false;
    setHydratedOwnerId(null);
    void getChatHistory()
      .then((rows) => {
        if (cancelled) return;
        setMessages(
          rows
            .filter((row) => getSaoPauloDateKey(new Date(row.created_at)) === getSaoPauloDateKey())
            .map(deserializeMessage)
            .filter((message): message is ChatMessage => !!message),
        );
        setHydratedOwnerId(user.id);
      })
      .catch(() => {
        if (cancelled) return;
        setMessages([]);
        setHydratedOwnerId(user.id);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let timer: number;
    const scheduleRollover = () => {
      timer = window.setTimeout(() => {
        setMessages([]);
        scheduleRollover();
      }, millisecondsUntilNextSaoPauloDay());
    };
    scheduleRollover();
    return () => window.clearTimeout(timer);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || hydratedOwnerId !== user.id) return;
    const persistent = messages
      .map(serializeMessage)
      .filter((message): message is Omit<ChatHistoryRow, "created_at"> => !!message);
    const timer = window.setTimeout(() => {
      void saveChatHistory(persistent).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [hydratedOwnerId, messages, user?.id]);

  const value = useMemo(() => ({ messages, setMessages }), [messages]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

function serializeMessage(
  message: ChatMessage,
  sequence: number,
): Omit<ChatHistoryRow, "created_at"> | null {
  if (message.kind === "loading") return null;
  if (message.kind === "text") {
    return {
      client_id: message.id,
      role: message.role,
      kind: "text",
      payload: { text: message.text },
      sequence,
    };
  }
  if (message.kind === "image") {
    return {
      client_id: message.id,
      role: "user",
      kind: "image",
      payload: {
        caption: message.caption,
        image_count: message.imageUrls?.length ?? message.imageCount ?? (message.imageUrl ? 1 : 1),
      },
      sequence,
    };
  }
  if (message.kind === "error") {
    return {
      client_id: message.id,
      role: "assistant",
      kind: "text",
      payload: { text: message.text, error: true },
      sequence,
    };
  }
  return {
    client_id: message.id,
    role: "assistant",
    kind: "validation",
    payload: { validation: message.payload, status: message.status },
    sequence,
  };
}

function deserializeMessage(row: ChatHistoryRow): ChatMessage | null {
  if (row.kind === "text" && row.role === "assistant" && row.payload.error === true) {
    if (typeof row.payload.text !== "string") return null;
    return {
      id: row.client_id,
      role: "assistant",
      kind: "error",
      text: row.payload.text,
      retryable: false,
    };
  }
  if (row.kind === "text" && typeof row.payload.text === "string") {
    return { id: row.client_id, role: row.role, kind: "text", text: row.payload.text };
  }
  if (row.kind === "image" && row.role === "user") {
    return {
      id: row.client_id,
      role: "user",
      kind: "image",
      caption: typeof row.payload.caption === "string" ? row.payload.caption : "",
      imageCount:
        typeof row.payload.image_count === "number" && row.payload.image_count > 0
          ? Math.min(6, Math.round(row.payload.image_count))
          : 1,
    };
  }
  if (row.kind === "validation" && row.role === "assistant") {
    const parsed = ValidationPayloadSchema.safeParse(row.payload.validation);
    const status = row.payload.status;
    if (!parsed.success || !["pending", "saved", "discarded"].includes(String(status))) return null;
    return {
      id: row.client_id,
      role: "assistant",
      kind: "validation",
      payload: parsed.data,
      status: status as "pending" | "saved" | "discarded",
    };
  }
  return null;
}

function getSaoPauloDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function millisecondsUntilNextSaoPauloDay(): number {
  const now = Date.now();
  const today = getSaoPauloDateKey(new Date(now));
  let low = now;
  let high = now + 30 * 60 * 60 * 1000;

  while (high - low > 1_000) {
    const middle = Math.floor((low + high) / 2);
    if (getSaoPauloDateKey(new Date(middle)) === today) low = middle;
    else high = middle;
  }

  return Math.max(1_000, high - now + 100);
}
