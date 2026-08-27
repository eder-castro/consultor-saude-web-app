import { randomUUID } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";

const CONNECTOR_NAME = "supabase";
const TABLE_NAME = "health_records";
const TIME_ZONE = "America/Sao_Paulo";
const EVENT_TYPES = new Set(["alimentacao", "hidratacao", "exercicio", "sono", "peso", "outro"]);

class SupabaseRecordsError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function readJsonInput() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input.trim() ? JSON.parse(input) : {};
}

async function supabaseRequest(connectors, path, init = {}) {
  const response = await connectors.proxy(CONNECTOR_NAME, path, init);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new SupabaseRecordsError(
      "supabase_error",
      `Supabase respondeu ${response.status}: ${detail}`,
      response.status,
    );
  }
  return response;
}

function saoPauloNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    data: `${parts.year}-${parts.month}-${parts.day}`,
    horario: `${parts.hour}:${parts.minute}`,
  };
}

function normalizeNullable(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function normalizeRecords(payload) {
  const now = saoPauloNow();

  if (Array.isArray(payload.records) && payload.records.length > 0) {
    return payload.records.map((record) => ({
      import_key: record.import_key ?? `app:${randomUUID()}`,
      data: record.data ?? now.data,
      horario: record.horario ?? now.horario,
      item: String(record.item ?? "").trim(),
      quantidade: normalizeNullable(record.quantidade ?? record.quantidade_estimada),
      midia_id: normalizeNullable(record.midia_id),
      json_filename: normalizeNullable(record.json_filename),
      evento_tipo: EVENT_TYPES.has(record.evento_tipo) ? record.evento_tipo : "outro",
      source_file_id: record.source_file_id ?? "app",
    }));
  }

  const eventType = EVENT_TYPES.has(payload.evento_tipo) ? payload.evento_tipo : "outro";
  return (payload.itens ?? [])
    .filter((item) => item.confirmado !== false)
    .map((item) => ({
      import_key: `app:${randomUUID()}`,
      data: now.data,
      horario: now.horario,
      item: String(item.item ?? "").trim(),
      quantidade: normalizeNullable(item.quantidade_estimada),
      midia_id: null,
      json_filename: null,
      evento_tipo: eventType,
      source_file_id: "app",
    }));
}

async function saveRecords(connectors) {
  const payload = await readJsonInput();
  const records = normalizeRecords(payload);

  if (records.length === 0 || records.some((record) => !record.item)) {
    throw new SupabaseRecordsError(
      "invalid_records",
      "Nenhum registro de saúde válido foi informado.",
      422,
    );
  }

  await supabaseRequest(connectors, `/rest/v1/${TABLE_NAME}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(records),
  });

  return { ok: true, saved: records.length };
}

function parseMetric(value, units) {
  const match = String(value ?? "").match(/(\d+(?:[.,]\d+)?)\s*([a-zçã]+)/i);
  if (!match) return null;
  const number = Number.parseFloat(match[1].replace(",", "."));
  const unit = match[2].toLowerCase();
  return units(number, unit);
}

function buildDailySummary(data, records) {
  const meals = new Map();
  let waterMl = 0;
  let exercise = null;
  let sleepHours = null;
  let weightKg = null;

  for (const record of records) {
    const quantity = record.quantidade ?? "N/A";

    if (record.evento_tipo === "hidratacao") {
      waterMl +=
        parseMetric(quantity, (number, unit) => {
          if (unit.startsWith("l")) return Math.round(number * 1000);
          if (unit.startsWith("copo")) return Math.round(number * 250);
          return Math.round(number);
        }) ?? 0;
    } else if (record.evento_tipo === "exercicio") {
      exercise = `${record.item} (${quantity})`;
    } else if (record.evento_tipo === "sono") {
      sleepHours = parseMetric(quantity, (number) => number);
    } else if (record.evento_tipo === "peso") {
      weightKg = parseMetric(quantity, (number) => number);
    } else if (record.evento_tipo === "alimentacao") {
      const mealItems = meals.get(record.horario) ?? [];
      mealItems.push({ item: record.item, quantidade: quantity });
      meals.set(record.horario, mealItems);
    }
  }

  return {
    data,
    agua_ml: waterMl,
    agua_meta_ml: 2500,
    refeicoes: [...meals.entries()].map(([hora, itens]) => ({ hora, itens })),
    exercicio: exercise,
    sono_horas: sleepHours,
    peso_kg: weightKg,
    tendencia: null,
  };
}

async function dailySummary(connectors, requestedDate) {
  const data = requestedDate || saoPauloNow().data;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new SupabaseRecordsError("invalid_date", "A data deve usar o formato AAAA-MM-DD.", 422);
  }

  const params = new URLSearchParams({
    select: "data,horario,item,quantidade,evento_tipo",
    data: `eq.${data}`,
    order: "horario.asc,id.asc",
  });
  const response = await supabaseRequest(connectors, `/rest/v1/${TABLE_NAME}?${params.toString()}`);
  return buildDailySummary(data, await response.json());
}

async function main() {
  const connectors = new ReplitConnectors();
  const action = process.argv[2];

  if (action === "save") return saveRecords(connectors);
  if (action === "summary") return dailySummary(connectors, process.argv[3]);

  throw new SupabaseRecordsError("unknown_action", "Ação do Supabase não reconhecida.", 400);
}

try {
  process.stdout.write(JSON.stringify(await main()));
} catch (error) {
  const code = error instanceof SupabaseRecordsError ? error.code : "unexpected_error";
  const message =
    error instanceof Error ? error.message : "Falha inesperada ao acessar o Supabase.";
  const status = error instanceof SupabaseRecordsError ? error.status : 502;

  process.stdout.write(JSON.stringify({ ok: false, error: { code, message, status } }));
  process.exitCode = 1;
}
