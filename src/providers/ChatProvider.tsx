import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { ChatContext, type ChatHistoryStatus, type ChatMessage } from "@/providers/chat-context";
import { MealCorrectionProposalSchema, SavedRecordRefSchema } from "@/lib/api-schemas";
import { useAuth } from "@/providers/auth-context";
import { getChatHistory, getMealCorrectionStatuses, getPhotoJobs, saveChatHistory, type ChatHistoryRow } from "@/lib/api";
import type { PhotoJob } from "@/lib/api";
import { ValidationPayloadSchema } from "@/lib/api-schemas";
import { toast } from "sonner";
import { readChatSession, writeChatSession, mergeRefreshedHistory } from "@/lib/chat-session-cache";

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setRawMessages] = useState<ChatMessage[]>([]);
  const setMessages: Dispatch<SetStateAction<ChatMessage[]>> = useCallback((update) => {
    setRawMessages((current) => {
      const next = typeof update === "function" ? update(current) : update;
      if (next === current) return current;
      const previousTimes = new Map(current.map((message) => [message.id, message.createdAt]));
      const now = new Date().toISOString();
      return next.map((message) => validMessageTime(message.createdAt) ? message : ({
        ...message, createdAt: previousTimes.get(message.id) ?? now,
      }));
    });
  }, []);
  const [hydratedOwnerId, setHydratedOwnerId] = useState<string | null>(null);
  const [historyErrorOwnerId, setHistoryErrorOwnerId] = useState<string | null>(null);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [syncedOwnerId, setSyncedOwnerId] = useState<string | null>(null);
  const { user } = useAuth();
  const notifiedJobs = useRef(new Set<string>());
  const hydratedOwner = useRef(hydratedOwnerId);
  hydratedOwner.current = hydratedOwnerId;
  const previewUrls = useRef(new Set<string>());

  useEffect(() => {
    const next = new Set(messages.flatMap((message) => message.kind === "image"
      ? message.imageUrls ?? (message.imageUrl ? [message.imageUrl] : []) : []));
    previewUrls.current.forEach((url) => {
      if (!next.has(url)) URL.revokeObjectURL(url);
    });
    previewUrls.current = next;
  }, [messages]);
  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setMessages([]);
      setHydratedOwnerId(null);
      setHistoryErrorOwnerId(null);
      setSyncedOwnerId(null);
      notifiedJobs.current.clear();
      return;
    }
    let cancelled = false;
    const requestDay = getSaoPauloDateKey();
    const cached = readChatSession(user.id);
    const baseline = (cached ?? [])
      .filter((row) => getSaoPauloDateKey(new Date(row.created_at)) === requestDay)
      .map(deserializeMessage)
      .filter((message): message is ChatMessage => !!message)
      .map((message): ChatMessage =>
        message.kind === "correction" && message.status === "pending"
          ? { ...message, status: "unverified" } : message);
    // A retry keeps in-memory photos, pending requests and review edits intact.
    const alreadyHydrated = hydratedOwner.current === user.id;
    setMessages((current) => alreadyHydrated ? current : baseline);
    // The authenticated chat is usable immediately, even on a first visit with
    // no local snapshot. Remote history is reconciled in the background; only
    // server persistence must wait for that reconciliation.
    setHydratedOwnerId(user.id);
    setSyncedOwnerId(null);
    setHistoryErrorOwnerId(null);
    void getChatHistory()
      .then(async (rows) => {
        if (cancelled || requestDay !== getSaoPauloDateKey()) return;
        let restored = rows
            .filter((row) => getSaoPauloDateKey(new Date(row.created_at)) === getSaoPauloDateKey())
            .map(deserializeMessage)
            .filter((message): message is ChatMessage => !!message);
        const pendingIds = restored
          .filter((message) => message.kind === "correction" && message.status === "pending")
          .map((message) => message.id);
        if (pendingIds.length) {
          try {
            const applied = new Set(await getMealCorrectionStatuses(pendingIds));
            restored = restored.map((message) =>
              message.kind === "correction" && applied.has(message.id)
                ? { ...message, status: "applied" }
                : message,
            );
          } catch {
            restored = restored.map((message) =>
              message.kind === "correction" && message.status === "pending"
                ? { ...message, status: "unverified" }
                : message,
            );
          }
        }
        if (cancelled || requestDay !== getSaoPauloDateKey()) return;
        setMessages((current) => mergeRefreshedHistory(restored, current, baseline));
        setHydratedOwnerId(user.id);
        setSyncedOwnerId(user.id);
      })
      .catch(() => {
        if (cancelled) return;
        setHistoryErrorOwnerId(user.id);
      });
    return () => {
      cancelled = true;
    };
  }, [historyRetry, user?.id, setMessages]);

  useEffect(() => {
    if (!user?.id) return;
    let day = getSaoPauloDateKey();
    let timer: number;
    const rollover = () => {
      const today = getSaoPauloDateKey();
      if (day === today) return;
      day = today;
      setMessages([]);
      writeChatSession(user.id, []);
      setHistoryRetry((attempt) => attempt + 1);
    };
    const scheduleRollover = () => {
      timer = window.setTimeout(() => {
        rollover();
        scheduleRollover();
      }, millisecondsUntilNextSaoPauloDay());
    };
    scheduleRollover();
    document.addEventListener("visibilitychange", rollover);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", rollover);
    };
  }, [user?.id, setMessages]);

  const persistenceSnapshot = useMemo(() => JSON.stringify(
    messages
      .map(serializeMessage)
      .filter((message): message is Omit<ChatHistoryRow, "created_at"> => !!message),
  ), [messages]);

  useEffect(() => {
    if (!user?.id || hydratedOwnerId !== user.id) return;
    const persistent = JSON.parse(persistenceSnapshot) as Omit<ChatHistoryRow, "created_at">[];
    writeChatSession(user.id, persistent);
  }, [hydratedOwnerId, persistenceSnapshot, user?.id]);

  useEffect(() => {
    // Local snapshots must never overwrite server history before reconciliation.
    if (!user?.id || syncedOwnerId !== user.id) return;
    const persistent = JSON.parse(persistenceSnapshot) as Omit<ChatHistoryRow, "created_at">[];
    const timer = window.setTimeout(() => {
      void saveChatHistory(persistent).catch(() => {
        if (persistent.some((message) => message.kind === "validation" &&
            message.payload.status === "saved" && message.payload.analysis)) {
          toast.error("Os registros foram salvos, mas o histórico da análise não sincronizou. Tente novamente ao voltar ao chat.", {
            id: "saved-analysis-chat-sync",
          });
        }
        if (persistent.some((message) => message.payload.correction &&
            typeof message.payload.correction === "object" &&
            (message.payload.correction as { status?: unknown }).status === "applied")) {
          toast.error("Correção salva, mas o histórico do chat não sincronizou. Confira os dados em Dia.", {
            id: "meal-correction-chat-sync",
          });
        }
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [syncedOwnerId, persistenceSnapshot, user?.id]);

  useEffect(() => {
    if (!user?.id || syncedOwnerId !== user.id) return;
    let stopped = false;
    let polling = false;
    async function syncPhotoJobs() {
      if (polling) return;
      polling = true;
      try {
        const jobs = await getPhotoJobs();
        if (stopped) return;
        setMessages((current) => {
          const updated = [...current];
          let changed = false;
          const currentDate = getSaoPauloDateKey();
          for (const job of jobs.filter((candidate) =>
            shouldShowFailedPhotoJob(candidate, current, currentDate))) {
            const id = `photo-job:${job.id}`;
            const index = updated.findIndex((message) => message.id === id);
            const previous = index >= 0 ? updated[index] : undefined;
            if (previous?.kind === "validation" && previous.status !== "pending") continue;
            let next: ChatMessage;
            if (job.status === "ready" && job.result) {
              next = { id, role: "assistant", kind: "validation", payload: job.result, status: "pending" };
              if (previous?.kind !== "validation" && !notifiedJobs.current.has(id)) {
                notifiedJobs.current.add(id);
                toast.success("A análise da foto está pronta para sua aprovação.", {
                  action: { label: "Revisar", onClick: () => window.location.assign("/") },
                });
              }
            } else if (job.status === "failed") {
              next = {
                id, role: "assistant", kind: "error", retryable: false,
                photoJobId: job.id,
                acknowledged: previous?.kind === "error" && previous.acknowledged,
                text: `A análise da foto enviada ${formatPhotoJobDate(job.created_at)} não ficou pronta após as novas tentativas. Nenhum registro foi criado.`,
              };
            } else {
              next = { id, role: "assistant", kind: "deferred", jobId: job.id, processing: job.status === "processing" };
            }
            next = { ...next, createdAt: previous?.createdAt ?? job.created_at };
            if (index >= 0) {
              if (previous?.kind === "validation") continue;
              if (previous?.kind === next.kind &&
                  !(previous.kind === "deferred" && next.kind === "deferred" &&
                    previous.processing !== next.processing)) continue;
              updated[index] = next;
              changed = true;
            } else {
              updated.push(next);
              changed = true;
            }
          }
          return changed ? updated : current;
        });
      } catch {
        // Keep the last known state; the next poll will retry.
      } finally {
        polling = false;
      }
    }
    void syncPhotoJobs();
    const timer = window.setInterval(() => void syncPhotoJobs(), 30_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [syncedOwnerId, user?.id]);

  const historyStatus: ChatHistoryStatus = !user?.id
    ? "idle"
    : hydratedOwnerId === user.id
      ? "ready"
      : historyErrorOwnerId === user.id
        ? "error"
        : "loading";
  const retryChatHistory = useCallback(() => setHistoryRetry((attempt) => attempt + 1), []);
  const value = useMemo(() => ({
    messages: historyStatus === "ready" ? messages : [],
    setMessages,
    historyStatus,
    retryHistory: retryChatHistory,
    historySyncError: historyErrorOwnerId === user?.id,
  }), [historyStatus, messages, retryChatHistory, historyErrorOwnerId, user?.id]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

function serializeMessage(
  message: ChatMessage,
  sequence: number,
): Omit<ChatHistoryRow, "created_at"> | null {
  const row = serializeMessageContent(message, sequence);
  return row ? {
    ...row,
    payload: { ...row.payload, ...(validMessageTime(message.createdAt) ? { sent_at: message.createdAt } : {}) },
  } : null;
}

function serializeMessageContent(
  message: ChatMessage,
  sequence: number,
): Omit<ChatHistoryRow, "created_at"> | null {
  if (message.kind === "loading") return null;
  if (message.kind === "deferred") {
    return {
      client_id: message.id, role: "assistant", kind: "text",
      payload: { deferred_photo_job_id: message.jobId }, sequence,
    };
  }
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
      payload: {
        text: message.text,
        error: true,
        edit_meals: message.editMeals === true,
        ...(message.photoJobId ? {
          photo_job_id: message.photoJobId,
          acknowledged: message.acknowledged === true,
        } : {}),
      },
      sequence,
    };
  }
  if (message.kind === "correction") {
    return {
      client_id: message.id,
      role: "assistant",
      kind: "text",
      payload: {
        correction: {
          kind: "meal_correction",
          source_text: message.sourceText,
          target_count: message.targetCount,
          status: message.status === "unverified" ? "pending" : message.status,
        },
      },
      sequence,
    };
  }
  const analysis = message.analysis && { ...message.analysis, stage: undefined };
  return {
    client_id: message.id,
    role: "assistant",
    kind: "validation",
    payload: { validation: message.payload, status: message.status, analysis },
    sequence,
  };
}

function deserializeMessage(row: ChatHistoryRow): ChatMessage | null {
  const message = deserializeMessageContent(row);
  if (!message) return null;
  const sentAt = validMessageTime(row.payload.sent_at) ? row.payload.sent_at : row.created_at;
  return { ...message, ...(validMessageTime(sentAt) ? { createdAt: sentAt } : {}) };
}

function validMessageTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function deserializeMessageContent(row: ChatHistoryRow): ChatMessage | null {
  if (row.kind === "text" && row.role === "assistant" &&
      typeof row.payload.deferred_photo_job_id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.payload.deferred_photo_job_id)) {
    return {
      id: row.client_id, role: "assistant", kind: "deferred",
      jobId: row.payload.deferred_photo_job_id, processing: false,
    };
  }
  if (row.kind === "text" && row.role === "assistant" && row.payload.correction) {
    const parsed = MealCorrectionProposalSchema.safeParse(row.payload.correction);
    const status = (row.payload.correction as { status?: unknown }).status;
    if (!parsed.success || !["pending", "applied", "dismissed"].includes(String(status))) return null;
    return {
      id: row.client_id,
      role: "assistant",
      kind: "correction",
      sourceText: parsed.data.source_text,
      targetCount: parsed.data.target_count,
      status: status as "pending" | "applied" | "dismissed",
    };
  }
  if (row.kind === "text" && row.role === "assistant" && row.payload.error === true) {
    if (typeof row.payload.text !== "string") return null;
    if (row.payload.photo_job_id === undefined &&
        row.payload.text === "A análise da foto não ficou pronta após as novas tentativas. Nenhum registro foi criado.") {
      // Drop only the legacy unlinked notice. Current failures are rebuilt from a
      // scoped photo job and retain their original send date.
      return null;
    }
    return {
      id: row.client_id,
      role: "assistant",
      kind: "error",
      text: row.payload.text,
      retryable: false,
      editMeals: row.payload.edit_meals === true,
      ...(typeof row.payload.photo_job_id === "string"
        ? {
            photoJobId: row.payload.photo_job_id,
            acknowledged: row.payload.acknowledged === true,
          }
        : {}),
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
    const rawAnalysis = row.payload.analysis;
    const refs = rawAnalysis && typeof rawAnalysis === "object" && "recordRefs" in rawAnalysis
      ? SavedRecordRefSchema.array().max(100).safeParse(rawAnalysis.recordRefs) : null;
    const analysisStatus = rawAnalysis && typeof rawAnalysis === "object" && "status" in rawAnalysis
      ? rawAnalysis.status : undefined;
    const analysisText = rawAnalysis && typeof rawAnalysis === "object" && "text" in rawAnalysis
      && typeof rawAnalysis.text === "string" ? rawAnalysis.text.slice(0, 1600) : undefined;
    return {
      id: row.client_id,
      role: "assistant",
      kind: "validation",
      payload: parsed.data,
      status: status as "pending" | "saved" | "discarded",
      ...(status === "saved" && refs?.success && ["pending", "ready", "failed"].includes(String(analysisStatus))
        ? { analysis: {
            status: analysisStatus === "pending" ? "failed" : analysisStatus as "ready" | "failed",
            recordRefs: refs.data,
            text: analysisStatus === "pending"
              ? "A tentativa foi interrompida. Você pode retomá-la sem salvar de novo."
              : analysisText,
          } } : {}),
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

export function shouldShowFailedPhotoJob(
  job: Pick<PhotoJob, "id" | "status" | "created_at">,
  messages: ChatMessage[],
  today = getSaoPauloDateKey(),
): boolean {
  if (job.status !== "failed") return true;
  if (messages.some((message) => message.kind === "deferred" && message.jobId === job.id)) {
    return true;
  }
  const createdAt = new Date(job.created_at);
  return Number.isFinite(createdAt.getTime()) && getSaoPauloDateKey(createdAt) === today;
}

function formatPhotoJobDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "em data não informada";
  return `em ${new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date)}`;
}
