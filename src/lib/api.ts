import { isMockMode, readConfig } from "./api-config";
import {
  DailySummarySchema,
  ValidationPayloadSchema,
  SaveResponseSchema,
  type DailySummary,
  type EventoTipo,
  type Item,
  type ValidationGroup,
  type ValidationPayload,
} from "./api-schemas";
import { getMockSummary, recordItems } from "./mock-store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);

async function fetchApi(path: string, init?: RequestInit) {
  const cfg = readConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (cfg.token) headers["Authorization"] = `Bearer ${cfg.token}`;
  const res = await fetch(cfg.baseUrl.replace(/\/$/, "") + path, { ...init, headers });
  if (!res.ok) throw new Error(`API ${path}: ${res.status} ${res.statusText}`);
  return res.json();
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
      headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : undefined,
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
