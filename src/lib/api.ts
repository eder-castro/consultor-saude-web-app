import { isMockMode, readConfig } from "./api-config";
import {
  DailySummarySchema,
  HealthContextSchema,
  ProcessHealthExamResponseSchema,
  ReviewHealthExamResponseSchema,
  ValidationPayloadSchema,
  SaveResponseSchema,
  type DailySummary,
  type Exam,
  type ExamExtractedData,
  type HealthContext,
  type EventoTipo,
  type Item,
  type ValidationGroup,
  type ValidationPayload,
} from "./api-schemas";
import { getMockSummary, recordItems } from "./mock-store";

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

export type AuthUser = { id: string; email: string };
export type Credentials = { email: string; password: string };

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

function mockProcess(input: { text?: string; imageBase64?: string }): ValidationPayload {
  const text = input.text ?? "";
  if (input.imageBase64) {
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
  imageBase64?: string;
  mimeType?: string;
}): Promise<ValidationPayload> {
  if (isMockMode()) {
    await sleep(1100);
    return ValidationPayloadSchema.parse(mockProcess(input));
  }
  const json = await fetchApi("/process-input", {
    method: "POST",
    body: JSON.stringify({
      text: input.text,
      image_base64: input.imageBase64,
      mime_type: input.mimeType,
    }),
  });
  return ValidationPayloadSchema.parse(json);
}

export async function saveRecords(payload: { grupos: ValidationGroup[] }): Promise<{ ok: true }> {
  if (isMockMode()) {
    await sleep(400);
    for (const grupo of payload.grupos) {
      recordItems(
        grupo.evento_tipo,
        grupo.itens.filter((item) => item.confirmado),
      );
    }
    return { ok: true };
  }
  const json = await fetchApi("/save-records", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return SaveResponseSchema.parse(json);
}

export async function getDailySummary(): Promise<DailySummary> {
  if (isMockMode()) {
    await sleep(250);
    return DailySummarySchema.parse(getMockSummary());
  }
  const json = await fetchApi("/daily-summary", { method: "GET" });
  return DailySummarySchema.parse(json);
}

export async function generateDailyReport(): Promise<{ ok: true }> {
  if (isMockMode()) {
    await sleep(700);
    return { ok: true };
  }
  const json = await fetchApi("/generate-report", { method: "POST" });
  return SaveResponseSchema.parse(json);
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

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result as string;
      resolve(result.split(",")[1] ?? result);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export async function prepareHealthExamFile(file: File): Promise<{
  file_name: string;
  mime_type: string;
  file_base64: string;
}> {
  if (file.type === "application/pdf") {
    return {
      file_name: file.name,
      mime_type: "application/pdf",
      file_base64: await fileToBase64(file),
    };
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("Selecione uma imagem ou um arquivo PDF.");
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.78),
    );
    if (!blob) throw new Error("Não foi possível preparar a imagem.");
    return {
      file_name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
      mime_type: "image/jpeg",
      file_base64: await fileToBase64(new File([blob], "exam.jpg", { type: "image/jpeg" })),
    };
  } catch (error) {
    if (error instanceof Error && error.message) throw error;
    throw new Error("Não foi possível ler esta imagem. Tente outro arquivo.");
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
