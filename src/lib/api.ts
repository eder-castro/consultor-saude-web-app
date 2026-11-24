import { isMockMode, readConfig } from "./api-config";
import { z } from "zod";
import { fetchAnalysisStream, type ProgressCallback } from "./analysis-progress";
export { fileToBase64, prepareHealthExamFile, prepareHealthImages } from "./image-preparation";
import {
  DailySummarySchema,
  DailyMealsSchema,
  WaterHistorySchema,
  MealCorrectionProposalSchema,
  DayAnalysisSchema,
  PeriodAnalysisSchema,
  HealthContextSchema,
  ProcessHealthExamResponseSchema,
  ReviewHealthExamResponseSchema,
  ValidationPayloadSchema,
  SaveResponseSchema,
  SavedAnalysisSchema,
  SavedAnalysesForDaySchema,
  SleepCorrectionResponseSchema,
  SleepReviewsResponseSchema,
  SavedSleepRecordsResponseSchema,
  SavedSleepUpdateResponseSchema,
  WeeklySummarySchema,
  WeeklyMealsSchema,
  type DailySummary,
  type DailyMeals,
  type WaterHistory,
  type MealCorrectionProposal,
  type DayAnalysis,
  type PeriodAnalysis,
  type Exam,
  type ExamExtractedData,
  type HealthContext,
  type EventoTipo,
  type Item,
  type ValidationGroup,
  type ValidationPayload,
  type SavedRecordRef,
  type SleepReviewGroup,
  type SavedSleepRecord,
  type WeeklySummary,
  type WeeklyMeals,
  type SavedAnalysesForDay,
} from "./api-schemas";
import { getMockSummary, recordItems } from "./mock-store";
import { DailyAnalysisSummarySchema, type DailyAnalysisSummary } from "./daily-analysis-summary";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);

const statusMessages: Record<number, string> = {
  401: "Sua sessão expirou. Entre novamente para continuar.",
  413: "A imagem é maior que o limite de 8 MB.",
  415: "Tipo de imagem não suportado. Use JPEG, PNG, WebP ou GIF.",
  422: "Confira o texto ou a imagem enviados e tente novamente.",
  429: "O serviço está temporariamente ocupado. Tente novamente em instantes.",
  502: "O serviço de análise devolveu uma resposta inválida. Tente novamente.",
  503: "O serviço de análise está temporariamente indisponível. Tente novamente em instantes.",
  504: "A análise demorou demais. Tente novamente.",
};

export class ApiError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number,
    detail?: string,
  ) {
    super(detail || statusMessages[status] || "Não foi possível concluir a solicitação.");
    this.name = "ApiError";
  }
}

async function fetchApi(path: string, init?: RequestInit) {
  const cfg = readConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  const res = await fetch(cfg.baseUrl.replace(/\/$/, "") + path, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/") && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("health:unauthorized"));
    }
    let detail: string | undefined;
    try {
      const body: unknown = await res.json();
      if (typeof body === "object" && body !== null && "detail" in body) {
        const value = body.detail;
        if (typeof value === "string") detail = value;
      }
    } catch {
      // A resposta pode não ser JSON (por exemplo, um proxy indisponível).
    }
    throw new ApiError(path, res.status, detail);
  }
  return res.json();
}

export function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) {
    return "Não foi possível conectar ao serviço. Confira sua conexão e tente novamente.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Não foi possível concluir a análise. Tente novamente.";
}

export function isRetryableApiError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return [502, 503, 504].includes(error.status) ||
      (error.status === 429 && !error.message.toLowerCase().includes("cota"));
  }
  return error instanceof TypeError;
}

export type AuthUser = { id: string; email: string };
export type Credentials = { email: string; password: string };
export type ChatHistoryRow = {
  client_id: string;
  role: "user" | "assistant";
  kind: "text" | "image" | "validation";
  payload: Record<string, unknown>;
  sequence: number;
  created_at: string;
};

export type PhotoJob = {
  id: string;
  status: "pending" | "processing" | "ready" | "failed";
  result: ValidationPayload | null;
  attempts: number;
  created_at: string;
};

export async function getPhotoJobs(): Promise<PhotoJob[]> {
  const json = (await fetchApi("/photo-jobs", { method: "GET" })) as { jobs: PhotoJob[] };
  return json.jobs.map((job) => ({
    ...job,
    result: job.status === "ready" ? ValidationPayloadSchema.parse(job.result) : null,
  }));
}

export async function reviewPhotoJob(id: string): Promise<void> {
  await fetchApi("/photo-jobs/review", { method: "POST", body: JSON.stringify({ id }) });
}

export async function cancelPhotoJob(id: string): Promise<void> {
  await fetchApi("/photo-jobs/cancel", { method: "POST", body: JSON.stringify({ id }) });
}

export async function login(credentials: Credentials): Promise<AuthUser> {
  return (await fetchApi("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  })) as AuthUser;
}

export async function register(credentials: Credentials): Promise<AuthUser> {
  return (await fetchApi("/auth/register", {
    method: "POST",
    body: JSON.stringify(credentials),
  })) as AuthUser;
}

export async function getCurrentUser(): Promise<AuthUser> {
  return (await fetchApi("/auth/me", { method: "GET" })) as AuthUser;
}

export async function logout(): Promise<{ ok: true }> {
  return (await fetchApi("/auth/logout", { method: "POST" })) as { ok: true };
}

export async function getChatHistory(): Promise<ChatHistoryRow[]> {
  const json = (await fetchApi("/chat-history", { method: "GET" })) as {
    messages?: ChatHistoryRow[];
  };
  return Array.isArray(json.messages) ? json.messages : [];
}

export async function getSavedAnalyses(date: string): Promise<SavedAnalysesForDay> {
  const json = await fetchApi(`/saved-analyses?data=${encodeURIComponent(date)}`, { method: "GET" });
  return SavedAnalysesForDaySchema.parse(json);
}

export async function saveChatHistory(
  messages: Omit<ChatHistoryRow, "created_at">[],
): Promise<{ ok: true }> {
  return (await fetchApi("/chat-history", {
    method: "PUT",
    body: JSON.stringify({ messages }),
  })) as { ok: true };
}

// ===== Mock helpers =====
function detectTipo(text: string): EventoTipo {
  const t = text.toLowerCase();
  if (/(água|agua|ml|copo|litro|hidrat)/i.test(t)) return "hidratacao";
  if (/(corri|caminh|exerc|treino|musculação|musculacao|km|minutos? de)/i.test(t))
    return "exercicio";
  if (/(dormi|sono|horas? de sono)/i.test(t)) return "sono";
  if (/(pesei|peso|kg)/i.test(t)) return "peso";
  if (/(comi|almoc|jantei|café|cafe da manhã|lanche|refei)/i.test(t)) return "alimentacao";
  return "alimentacao";
}

function makeGroup(evento_tipo: EventoTipo, itens: Item[]): ValidationGroup {
  return { evento_tipo, itens };
}

function mockProcess(input: {
  text?: string;
  images?: { imageBase64: string; mimeType: string }[];
}): ValidationPayload {
  const text = input.text ?? "";
  if (input.images?.length) {
    return {
      grupos: [
        makeGroup("alimentacao", [
          {
            id: uid(),
            item: "Arroz Integral",
            quantidade_estimada: "3 colheres",
            confirmado: true,
          },
          { id: uid(), item: "Feijão Carioca", quantidade_estimada: "1 concha", confirmado: true },
          { id: uid(), item: "Frango Grelhado", quantidade_estimada: "150g", confirmado: true },
          {
            id: uid(),
            item: "Salada Verde",
            quantidade_estimada: "1 prato pequeno",
            confirmado: true,
          },
        ]),
      ],
      resumo: "Refeição equilibrada detectada na imagem.",
    };
  }

  const hasHydration = /(água|agua|hidrata|bebi|copos?|litros?|ml)/i.test(text);
  const hasFood =
    /(comi|almoc|almoç|jantei|café|cafe da manhã|lanche|refei|arroz|feijão|feijao|frango|salada|pão|pao)/i.test(
      text,
    );
  if (hasHydration && hasFood) {
    const foodMatch = text.match(
      /(?:comi|almocei|almoçei|jantei|tomei café|tomei cafe|lanchei)\s+(.+?)(?=\s+e\s+(?:bebi|tomei)\b|$)/i,
    );
    const waterMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|litros?|copos?)/i);
    return {
      grupos: [
        makeGroup("alimentacao", [
          {
            id: uid(),
            item: foodMatch?.[1]?.trim() || "Alimento",
            quantidade_estimada: "1 porção",
            confirmado: true,
          },
        ]),
        makeGroup("hidratacao", [
          {
            id: uid(),
            item: "Água",
            quantidade_estimada: waterMatch ? `${waterMatch[1]}${waterMatch[2]}` : "300ml",
            confirmado: true,
          },
        ]),
      ],
    };
  }

  const tipo = detectTipo(text);
  switch (tipo) {
    case "hidratacao": {
      const m = text.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|litros?|copos?)/i);
      const qty = m ? `${m[1]}${m[2]}` : "300ml";
      return {
        grupos: [
          makeGroup("hidratacao", [
            { id: uid(), item: "Água", quantidade_estimada: qty, confirmado: true },
          ]),
        ],
      };
    }
    case "sono": {
      const m = text.match(/(\d+(?:[.,]\d+)?)\s*h/i);
      return {
        grupos: [
          makeGroup("sono", [
            { id: uid(), item: "Sono", quantidade_estimada: `${m?.[1] ?? "7"}h`, confirmado: true },
          ]),
        ],
      };
    }
    case "peso": {
      const m = text.match(/(\d+(?:[.,]\d+)?)\s*kg/i);
      return {
        grupos: [
          makeGroup("peso", [
            {
              id: uid(),
              item: "Peso",
              quantidade_estimada: `${m?.[1] ?? "70"}kg`,
              confirmado: true,
            },
          ]),
        ],
      };
    }
    case "exercicio":
      return {
        grupos: [
          makeGroup("exercicio", [
            { id: uid(), item: "Caminhada", quantidade_estimada: "30 minutos", confirmado: true },
          ]),
        ],
      };
    default:
      return {
        grupos: [
          makeGroup("alimentacao", [
            {
              id: uid(),
              item: text.slice(0, 40) || "Item",
              quantidade_estimada: "1 porção",
              confirmado: true,
            },
          ]),
        ],
      };
  }
}

// ===== Public API =====
export async function processInput(input: {
  text?: string;
  previousUserMessage?: string;
  images?: { imageBase64: string; mimeType: string }[];
}, onProgress?: ProgressCallback): Promise<ValidationPayload | MealCorrectionProposal | DayAnalysis | PeriodAnalysis | { pending_job_id: string; status: "pending" }> {
  if (isMockMode()) {
    await sleep(1100);
    return ValidationPayloadSchema.parse(mockProcess(input));
  }
  const body = JSON.stringify({
      text: input.text,
      previous_user_message: input.previousUserMessage,
      images: input.images?.map((image) => ({
        image_base64: image.imageBase64,
        mime_type: image.mimeType,
      })),
    });
  const json = onProgress
    ? await fetchAnalysisStream("/process-input/stream", body, onProgress,
        (status, detail) => new ApiError("/process-input/stream", status, detail))
    : await fetchApi("/process-input", { method: "POST", body });
  if (json && typeof json === "object" && "kind" in json && json.kind === "day_analysis") {
    return DayAnalysisSchema.parse(json);
  }
  if (json && typeof json === "object" && "kind" in json && json.kind === "period_analysis") {
    return PeriodAnalysisSchema.parse(json);
  }
  if (json && typeof json === "object" && "pending_job_id" in json &&
      typeof json.pending_job_id === "string" && "status" in json && json.status === "pending") {
    return { pending_job_id: json.pending_job_id, status: "pending" };
  }
  if (json && json.kind === "meal_correction") {
    return MealCorrectionProposalSchema.parse(json);
  }
  return ValidationPayloadSchema.parse(json);
}

export async function getSleepDayStatus(data: string): Promise<{ data: string; count: number; token: string }> {
  if (isMockMode()) return { data, count: 0, token: "0".repeat(32) };
  const json = await fetchApi(`/sleep-day-status?data=${encodeURIComponent(data)}`, { method: "GET" });
  return z.object({
    data: z.literal(data),
    count: z.number().int().min(0),
    token: z.string().regex(/^[0-9a-f]{32}$/),
  }).parse(json);
}

export async function saveRecords(payload: {
  grupos: ValidationGroup[]; operation_id: string;
  sleep_replacements?: { data: string; expected_token: string }[];
}): Promise<{
  ok: true;
  record_refs: SavedRecordRef[];
}> {
  if (isMockMode()) {
    await sleep(400);
    for (const grupo of payload.grupos) {
      recordItems(
        grupo.evento_tipo,
        grupo.itens.filter((item) => item.confirmado),
      );
    }
    return { ok: true, record_refs: [] };
  }
  const json = await fetchApi("/save-records", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return SaveResponseSchema.parse(json);
}

export async function analyzeSavedRecords(recordRefs: SavedRecordRef[], onProgress?: ProgressCallback): Promise<string> {
  if (isMockMode()) throw new Error("A análise contextual não está disponível no modo de demonstração.");
  const body = JSON.stringify({ record_refs: recordRefs });
  const json = onProgress
    ? await fetchAnalysisStream("/analyze-saved-records/stream", body, onProgress,
        (status, detail) => new ApiError("/analyze-saved-records/stream", status, detail))
    : await fetchApi("/analyze-saved-records", { method: "POST", body });
  return SavedAnalysisSchema.parse(json).analysis;
}

export async function getDailyAnalysisSummary(): Promise<DailyAnalysisSummary> {
  if (isMockMode()) throw new Error("O contexto diário não está disponível no modo de demonstração.");
  return DailyAnalysisSummarySchema.parse(
    await fetchApi("/daily-analysis-summary", { method: "GET" }),
  );
}

export async function getSleepReviews(): Promise<SleepReviewGroup[]> {
  if (isMockMode()) return [];
  const json = await fetchApi("/sleep-reviews", { method: "GET" });
  return SleepReviewsResponseSchema.parse(json).revisoes;
}

export async function getSavedSleepRecords(): Promise<SavedSleepRecord[]> {
  if (isMockMode()) return [];
  const json = await fetchApi("/sleep-records", { method: "GET" });
  return SavedSleepRecordsResponseSchema.parse(json).registros;
}

export type SavedSleepUpdate = {
  total_sleep_min: number;
  sono_profundo_min: number | null;
  sono_leve_min: number | null;
  sono_rem_min: number | null;
  acordado_min: number | null;
};

export async function updateSavedSleepRecord(id: string, input: SavedSleepUpdate): Promise<SavedSleepRecord> {
  if (isMockMode()) throw new Error("A correção de sono não está disponível no modo de demonstração.");
  const json = await fetchApi(`/sleep-records/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return SavedSleepUpdateResponseSchema.parse(json).registro;
}

export async function consolidateSleepRecords(input: {
  record_ids: string[];
  total_sleep_min: number;
}): Promise<{ ok: true; corrected: boolean; replaced: number; record_id: string }> {
  if (isMockMode()) {
    return { ok: true, corrected: true, replaced: input.record_ids.length, record_id: "mock" };
  }
  const json = await fetchApi("/sleep-reviews/consolidate", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return SleepCorrectionResponseSchema.parse(json);
}

export async function getDailySummary(data?: string): Promise<DailySummary> {
  if (isMockMode()) {
    if (data) throw new Error("O histórico diário não está disponível no modo de demonstração.");
    await sleep(250);
    return DailySummarySchema.parse(getMockSummary());
  }
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new Error("Data inválida para o resumo diário.");
  }
  const json = await fetchApi(
    data ? `/daily-summary?data=${encodeURIComponent(data)}` : "/daily-summary",
    { method: "GET" },
  );
  return DailySummarySchema.parse(json);
}

export async function getWaterHistory(data: string): Promise<WaterHistory> {
  if (isMockMode()) throw new Error("O histórico de água não está disponível no modo de demonstração.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error("Data inválida para o histórico de água.");
  return WaterHistorySchema.parse(await fetchApi(
    `/water-history?data=${encodeURIComponent(data)}`, { method: "GET" },
  ));
}

export async function correctWaterTotal(input: {
  data: string;
  import_key: string;
  expected_quantity: string;
  action: "update" | "delete";
  new_total_ml: number | null;
}): Promise<void> {
  if (isMockMode()) throw new Error("A correção de água não está disponível no modo de demonstração.");
  await fetchApi("/water-total/correct", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getMealsForDay(data: string): Promise<DailyMeals> {
  if (isMockMode()) throw new Error("O histórico diário não está disponível no modo de demonstração.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new Error("Data inválida para as refeições do dia.");
  }
  const json = await fetchApi(`/meals-for-day?data=${encodeURIComponent(data)}`, { method: "GET" });
  return DailyMealsSchema.parse(json);
}

export async function getDatedRecords(data: string) {
  const { DatedRecordsSchema } = await import("./api-schemas");
  const json = await fetchApi(`/dated-records?data=${encodeURIComponent(data)}`, { method: "GET" });
  return DatedRecordsSchema.parse(json);
}

export async function updateRecordDates(input: {
  operation_id: string;
  source_date: string;
  target_date: string;
  records: { table: "alimentacao" | "hidratacao" | "exercicios" | "sono" | "peso"; id: string }[];
}): Promise<{ ok: true; updated: number }> {
  if (isMockMode()) throw new Error("A edição não está disponível no modo de demonstração.");
  const json = await fetchApi("/record-dates", { method: "PATCH", body: JSON.stringify(input) });
  return z.object({ ok: z.literal(true), updated: z.number().int() }).parse(json);
}

export async function updateMealTime(recordIds: string[], horario: string): Promise<void> {
  if (isMockMode()) throw new Error("A edição não está disponível no modo de demonstração.");
  await fetchApi("/meal-times", {
    method: "PATCH",
    body: JSON.stringify({ record_ids: recordIds, horario }),
  });
}

export async function updateMeal(id: string, item: string, quantidade: string, dateTime?: { data: string; horario: string }): Promise<void> {
  if (isMockMode()) throw new Error("A edição não está disponível no modo de demonstração.");
  await fetchApi(`/meals/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ item, quantidade, ...dateTime }),
  });
}

export async function deleteMeal(id: string): Promise<void> {
  if (isMockMode()) throw new Error("A edição não está disponível no modo de demonstração.");
  await fetchApi(`/meals/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function applyMealCorrection(input: {
  correction_id: string;
  record_ids: string[];
  keep_record_id: string;
  expected_rows: { id: string; data: string; horario: string; item: string; quantidade: string }[];
  item: string;
  quantidade: string;
}): Promise<void> {
  if (isMockMode()) throw new Error("A correção não está disponível no modo de demonstração.");
  await fetchApi("/meal-corrections/apply", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getMealCorrectionStatuses(ids: string[]): Promise<string[]> {
  if (isMockMode() || ids.length === 0) return [];
  const result = await fetchApi("/meal-corrections/status", {
    method: "POST",
    body: JSON.stringify({ correction_ids: ids }),
  });
  if (!Array.isArray(result) || result.some((id) => typeof id !== "string")) {
    throw new Error("Não foi possível verificar o estado das correções.");
  }
  return result;
}

export const WeightHistorySchema = z.object({
  ok: z.literal(true),
  periodo: z.object({ inicio: z.string(), fim: z.string() }),
  pontos: z.array(z.object({
    data: z.string(), horario: z.string().nullable(), peso_kg: z.number().positive(),
  })),
});
export type WeightPeriod = "semana" | "dia" | "mes" | "ano";
export async function getWeightHistory(periodo: WeightPeriod, data: string) {
  return WeightHistorySchema.parse(await fetchApi(
    `/weight-history?${new URLSearchParams({ periodo, data })}`, { method: "GET" },
  ));
}

export async function getWeeklySummary(): Promise<WeeklySummary> {
  if (isMockMode()) {
    throw new Error("O detalhamento semanal não está disponível no modo de demonstração.");
  }
  const json = await fetchApi("/weekly-summary", { method: "GET" });
  return WeeklySummarySchema.parse(json);
}

export async function getWeeklyMeals(): Promise<WeeklyMeals> {
  if (isMockMode()) {
    throw new Error("O detalhamento semanal não está disponível no modo de demonstração.");
  }
  const json = await fetchApi("/weekly-meals", { method: "GET" });
  return WeeklyMealsSchema.parse(json);
}

export async function testConnection(): Promise<boolean> {
  if (isMockMode()) return false;
  try {
    const cfg = readConfig();
    const res = await fetch(cfg.baseUrl.replace(/\/$/, "") + "/health", {
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getHealthContext(): Promise<HealthContext> {
  const json = await fetchApi("/health-context", { method: "GET" });
  return HealthContextSchema.parse(json);
}

export async function processHealthExam(input: {
  file_name: string;
  mime_type: string;
  file_base64: string;
  notes?: string;
}): Promise<Exam> {
  const json = await fetchApi("/health-context/exams/process", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return ProcessHealthExamResponseSchema.parse(json).exam;
}

export async function reviewHealthExam(input: {
  exam_id: string;
  status: "confirmed" | "discarded";
  exam_type?: string;
  exam_date?: string | null;
  summary?: string;
  extracted_data?: ExamExtractedData;
  uncertainties?: string[];
}): Promise<Exam> {
  const json = await fetchApi("/health-context/exams/review", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return ReviewHealthExamResponseSchema.parse(json).exam;
}
