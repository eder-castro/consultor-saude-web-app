import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChatContext, type ChatMessage } from "@/providers/chat-context";
import { useAuth } from "@/providers/auth-context";

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const { user } = useAuth();
  const previousUserId = useRef<string | null>(user?.id ?? null);

  useEffect(() => {
    const nextUserId = user?.id ?? null;
    if (previousUserId.current !== nextUserId) {
      setMessages([]);
      previousUserId.current = nextUserId;
    }
  }, [user?.id]);

  const value = useMemo(() => ({ messages, setMessages }), [messages]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
