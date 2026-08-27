import { createHash, randomUUID } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";

const CONNECTOR_NAME = "supabase";
const ALIMENTACAO_TABLE = "alimentacao";
const TIME_ZONE = "America/Sao_Paulo";
const EVENT_TYPES = new Set(["alimentacao", "hidratacao", "exercicio", "sono", "peso", "outro"]);
const SHEET_HEADERS = ["data", "horario", "item", "quantidade", "midia_id", "json_filename"];
const SHEET_TIME_LABELS = new Set(["almoco", "manha", "madrugada", "noite", "tarde"]);
const SYNC_BATCH_SIZE = 100;

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

function normalizeSheetDate(value) {
  const date = String(value ?? "").trim();
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() + 1 !== Number(match[2]) ||
    parsed.getUTCDate() !== Number(match[3])
  ) {
    return null;
  }

  return date;
}

function normalizeSheetTime(value) {
  const time = String(value ?? "").trim();
  if (!time) return null;

  const match = time.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) {
    const normalizedLabel = time
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    return SHEET_TIME_LABELS.has(normalizedLabel) ? time : null;
  }
  return `${match[1]}:${match[2]}:${match[3] ?? "00"}`;
}

function normalizeSheetRow(row, sourceId) {
  const rowNumber = Number(row?.row_number);
  const values = Array.isArray(row?.values) ? row.values : [];

  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    return { invalid: true, rowNumber: null, reason: "Número de linha inválido." };
  }

  if (values.every((value) => String(value ?? "").trim() === "")) {
    return { empty: true, rowNumber };
  }

  if (values.length !== SHEET_HEADERS.length) {
    return {
      invalid: true,
      rowNumber,
      reason: `A linha precisa ter exatamente ${SHEET_HEADERS.length} colunas.`,
    };
  }

  const [rawDate, rawTime, rawItem, rawQuantity, rawMediaId, rawJsonFilename] = values;
  const data = normalizeSheetDate(rawDate);
  const horario = normalizeSheetTime(rawTime);
  const item = String(rawItem ?? "").trim();

  if (!data || !horario || !item) {
    return {
      invalid: true,
      rowNumber,
      reason: "Data, horário e item são obrigatórios e devem estar em formato válido.",
    };
  }

  return {
    rowNumber,
    record: {
      data,
      horario,
      item,
      quantidade: normalizeNullable(rawQuantity),
      midia_id: normalizeNullable(rawMediaId),
      json_filename: normalizeNullable(rawJsonFilename),
      evento_tipo: "alimentacao",
      source_file_id: sourceId,
    },
  };
}

function recordFingerprint(record) {
  const normalizedTime = normalizeSheetTime(record.horario) ?? String(record.horario ?? "").trim();
  const canonical = [
    String(record.data ?? "").trim(),
    normalizedTime,
    String(record.item ?? "").trim(),
    normalizeNullable(record.quantidade),
    normalizeNullable(record.midia_id),
    normalizeNullable(record.json_filename),
  ];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function stableImportKey(sourceId, fingerprint, occurrence) {
  const sourceHash = createHash("sha256").update(sourceId).digest("hex");
  return `dadossaude:v2:${sourceHash}:${fingerprint}:${occurrence}`;
}

async function existingSourceRecords(connectors, sourceId) {
  const records = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      select: "import_key,data,horario,item,quantidade,midia_id,json_filename",
      source_file_id: `eq.${sourceId}`,
      order: "id.asc",
      offset: String(offset),
      limit: "1000",
    });
    const response = await supabaseRequest(
      connectors,
      `/rest/v1/${ALIMENTACAO_TABLE}?${params.toString()}`,
    );
    const page = await response.json();
    records.push(...page);

    if (page.length < 1000) break;
    offset += page.length;
  }

  return records;
}

async function insertSyncBatch(connectors, records) {
  const params = new URLSearchParams({ on_conflict: "import_key" });
  const response = await supabaseRequest(
    connectors,
    `/rest/v1/${ALIMENTACAO_TABLE}?${params.toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(records),
    },
  );
  const inserted = await response.json();
  return Array.isArray(inserted) ? inserted.length : records.length;
}

async function syncSpreadsheet(connectors) {
  const payload = await readJsonInput();
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  const sourceId = payload.source?.id;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];

  if (
    !sourceId ||
    headers.length !== SHEET_HEADERS.length ||
    headers.some((header, index) => header !== SHEET_HEADERS[index])
  ) {
    throw new SupabaseRecordsError(
      "invalid_spreadsheet",
      "A planilha DadosSaude não possui o formato esperado.",
      422,
    );
  }

  const normalized = rows.map((row) => normalizeSheetRow(row, sourceId));
  const invalidRows = normalized.filter((row) => row.invalid);
  const validRecords = normalized.filter((row) => row.record).map((row) => row.record);
  const emptyRows = normalized.filter((row) => row.empty).length;
  const existingRecords = await existingSourceRecords(connectors, sourceId);
  const availableFingerprints = new Map();

  for (const record of existingRecords) {
    const fingerprint = recordFingerprint(record);
    availableFingerprints.set(fingerprint, (availableFingerprints.get(fingerprint) ?? 0) + 1);
  }

  const occurrences = new Map();
  const newRecords = [];
  let ignoredRows = 0;

  for (const record of validRecords) {
    const fingerprint = recordFingerprint(record);
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);

    const available = availableFingerprints.get(fingerprint) ?? 0;
    if (available > 0) {
      availableFingerprints.set(fingerprint, available - 1);
      ignoredRows += 1;
      continue;
    }

    newRecords.push({
      ...record,
      import_key: stableImportKey(sourceId, fingerprint, occurrence),
    });
  }

  let insertedRows = 0;
  try {
    for (let index = 0; index < newRecords.length; index += SYNC_BATCH_SIZE) {
      insertedRows += await insertSyncBatch(
        connectors,
        newRecords.slice(index, index + SYNC_BATCH_SIZE),
      );
    }
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Falha desconhecida durante a inserção.";
    throw new SupabaseRecordsError(
      "partial_sync",
      `Sincronização interrompida após ${insertedRows} novas linhas. Tente novamente para retomar com segurança. ${detail}`,
      error instanceof SupabaseRecordsError ? error.status : 502,
    );
  }

  ignoredRows += newRecords.length - insertedRows;

  const counts = {
    total_rows: rows.length - emptyRows,
    new_rows: insertedRows,
    ignored_rows: ignoredRows,
    invalid_rows: invalidRows.length,
  };

  return {
    ok: true,
    source: payload.source,
    ...counts,
    new: counts.new_rows,
    ignored: counts.ignored_rows,
    invalid: counts.invalid_rows,
    invalid_details: invalidRows.slice(0, 50).map((row) => ({
      row_number: row.rowNumber,
      reason: row.reason,
    })),
  };
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

function parseWaterMl(value) {
  return (
    parseMetric(value, (number, unit) => {
      if (unit.startsWith("l")) return Math.round(number * 1000);
      if (unit.startsWith("copo")) return Math.round(number * 250);
      return Math.round(number);
    }) ?? Math.round(parseNumber(value) ?? 0)
  );
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
      waterMl += parseWaterMl(quantity);
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
    waterMl += parseWaterMl(record.quantidade);
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
  if (action === "sync") return syncSpreadsheet(connectors);
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
