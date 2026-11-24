import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { useAuth } from "./auth-context";
import { readSessionState, sessionDay, writeSessionState } from "@/lib/session-state";

type Attachment = { file: File; url: string };
type Draft = { text: string; files: Attachment[] };
type DraftContext = {
  draft: Draft;
  setText: (text: string) => void;
  addFiles: (files: File[]) => void;
  removeFile: (url: string) => void;
  takeDraft: () => void;
};
const Context = createContext<DraftContext | null>(null);
const EMPTY: Draft = { text: "", files: [] };

export function ComposerDraftProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // A keyed inner provider cannot expose a previous account's draft.
  return <OwnerDraft key={user?.id ?? "signed-out"} ownerId={user?.id}>{children}</OwnerDraft>;
}

function OwnerDraft({ children, ownerId }: { children: ReactNode; ownerId?: string }) {
  const [draft, setDraft] = useState<Draft>(() => ({
    text: ownerId ? readSessionState("composer", ownerId, z.string().max(50_000)) ?? "" : "",
    files: [],
  }));
  const current = useRef(draft);
  current.current = draft;
  const day = useRef(sessionDay());
  const update = useCallback((next: Draft) => {
    current.current = next;
    setDraft(next);
    if (ownerId) writeSessionState("composer", ownerId, next.text.slice(0, 50_000));
  }, [ownerId]);

  useEffect(() => {
    const rollover = () => {
      if (day.current === sessionDay()) return;
      day.current = sessionDay();
      current.current.files.forEach(({ url }) => URL.revokeObjectURL(url));
      update(EMPTY);
    };
    const timer = window.setInterval(rollover, 30_000);
    document.addEventListener("visibilitychange", rollover);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", rollover);
      current.current.files.forEach(({ url }) => URL.revokeObjectURL(url));
    };
  }, [update]);

  return <Context.Provider value={{
    draft,
    setText: (text) => update({ ...current.current, text }),
    addFiles: (files) => {
      const selected = files.filter((file) => file.type.startsWith("image/"))
        .slice(0, Math.max(0, 6 - current.current.files.length))
        .map((file) => ({ file, url: URL.createObjectURL(file) }));
      update({ ...current.current, files: [...current.current.files, ...selected] });
    },
    removeFile: (url) => {
      URL.revokeObjectURL(url);
      update({ ...current.current, files: current.current.files.filter((file) => file.url !== url) });
    },
    // Sending transfers preview ownership to the chat; do not revoke those URLs.
    takeDraft: () => update(EMPTY),
  }}>{children}</Context.Provider>;
}

export function useComposerDraft() {
  const value = useContext(Context);
  if (!value) throw new Error("ComposerDraftProvider ausente");
  return value;
}
