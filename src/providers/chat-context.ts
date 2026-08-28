import { createContext, useContext } from "react";
import type { Dispatch, SetStateAction } from "react";
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

export type ChatContextValue = {
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
};

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat() {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat deve ser usado dentro de ChatProvider");
  return value;
}
