import { createContext, useContext } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SavedRecordRef, ValidationPayload } from "@/lib/api-schemas";
import type { AnalysisStage } from "@/lib/analysis-progress";

export type ChatMessage = { createdAt?: string } & (
  | { id: string; role: "user"; kind: "text"; text: string }
  | {
      id: string;
      role: "user";
      kind: "image";
      imageUrl?: string;
      imageUrls?: string[];
      imageCount?: number;
      caption: string;
    }
  | { id: string; role: "assistant"; kind: "loading"; inputKind?: "text" | "image"; stage?: AnalysisStage }
  | { id: string; role: "assistant"; kind: "deferred"; jobId: string; processing?: boolean }
  | {
      id: string;
      role: "assistant";
      kind: "correction";
      sourceText: string;
      targetCount: number;
      status: "pending" | "applied" | "dismissed" | "unverified";
    }
  | { id: string; role: "assistant"; kind: "text"; text: string }
  | {
      id: string;
      role: "assistant";
      kind: "error";
      text: string;
      retryable: boolean;
      editMeals?: boolean;
      retryInput?: RetryInput;
      photoJobId?: string;
      acknowledged?: boolean;
    }
  | {
      id: string;
      role: "assistant";
      kind: "validation";
      payload: ValidationPayload;
      status: "pending" | "saved" | "discarded";
      analysis?: {
        status: "pending" | "ready" | "failed";
        stage?: AnalysisStage;
        recordRefs: SavedRecordRef[];
        text?: string;
      };
    });

export type RetryInput =
  | { kind: "text"; text: string; previousUserText?: string }
  | {
      kind: "image";
      images: { imageBase64: string; mimeType: string }[];
      caption: string;
    };

export type ChatHistoryStatus = "idle" | "loading" | "ready" | "error";

export type ChatContextValue = {
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  historyStatus: ChatHistoryStatus;
  retryHistory: () => void;
  historySyncError: boolean;
};

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat() {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat deve ser usado dentro de ChatProvider");
  return value;
}
