import { randomUUID } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";

const CONNECTOR_NAME = "supabase";
const ALIMENTACAO_TABLE = "alimentacao";
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

function normalizeEventRecord(record, eventType, now) {
  const importKey = record.import_key ?? `app:${randomUUID()}`;
  const data = record.data ?? now.data;
  const horario = record.horario ?? now.horario;
  const item = String(record.item ?? record.tipo ?? "").trim();
  const quantidade = normalizeNullable(
    record.quantidade ?? record.quantidade_estimada ?? record.duracao_min,
  );
  const sourceFileId = record.source_file_id ?? "app";

  if (eventType === "hidratacao") {
    return {
      table: "hidratacao",
      record: {
        import_key: importKey,
        data,
        horario,
        item,
        quantidade,
        midia_id: normalizeNullable(record.midia_id),
        json_filename: normalizeNullable(record.json_filename),
        source_file_id: sourceFileId,
      },
    };
  }
  if (eventType === "exercicio") {
    return {
      table: "exercicios",
      record: {
        import_key: importKey,
        data,
        tipo: item,
        duracao_min: quantidade,
        intensidade: normalizeNullable(record.intensidade),
        calorias_estimadas: normalizeNullable(record.calorias_estimadas),
        midia_id: normalizeNullable(record.midia_id),
        json_filename: normalizeNullable(record.json_filename),
        source_file_id: sourceFileId,
      },
    };
  }
  if (eventType === "sono") {
    return {
      table: "sono",
      record: {
        import_key: importKey,
        data,
        inicio: normalizeNullable(record.inicio),
        fim: normalizeNullable(record.fim),
        duracao_minutos: quantidade,
        sono_profundo_min: normalizeNullable(record.sono_profundo_min),
        sono_leve_min: normalizeNullable(record.sono_leve_min),
        sono_rem_min: normalizeNullable(record.sono_rem_min),
        acordado_min: normalizeNullable(record.acordado_min),
        midia_id: normalizeNullable(record.midia_id),
        json_filename: normalizeNullable(record.json_filename),
        source_file_id: sourceFileId,
      },
    };
  }
  if (eventType === "peso") {
    return {
      table: "peso",
      record: {
        import_key: importKey,
        data,
        horario,
        valor_kg: quantidade,
        json_filename: normalizeNullable(record.json_filename),
        source_file_id: sourceFileId,
      },
    };
  }

  return {
    table: ALIMENTACAO_TABLE,
    record: {
      import_key: importKey,
      data,
      horario,
      item,
      quantidade,
      midia_id: normalizeNullable(record.midia_id),
      json_filename: normalizeNullable(record.json_filename),
      evento_tipo: eventType,
      source_file_id: sourceFileId,
    },
  };
}

function normalizeRecords(payload) {
  const now = saoPauloNow();

  if (Array.isArray(payload.records) && payload.records.length > 0) {
    return payload.records.map((record) =>
      normalizeEventRecord(
        record,
        EVENT_TYPES.has(record.evento_tipo) ? record.evento_tipo : "outro",
        now,
      ),
    );
  }

  const eventType = EVENT_TYPES.has(payload.evento_tipo) ? payload.evento_tipo : "outro";
  return (payload.itens ?? [])
    .filter((item) => item.confirmado !== false)
    .map((item) => normalizeEventRecord(item, eventType, now));
}

async function saveRecords(connectors) {
  const payload = await readJsonInput();
  const entries = normalizeRecords(payload);

  if (entries.length === 0) {
    throw new SupabaseRecordsError(
      "invalid_records",
      "Nenhum registro de saúde válido foi informado.",
      422,
    );
  }

  const groups = new Map();
  for (const entry of entries) {
    const group = groups.get(entry.table) ?? [];
    group.push(entry);
    groups.set(entry.table, group);
  }
  await Promise.all(
    [...groups.entries()].map(([table, group]) =>
      supabaseRequest(connectors, `/rest/v1/${table}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(group.map(({ record }) => record)),
      }),
    ),
  );

  return { ok: true, saved: entries.length };
}

function parseMetric(value, units) {
  const match = String(value ?? "").match(/(\d+(?:[.,]\d+)?)\s*([a-zçã]+)/i);
  if (!match) return null;
  const number = Number.parseFloat(match[1].replace(",", "."));
  const unit = match[2].toLowerCase();
  return units(number, unit);
}

function parseNumber(value) {
  const match = String(value ?? "").match(/(\d+(?:[.,]\d+)?)/);
  return match ? Number.parseFloat(match[1].replace(",", ".")) : null;
}

function parseSleepHours(value) {
  const text = String(value ?? "");
  const number = parseNumber(text);
  if (number === null) return null;
  return /h/i.test(text) ? number : number / 60;
}

function buildDailySummary(data, datasets) {
  const meals = new Map();
  let waterMl = 0;
  let exercise = null;
  let sleepHours = null;
  let weightKg = null;

  for (const record of datasets.alimentacao) {
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

  for (const record of datasets.hidratacao) {
    waterMl +=
      parseMetric(record.quantidade, (number, unit) => {
        if (unit.startsWith("l")) return Math.round(number * 1000);
        if (unit.startsWith("copo")) return Math.round(number * 250);
        return Math.round(number);
      }) ?? 0;
  }

  for (const record of datasets.exercicios) {
    const details = [record.duracao_min ? `${record.duracao_min} min` : null, record.intensidade]
      .filter(Boolean)
      .join(", ");
    exercise = details ? `${record.tipo} (${details})` : record.tipo;
  }

  for (const record of datasets.sono) {
    sleepHours = parseSleepHours(record.duracao_minutos);
  }

  for (const record of datasets.peso) {
    weightKg = parseNumber(record.valor_kg);
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

async function rowsForDate(connectors, table, data, select, order) {
  const params = new URLSearchParams({
    select,
    data: `eq.${data}`,
    order,
  });
  const response = await supabaseRequest(connectors, `/rest/v1/${table}?${params.toString()}`);
  return response.json();
}

async function dailySummary(connectors, requestedDate) {
  const data = requestedDate || saoPauloNow().data;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new SupabaseRecordsError("invalid_date", "A data deve usar o formato AAAA-MM-DD.", 422);
  }

  const [alimentacao, hidratacao, exercicios, sono, peso] = await Promise.all([
    rowsForDate(
      connectors,
      ALIMENTACAO_TABLE,
      data,
      "data,horario,item,quantidade,evento_tipo",
      "horario.asc,id.asc",
    ),
    rowsForDate(
      connectors,
      "hidratacao",
      data,
      "data,horario,item,quantidade",
      "horario.asc,id.asc",
    ),
    rowsForDate(
      connectors,
      "exercicios",
      data,
      "data,tipo,duracao_min,intensidade,calorias_estimadas",
      "id.asc",
    ),
    rowsForDate(connectors, "sono", data, "data,inicio,fim,duracao_minutos", "id.asc"),
    rowsForDate(connectors, "peso", data, "data,horario,valor_kg", "horario.asc,id.asc"),
  ]);

  return buildDailySummary(data, { alimentacao, hidratacao, exercicios, sono, peso });
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
