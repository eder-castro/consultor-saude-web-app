import { z } from "zod";
import { readSessionState, sessionDay, writeSessionState } from "./session-state";
import type { ChatHistoryRow } from "./api";
import type { ChatMessage } from "@/providers/chat-context";

const RowsSchema = z.array(z.object({
  client_id: z.string(),
  role: z.enum(["user", "assistant"]),
  kind: z.enum(["text", "image", "validation"]),
  payload: z.record(z.unknown()),
  sequence: z.number(),
  created_at: z.string().datetime({ offset: true }),
})).max(500);

export function readChatSession(ownerId: string) {
  return readSessionState("chat", ownerId, RowsSchema);
}

export function writeChatSession(ownerId: string, rows: Omit<ChatHistoryRow, "created_at">[]) {
  writeSessionState("chat", ownerId, rows.slice(-500).map((row) => ({
    ...row,
    created_at: typeof row.payload.sent_at === "string"
      ? row.payload.sent_at : `${sessionDay()}T12:00:00-03:00`,
  })));
}

// A slow refresh must not overwrite an edit, a just-sent message or a result
// that arrived while the saved history was being fetched.
export function mergeRefreshedHistory(
  remote: ChatMessage[], current: ChatMessage[], baseline: ChatMessage[],
) {
  const original = new Map(baseline.map((message) => [message.id, JSON.stringify(message)]));
  const local = new Map(current.map((message) => [message.id, message]));
  const remoteIds = new Set(remote.map((message) => message.id));
  return [
    ...remote.map((message) => {
      const latest = local.get(message.id);
      return latest && JSON.stringify(latest) !== original.get(message.id) ? latest : message;
    }),
    ...current.filter((message) => !remoteIds.has(message.id)),
  ];
}
