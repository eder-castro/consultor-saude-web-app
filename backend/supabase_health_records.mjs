import {
  createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID,
  scryptSync, timingSafeEqual,
} from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { createRequestPacer, retryDelayMs } from "./supabase_rate_limit.mjs";

const CONNECTOR_NAME = "supabase";
const ALIMENTACAO_TABLE = "alimentacao";
const DAILY_WATER_TOTAL_LABEL = "Total diário de água";
const TIME_ZONE = "America/Sao_Paulo";
const EVENT_TYPES = new Set(["alimentacao", "hidratacao", "exercicio", "sono", "peso", "outro"]);
const HEALTH_TABLES = [
  "alimentacao",
  "hidratacao",
  "exercicios",
  "sono",
  "peso",
  "midias",
  "analise",
  "log_json",
];
const SUPABASE_REQUEST_SPACING_MS = 125;
const supabasePacers = new WeakMap();

export class SupabaseRecordsError extends Error {
  constructor(code, message, status = 502, retryAfterMs = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

async function readJsonInput() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input.trim() ? JSON.parse(input) : {};
}

export async function supabaseRequest(connectors, path, init = {}) {
  const appSecret = process.env.SESSION_SECRET;
  if (!appSecret) {
    throw new SupabaseRecordsError(
      "app_secret_missing",
      "A credencial interna de acesso aos dados não está configurada.",
      503,
    );
  }
  const method = String(init.method ?? "GET").toUpperCase();
  let supabasePacer = supabasePacers.get(connectors);
  if (!supabasePacer) {
    supabasePacer = createRequestPacer({ spacingMs: SUPABASE_REQUEST_SPACING_MS });
    supabasePacers.set(connectors, supabasePacer);
  }
  const safeToRetry = method === "GET" || method === "HEAD";
  const maxAttempts = safeToRetry ? 3 : 1;
  const retryDeadline = Date.now() + 10_000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await supabasePacer.wait();

    const response = await connectors.proxy(CONNECTOR_NAME, path, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        "X-Health-App-Secret": appSecret,
      },
    });
    if (response.ok) return response;

    const retryAfterMs = [429, 503].includes(response.status)
      ? retryDelayMs(response.headers, attempt) : null;
    if (response.status === 429) supabasePacer.defer(retryAfterMs);
    if (safeToRetry && retryAfterMs !== null && attempt < maxAttempts - 1
        && Date.now() + retryAfterMs <= retryDeadline) {
      // A table-specific 503 must not postpone every unrelated table's retry.
      if (response.status === 503) {
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      }
      continue;
    }

    const detail = (await response.text()).slice(0, 500);
    if (detail.includes("SLEEP_DUPLICATE") || detail.includes("SLEEP_CHANGED")) {
      throw new SupabaseRecordsError(
        detail.includes("SLEEP_CHANGED") ? "sleep_changed" : "sleep_duplicate",
        detail.includes("SLEEP_CHANGED")
          ? "O sono salvo mudou. Confira novamente antes de substituir."
          : "Já existe sono nesta data. Revise e confirme a substituição.",
        409,
      );
    }
    throw new SupabaseRecordsError(
      "supabase_error",
      `Supabase respondeu ${response.status}: ${detail}`,
      response.status,
      retryAfterMs,
    );
  }

  throw new SupabaseRecordsError("supabase_error", "Supabase não respondeu.", 502);
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

const EXERCISE_DETAIL_LIMITS = {
  duracao_segundos: { min: 1, max: 86_400, integer: true },
  calorias_estimadas: { min: 0, max: 100_000 },
  distancia_km: { min: 0, max: 10_000, exclusiveMin: true },
  passos: { min: 0, max: 10_000_000, integer: true },
  pontos_cardio: { min: 0, max: 1_000_000 },
};
const EXERCISE_TEXT_FIELDS = ["intensidade", "ritmo_min_km", "ritmos_parciais"];

function normalizeExerciseDetails(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SupabaseRecordsError("invalid_exercise", "Confira os detalhes do exercício.", 422);
  }
  const allowed = new Set(["inicio", "fim", ...Object.keys(EXERCISE_DETAIL_LIMITS), ...EXERCISE_TEXT_FIELDS]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new SupabaseRecordsError("invalid_exercise", "Há um campo de exercício inválido.", 422);
  }
  const details = {};
  for (const field of ["inicio", "fim"]) {
    const time = value[field];
    if (time === undefined) continue;
    if (time === null || time === "") {
      details[field] = null;
      continue;
    }
    if (typeof time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new SupabaseRecordsError("invalid_exercise", "Informe os horários do exercício em HH:MM.", 422);
    }
    details[field] = time;
  }
  for (const [field, rules] of Object.entries(EXERCISE_DETAIL_LIMITS)) {
    const number = value[field];
    if (number === undefined) continue;
    if (number === null) {
      details[field] = null;
      continue;
    }
    const aboveMin = rules.exclusiveMin ? number > rules.min : number >= rules.min;
    if (typeof number !== "number" || !Number.isFinite(number) ||
        (rules.integer && !Number.isInteger(number)) || !aboveMin || number > rules.max) {
      throw new SupabaseRecordsError("invalid_exercise", "Confira os valores numéricos do exercício.", 422);
    }
    details[field] = number;
  }
  for (const field of EXERCISE_TEXT_FIELDS) {
    const text = value[field];
    if (text === undefined) continue;
    if (text === null || text === "") {
      details[field] = null;
      continue;
    }
    const limit = field === "ritmos_parciais" ? 6000 : field === "ritmo_min_km" ? 120 : 100;
    if (typeof text !== "string" || text.length > limit) {
      throw new SupabaseRecordsError("invalid_exercise", "Confira a intensidade e o ritmo informados.", 422);
    }
    const normalized = text.trim();
    details[field] = normalized || null;
  }
  return Object.keys(details).length ? details : null;
}

function normalizeTime(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const match = String(value)
    .trim()
    .match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) {
    throw new SupabaseRecordsError("invalid_time", "Informe o horário no formato HH:MM.", 422);
  }
  return `${match[1]}:${match[2]}`;
}

export function requireOwnerId(value) {
  const ownerId = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId)) {
    throw new SupabaseRecordsError(
      "invalid_owner",
      "O usuário autenticado não possui um identificador válido.",
      401,
    );
  }
  return ownerId;
}

function normalizeEventRecord(record, eventType, now, ownerId) {
  const importKey = record.import_key ?? `app:${randomUUID()}`;
  const data = record.data ?? now.data;
  const horario = normalizeTime(record.horario, now.horario);
  const item = String(record.item ?? record.tipo ?? "").trim();
  const quantidade = normalizeNullable(
    record.quantidade ?? record.quantidade_estimada ?? record.duracao_min,
  );
  const sourceFileId = record.source_file_id ?? "app";

  if (eventType === "hidratacao") {
    return {
      table: "hidratacao",
      dailyTotal: record.total_diario === true,
      record: {
        owner_id: ownerId,
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
    const hasReviewedDetails = record.exercicio !== undefined && record.exercicio !== null;
    const details = normalizeExerciseDetails(record.exercicio);
    const duration = hasReviewedDetails
      ? (
        details?.duracao_segundos == null
          ? null
          : String(Math.round(details.duracao_segundos / 60))
      )
      : quantidade;
    return {
      table: "exercicios",
      record: {
        owner_id: ownerId,
        import_key: importKey,
        data,
        tipo: item,
        duracao_min: duration,
        intensidade: normalizeNullable(
          hasReviewedDetails ? details?.intensidade : record.intensidade,
        ),
        calorias_estimadas: normalizeNullable(
          hasReviewedDetails ? details?.calorias_estimadas : record.calorias_estimadas,
        ),
        detalhes_exercicio: details,
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
        owner_id: ownerId,
        import_key: importKey,
        data,
        inicio: normalizeNullable(record.inicio),
        fim: normalizeNullable(record.fim),
        duracao_minutos: quantidade,
        sono_profundo_min: normalizeNullable(record.sono_profundo_min),
        sono_leve_min: normalizeNullable(record.sono_leve_min),
        sono_rem_min: normalizeNullable(record.sono_rem_min),
        acordado_min: normalizeNullable(record.acordado_min),
        ...(record.sono_niveis != null ? { sono_niveis: normalizeSleepLevels(record.sono_niveis) } : {}),
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
        owner_id: ownerId,
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
      owner_id: ownerId,
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

function normalizeLabel(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function durationMinutes(value) {
  const hours = parseSleepHours(value);
  return hours === null ? null : Math.round(hours * 60);
}

function formatDurationMinutes(minutes) {
  return minutes === null ? null : `${minutes} min`;
}

function consolidateSleepItems(items) {
  const confirmedItems = items.filter((item) => item.confirmado !== false);
  if (confirmedItems.length <= 1) return confirmedItems;

  const stages = {
    deep: null,
    light: null,
    rem: null,
    awake: null,
  };
  let totalItem = null;

  for (const item of confirmedItems) {
    const label = normalizeLabel(item.item);
    const minutes = durationMinutes(item.quantidade ?? item.quantidade_estimada);
    if (minutes === null) continue;

    if (label.includes("profund")) {
      stages.deep = minutes;
    } else if (label.includes("leve")) {
      stages.light = minutes;
    } else if (/(^|\s)rem(\s|$)/.test(label)) {
      stages.rem = minutes;
    } else if (label.includes("acord")) {
      stages.awake = minutes;
    } else if (
      label.includes("total") ||
      label.includes("tempo dormido") ||
      label.includes("duracao do sono")
    ) {
      totalItem = item;
    }
  }

  const hasStages = Object.values(stages).some((value) => value !== null);
  if (!hasStages && !totalItem) return confirmedItems;

  const explicitTotal = totalItem
    ? durationMinutes(totalItem.quantidade ?? totalItem.quantidade_estimada)
    : null;
  const stageTotal =
    [stages.deep, stages.light, stages.rem]
      .filter((value) => value !== null)
      .reduce((sum, value) => sum + value, 0) || null;
  const total = explicitTotal ?? stageTotal;
  if (total === null) return confirmedItems;

  return [
    {
      ...(totalItem ?? confirmedItems[0]),
      item: "Sono total",
      quantidade_estimada: formatDurationMinutes(total),
      sono_profundo_min: formatDurationMinutes(stages.deep),
      sono_leve_min: formatDurationMinutes(stages.light),
      sono_rem_min: formatDurationMinutes(stages.rem),
      acordado_min: formatDurationMinutes(stages.awake),
    },
  ];
}

function requireEventType(value) {
  if (!EVENT_TYPES.has(value)) {
    throw new SupabaseRecordsError(
      "invalid_event_type",
      `Tipo de registro inválido: ${String(value ?? "não informado")}.`,
      422,
    );
  }
  return value;
}

function normalizeRecords(payload) {
  const now = saoPauloNow();
  const ownerId = requireOwnerId(payload.owner_id);

  if (Array.isArray(payload.records) && payload.records.length > 0) {
    return payload.records.map((record) =>
      normalizeEventRecord(record, requireEventType(record.evento_tipo), now, ownerId),
    );
  }

  if (Array.isArray(payload.grupos) && payload.grupos.length > 0) {
    return payload.grupos.flatMap((group) => {
      const eventType = requireEventType(group.evento_tipo);
      const items =
        eventType === "sono"
          ? consolidateSleepItems(group.itens ?? [])
          : (group.itens ?? []).filter((item) => item.confirmado !== false);
      return items.map((item) =>
        normalizeEventRecord(
          {
            ...item,
            data: item.data ?? group.data,
            horario: item.horario ?? group.horario,
          },
          eventType,
          now,
          ownerId,
        ),
      );
    });
  }

  const eventType = EVENT_TYPES.has(payload.evento_tipo) ? payload.evento_tipo : "outro";
  return (payload.itens ?? [])
    .filter((item) => item.confirmado !== false)
    .map((item) => normalizeEventRecord(item, eventType, now, ownerId));
}

export async function saveRecordsPayload(connectors, payload) {
  const entries = normalizeRecords(payload);

  if (entries.length === 0) {
    throw new SupabaseRecordsError(
      "invalid_records",
      "Nenhum registro de saúde válido foi informado.",
      422,
    );
  }
  if (entries.length > 100) {
    throw new SupabaseRecordsError("too_many_records", "Salve até 100 itens por vez.", 422);
  }

  const totals = entries.filter((entry) => entry.dailyTotal);
  for (const entry of totals) normalizeDailyWaterTotal(entry);
  const operationId = payload.operation_id;
  if (typeof operationId !== "string" || !operationId.trim() || operationId.length > 100) {
    throw new SupabaseRecordsError("invalid_operation", "Confirmação inválida.", 422);
  }
  const ownerId = requireOwnerId(payload.owner_id);
  entries.forEach((entry, index) => {
    const hash = createHash("sha256").update(JSON.stringify([ownerId, operationId, index])).digest("hex");
    entry.record.import_key = `app:${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  });
  // Keys must remain identical across attempts, including after an unknown network outcome.
  // The database keeps the result and rejects reuse of the operation ID with different data.
  const request = {
    p_owner_id: ownerId,
    p_operation_id: operationId,
    p_entries: entries,
    p_sleep_replacements: payload.sleep_replacements ?? [],
  };
  const response = await supabaseRequest(connectors, "/rest/v1/rpc/save_health_records_checked", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return response.json();
}

function normalizeDailyWaterTotal(entry) {
  const { data } = entry.record;
  const date = new Date(`${data}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== data) {
    throw new SupabaseRecordsError("invalid_water_date", "Confira a data do total diário de água.", 422);
  }
  const match = String(entry.record.quantidade ?? "").trim()
    .match(/^(\d{1,5}(?:[.,]\d{1,2})?)\s*(ml|l|litros?)$/i);
  if (!match) {
    throw new SupabaseRecordsError("invalid_water_total", "Informe o total diário em ml ou litros.", 422);
  }
  const milliliters = Math.round(Number(match[1].replace(",", ".")) *
    (match[2].toLowerCase() === "ml" ? 1 : 1000));
  if (milliliters < 1 || milliliters > 15000) {
    throw new SupabaseRecordsError("invalid_water_total", "Confira o total diário de água.", 422);
  }
  entry.record.item = DAILY_WATER_TOTAL_LABEL;
  entry.record.quantidade = `${milliliters} ml`;
  if (data < saoPauloNow().data) {
    // A backdated declaration describes the whole day, not the current clock time on that day.
    entry.record.horario = "23:59";
  }
}

async function saveRecords(connectors) {
  return saveRecordsPayload(connectors, await readJsonInput());
}

export async function changeMealTime(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  const ids = payload.record_ids;
  const horario = payload.horario;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== "string" ||
        !/^(?:[1-9]\d{0,18}|[0-9a-f]{8}-[0-9a-f-]{27})$/i.test(id)) ||
      typeof horario !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(horario)) {
    throw new SupabaseRecordsError("invalid_record", "Confira a refeição e o horário antes de salvar.", 422);
  }
  const params = new URLSearchParams({
    id: `in.(${ids.join(",")})`, owner_id: `eq.${ownerId}`, evento_tipo: "eq.alimentacao",
  });
  const path = `/rest/v1/alimentacao?${params}`;
  const current = await (await supabaseRequest(connectors, `${path}&select=id,data,horario`)).json();
  if (!Array.isArray(current) || current.length !== ids.length ||
      current.some((row) => row.data !== current[0].data || row.horario !== current[0].horario)) {
    throw new SupabaseRecordsError("record_not_found", "A refeição mudou ou não foi encontrada. Atualize a página e tente novamente.", 409);
  }
  // One database statement updates all selected items, never sequential writes.
  const rows = await (await supabaseRequest(connectors, path, {
    method: "PATCH",
    headers: { Prefer: "return=representation", "Content-Type": "application/json" },
    body: JSON.stringify({ horario }),
  })).json();
  if (!Array.isArray(rows) || rows.length !== ids.length) {
    throw new SupabaseRecordsError("record_changed", "A refeição mudou durante a correção. Atualize a página para conferir o horário.", 409);
  }
  return { ok: true };
}

export async function changeMealRecord(connectors, payload, remove = false) {
  const ownerId = requireOwnerId(payload.owner_id);
  const recordId = String(payload.record_id ?? "");
  if (!/^(?:[1-9]\d{0,18}|[0-9a-f]{8}-[0-9a-f-]{27})$/i.test(recordId)) {
    throw new SupabaseRecordsError("invalid_record", "Registro de alimentação inválido.", 422);
  }
  const params = new URLSearchParams({
    id: `eq.${recordId}`,
    owner_id: `eq.${ownerId}`,
    evento_tipo: "eq.alimentacao",
  });
  const patch = !remove
    ? {
        item: String(payload.item ?? "").trim(),
        quantidade: String(payload.quantidade ?? "").trim(),
      }
    : null;
  if (patch && payload.data != null) {
    const value = String(payload.data);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) ||
        new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) {
      throw new SupabaseRecordsError("invalid_date", "Informe uma data válida.", 422);
    }
    patch.data = value;
  }
  if (patch && payload.horario != null) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(payload.horario)) {
      throw new SupabaseRecordsError("invalid_time", "Informe um horário válido.", 422);
    }
    patch.horario = payload.horario;
  }
  if (patch && (!patch.item || !patch.quantidade || patch.item.length > 200 || patch.quantidade.length > 100)) {
    throw new SupabaseRecordsError("invalid_record", "Confira o item e a quantidade antes de salvar.", 422);
  }
  const response = await supabaseRequest(
    connectors,
    `/rest/v1/alimentacao?${params.toString()}`,
    {
      method: remove ? "DELETE" : "PATCH",
      headers: {
        Prefer: "return=representation",
        ...(patch ? { "Content-Type": "application/json" } : {}),
      },
      ...(patch ? { body: JSON.stringify(patch) } : {}),
    },
  );
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new SupabaseRecordsError(
      "record_not_found", "Registro não encontrado. Atualize a página e tente novamente.", 404,
    );
  }
  return { ok: true };
}

export async function replaceMealRecords(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  const correctionId = String(payload.correction_id ?? "").trim();
  const recordIds = payload.record_ids;
  const keepId = String(payload.keep_record_id ?? "");
  const validId = (id) => /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;
  if (
    !correctionId || correctionId.length > 100 ||
    !Array.isArray(recordIds) || recordIds.length < 1 || recordIds.length > 100 ||
    recordIds.some((id) => typeof id !== "string" || !validId(id)) ||
    new Set(recordIds).size !== recordIds.length ||
    !recordIds.includes(keepId) ||
    !Array.isArray(payload.expected_rows) ||
    payload.expected_rows.length !== recordIds.length ||
    !String(payload.item ?? "").trim() || String(payload.item).trim().length > 200 ||
    !String(payload.quantidade ?? "").trim() || String(payload.quantidade).trim().length > 100
  ) {
    throw new SupabaseRecordsError("invalid_meal_selection", "Selecione registros válidos para corrigir.", 422);
  }
  const response = await supabaseRequest(connectors, "/rest/v1/rpc/apply_meal_correction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_owner_id: ownerId,
      p_correction_id: correctionId,
      p_record_ids: recordIds,
      p_keep_record_id: keepId,
      p_item: String(payload.item).trim(),
      p_quantidade: String(payload.quantidade).trim(),
      p_expected_rows: payload.expected_rows,
    }),
  });
  return response.json();
}

export async function mealCorrectionStatuses(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  const ids = payload.correction_ids;
  if (!Array.isArray(ids) || ids.length > 100 ||
      ids.some((id) => typeof id !== "string" || !id || id.length > 100)) {
    throw new SupabaseRecordsError("invalid_corrections", "Identificadores de correção inválidos.", 422);
  }
  const response = await supabaseRequest(connectors, "/rest/v1/rpc/meal_correction_statuses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_owner_id: ownerId, p_correction_ids: ids }),
  });
  return response.json();
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

export function waterTotalForDay(foodRows, hydrationRows) {
  const rows = [
    ...foodRows.filter((row) => row.evento_tipo === "hidratacao"),
    ...hydrationRows,
  ].sort((a, b) =>
    String(a.horario ?? "").localeCompare(String(b.horario ?? "")) ||
    Number(a.item === DAILY_WATER_TOTAL_LABEL) - Number(b.item === DAILY_WATER_TOTAL_LABEL),
  );
  let total = 0;
  for (const row of rows) {
    if (row.item === DAILY_WATER_TOTAL_LABEL) total = parseWaterMl(row.quantidade);
    else total += parseWaterMl(row.quantidade);
  }
  return total;
}

function parseSleepHours(value) {
  const text = String(value ?? "");
  const hoursMatch = text.match(/(\d+(?:[.,]\d+)?)\s*h/i);
  const minutesMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:min|m\b)/i);
  if (hoursMatch) {
    const hours = Number.parseFloat(hoursMatch[1].replace(",", "."));
    const minutes = minutesMatch ? Number.parseFloat(minutesMatch[1].replace(",", ".")) : 0;
    return hours + minutes / 60;
  }
  const number = parseNumber(text);
  return number === null ? null : number / 60;
}

const LEGACY_SLEEP_STAGES = [
  { key: "sono_profundo_min", label: "Sono profundo" },
  { key: "sono_leve_min", label: "Sono leve" },
  { key: "sono_rem_min", label: "Sono REM" },
  { key: "acordado_min", label: "Acordado" },
];

function legacySleepStage(row) {
  const populated = LEGACY_SLEEP_STAGES.filter(
    ({ key }) => row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "",
  );
  if (populated.length !== 1 || durationMinutes(row[populated[0].key]) === null) return null;
  return {
    key: populated[0].key,
    label: populated[0].label,
    value: row[populated[0].key],
    minutes: durationMinutes(row[populated[0].key]),
  };
}

export async function listSleepReviews(connectors, ownerId) {
  const id = requireOwnerId(ownerId);
  const params = new URLSearchParams({
    select:
      "id,data,inicio,fim,duracao_minutos,sono_profundo_min,sono_leve_min,sono_rem_min,acordado_min",
    owner_id: `eq.${id}`,
    order: "data.asc,id.asc",
    limit: "500",
  });
  const response = await supabaseRequest(connectors, `/rest/v1/sono?${params.toString()}`);
  const rawRows = await response.text();
  const rows = JSON.parse(rawRows.replace(/"id"\s*:\s*(\d+)/g, (_match, id) => `"id":"${id}"`));
  const groups = new Map();

  for (const row of rows) {
    const stage = legacySleepStage(row);
    if (!stage) continue;
    const groupKey = [row.data ?? "", row.inicio ?? "", row.fim ?? ""].join("|");
    const group = groups.get(groupKey) ?? {
      id: groupKey,
      data: row.data,
      inicio: row.inicio ?? null,
      fim: row.fim ?? null,
      registros: [],
    };
    group.registros.push({
      id: String(row.id),
      etapa: stage.key,
      etapa_label: stage.label,
      valor_existente: stage.value,
      minutos_existentes: stage.minutes,
      duracao_minutos: row.duracao_minutos ?? null,
    });
    groups.set(groupKey, group);
  }

  return {
    ok: true,
    revisoes: [...groups.values()].filter((group) => group.registros.length >= 2),
  };
}

const SLEEP_SELECT =
  "id,data,inicio,fim,duracao_minutos,sono_profundo_min,sono_leve_min,sono_rem_min,acordado_min";

function sleepRecordId(value) {
  const text = String(value ?? "");
  if (!/^[1-9]\d*$/.test(text) || BigInt(text) > 9223372036854775807n) {
    throw new SupabaseRecordsError("invalid_sleep_record", "Registro de sono inválido.", 422);
  }
  return text;
}

export async function listSleepRecords(connectors, ownerId) {
  const id = requireOwnerId(ownerId);
  const params = new URLSearchParams({
    select: SLEEP_SELECT,
    owner_id: `eq.${id}`,
    order: "data.desc,id.desc",
    limit: "500",
  });
  const response = await supabaseRequest(connectors, `/rest/v1/sono?${params.toString()}`);
  const raw = await response.text();
  const rows = JSON.parse(raw.replace(/"id"\s*:\s*(\d+)/g, (_match, value) => `"id":"${value}"`));
  const legacyGroups = new Map();
  for (const row of rows) {
    if (!legacySleepStage(row)) continue;
    const key = [row.data ?? "", row.inicio ?? "", row.fim ?? ""].join("|");
    legacyGroups.set(key, (legacyGroups.get(key) ?? 0) + 1);
  }
  return {
    ok: true,
    registros: rows.filter((row) => {
      const key = [row.data ?? "", row.inicio ?? "", row.fim ?? ""].join("|");
      return (legacyGroups.get(key) ?? 0) < 2 || !legacySleepStage(row);
    }),
  };
}

export async function updateSleepRecord(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  const recordId = sleepRecordId(payload.record_id);
  const keys = ["sono_profundo_min", "sono_leve_min", "sono_rem_min", "acordado_min"];
  const total = payload.total_sleep_min;
  if (!Number.isInteger(total) || total < 1 || total > 1440 ||
      keys.some((key) => payload[key] !== null && (!Number.isInteger(payload[key]) || payload[key] < 0 || payload[key] > 1440))) {
    throw new SupabaseRecordsError("invalid_sleep_duration", "Informe durações válidas em minutos.", 422);
  }
  const known = keys.slice(0, 3).map((key) => payload[key]).filter((value) => value !== null);
  const sum = known.reduce((value, minutes) => value + minutes, 0);
  if (sum > total || (known.length === 3 && sum !== total)) {
    throw new SupabaseRecordsError(
      "invalid_sleep_stages",
      "As fases dormidas devem somar o total quando todas são informadas; tempo acordado não entra na soma.",
      422,
    );
  }
  const params = new URLSearchParams({
    select: SLEEP_SELECT,
    id: `eq.${recordId}`,
    owner_id: `eq.${ownerId}`,
  });
  const existing = await supabaseRequest(connectors, `/rest/v1/sono?${params.toString()}`);
  const existingRows = await existing.json();
  if (existingRows.length !== 1) {
    throw new SupabaseRecordsError("sleep_not_found", "Registro de sono não encontrado.", 404);
  }
  const row = existingRows[0];
  if (legacySleepStage(row)) {
    const groupParams = new URLSearchParams({
      select: SLEEP_SELECT,
      owner_id: `eq.${ownerId}`,
      data: `eq.${row.data}`,
      inicio: row.inicio === null ? "is.null" : `eq.${row.inicio}`,
      fim: row.fim === null ? "is.null" : `eq.${row.fim}`,
    });
    const group = await supabaseRequest(connectors, `/rest/v1/sono?${groupParams.toString()}`);
    if ((await group.json()).filter(legacySleepStage).length > 1) {
      throw new SupabaseRecordsError("legacy_sleep_session", "Revise e consolide esta sessão antiga antes de editá-la.", 409);
    }
  }
  const body = {
    duracao_minutos: `${total} min`,
    ...Object.fromEntries(keys.map((key) => [key, payload[key] === null ? null : `${payload[key]} min`])),
  };
  const updated = await supabaseRequest(connectors, `/rest/v1/sono?${params.toString()}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  const raw = await updated.text();
  const rows = JSON.parse(raw.replace(/"id"\s*:\s*(\d+)/g, (_match, value) => `"id":"${value}"`));
  if (rows.length !== 1) {
    throw new SupabaseRecordsError("sleep_not_found", "Registro de sono não encontrado.", 404);
  }
  return { ok: true, registro: rows[0] };
}

export async function consolidateSleepRecords(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  const recordIds = [...new Set((payload.record_ids ?? []).map((value) => String(value).trim()))];
  if (
    recordIds.length === 0 ||
    recordIds.length > 20 ||
    recordIds.some((value) => {
      if (!/^\d+$/.test(value)) return true;
      const id = BigInt(value);
      return id < 1n || id > 9223372036854775807n;
    })
  ) {
    throw new SupabaseRecordsError(
      "invalid_sleep_records",
      "Os registros selecionados não são válidos.",
      422,
    );
  }
  if (
    !Number.isInteger(payload.total_sleep_min) ||
    payload.total_sleep_min < 1 ||
    payload.total_sleep_min > 1440
  ) {
    throw new SupabaseRecordsError(
      "invalid_sleep_total",
      "Informe o total correto entre 1 e 1440 minutos.",
      422,
    );
  }

  const response = await supabaseRequest(connectors, "/rest/v1/rpc/consolidate_sleep_records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_owner_id: ownerId,
      p_record_ids: recordIds,
      p_total_sleep_min: payload.total_sleep_min,
    }),
  });
  return response.json();
}

function formatMeals(records) {
  const meals = new Map();
  for (const record of records) {
    if (record.evento_tipo !== "alimentacao" && record.evento_tipo) continue;
    const mealItems = meals.get(record.horario) ?? [];
    mealItems.push({
      ...(record.id == null ? {} : { id: String(record.id) }),
      item: record.item,
      quantidade: record.quantidade ?? "N/A",
    });
    meals.set(record.horario, mealItems);
  }
  return [...meals.entries()].map(([hora, itens]) => ({ hora, itens }));
}

function buildDailySummary(data, datasets) {
  let exercise = null;
  let sleepHours = null;
  let weightKg = null;

  for (const record of datasets.alimentacao) {
    const quantity = record.quantidade ?? "N/A";

    if (record.evento_tipo === "hidratacao") {
      continue;
    } else if (record.evento_tipo === "exercicio") {
      exercise = `${record.item} (${quantity})`;
    } else if (record.evento_tipo === "sono") {
      sleepHours = parseMetric(quantity, (number) => number);
    } else if (record.evento_tipo === "peso") {
      weightKg = parseMetric(quantity, (number) => number);
    }
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
    agua_ml: waterTotalForDay(datasets.alimentacao, datasets.hidratacao),
    agua_meta_ml: 2500,
    refeicoes: formatMeals(datasets.alimentacao),
    exercicio: exercise,
    sono_horas: sleepHours,
    peso_kg: weightKg,
    tendencia: null,
  };
}

async function rowsForDate(connectors, table, data, ownerId, select, order) {
  const params = new URLSearchParams({
    select,
    data: `eq.${data}`,
    owner_id: `eq.${ownerId}`,
    order,
  });
  const response = await supabaseRequest(connectors, `/rest/v1/${table}?${params.toString()}`);
  return response.json();
}

function shiftDate(dateText, days) {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function rowsForPeriod(connectors, table, startDate, endDate, ownerId, select, order) {
  const params = new URLSearchParams({
    select,
    data: `gte.${startDate}`,
    owner_id: `eq.${ownerId}`,
    order,
  });
  params.append("data", `lte.${endDate}`);
  const response = await supabaseRequest(connectors, `/rest/v1/${table}?${params.toString()}`);
  return response.json();
}

export const ANALYSIS_TABLES = {
  alimentacao: "data,horario,item,quantidade,evento_tipo,import_key",
  hidratacao: "data,horario,item,quantidade,import_key",
  exercicios: "data,tipo,duracao_min,intensidade,calorias_estimadas,detalhes_exercicio,import_key",
  sono: "data,inicio,fim,duracao_minutos,sono_profundo_min,sono_leve_min,sono_rem_min,acordado_min,sono_niveis,import_key",
  peso: "data,horario,valor_kg,import_key",
};

export async function currentDayAnalysisRecords(connectors, ownerId, data) {
  const id = requireOwnerId(ownerId);
  if (typeof data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new SupabaseRecordsError("invalid_analysis_date", "Data inválida para o contexto do dia.", 422);
  }
  const entries = await Promise.all(Object.entries(ANALYSIS_TABLES).map(async ([table, select]) => {
    const records = [];
    const pageSize = 500;
    for (let offset = 0; offset < 10_000; offset += pageSize) {
      const params = new URLSearchParams({
        select, owner_id: `eq.${id}`, data: `eq.${data}`,
        order: "id.asc", limit: String(pageSize), offset: String(offset),
      });
      const response = await supabaseRequest(connectors, `/rest/v1/${table}?${params.toString()}`);
      const page = await response.json();
      if (!Array.isArray(page) || page.length > pageSize || page.some((row) => !row || row.data !== data)) {
        throw new SupabaseRecordsError(
          "invalid_today_context", "Os registros de hoje não puderam ser carregados com segurança.", 502,
        );
      }
      records.push(...page.map(({ import_key, ...row }) => row));
      if (page.length < pageSize) return [table, records];
    }
    throw new SupabaseRecordsError(
      "today_context_too_large", "Há registros demais hoje para analisar sem omitir dados.", 422,
    );
  }));
  return { data, registros: Object.fromEntries(entries) };
}

export async function dailyAnalysisSummary(connectors, ownerId) {
  const id = requireOwnerId(ownerId);
  const response = await supabaseRequest(connectors, "/rest/v1/rpc/health_daily_analysis_context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_owner_id: id }),
  });
  const snapshot = await response.json();
  const day = snapshot?.para_dia;
  if (snapshot?.ok !== true || typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      snapshot.periodo?.inicio !== shiftDate(day, -7) ||
      snapshot.periodo?.fim !== shiftDate(day, -1) ||
      !Array.isArray(snapshot.resumo?.dias) || snapshot.resumo.dias.length !== 7 ||
      snapshot.resumo.dias.some((entry, index) => entry.data !== shiftDate(day, index - 7))) {
    throw new SupabaseRecordsError(
      "invalid_daily_context", "O resumo diário dos sete dias não pôde ser carregado com segurança.", 502,
    );
  }
  return snapshot;
}

export async function dayAnalysisContext(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  const snapshot = await dailyAnalysisSummary(connectors, ownerId);
  const today = await currentDayAnalysisRecords(connectors, ownerId, snapshot.para_dia);
  return { ...snapshot, registros_do_dia: today };
}

export async function savedSevenDayAnalysisContext(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  const refs = payload.record_refs;
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > 100 ||
      refs.some((ref) => !ref || !Object.hasOwn(ANALYSIS_TABLES, ref.table) ||
        typeof ref.import_key !== "string" || !/^app:[0-9a-f-]{36}$/i.test(ref.import_key)) ||
      new Set(refs.map((ref) => `${ref.table}:${ref.import_key}`)).size !== refs.length) {
    throw new SupabaseRecordsError("invalid_analysis_refs", "Referências de registros inválidas.", 422);
  }
  const grouped = Map.groupBy(refs, (ref) => ref.table);
  const confirmed = await Promise.all([...grouped].map(async ([table, items]) => {
    const params = new URLSearchParams({
      select: ANALYSIS_TABLES[table],
      owner_id: `eq.${ownerId}`,
      import_key: `in.(${items.map((item) => item.import_key).join(",")})`,
    });
    const response = await supabaseRequest(connectors, `/rest/v1/${table}?${params.toString()}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== items.length ||
        rows.some((row) => !items.some((item) => item.import_key === row.import_key))) {
      throw new SupabaseRecordsError("missing_analysis_records", "Registros salvos não encontrados para análise.", 404);
    }
    return { table, rows };
  }));
  const dates = confirmed.flatMap(({ rows }) => rows.map((row) => row.data));
  if (dates.some((value) => typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
    throw new SupabaseRecordsError("invalid_analysis_date", "Registro salvo sem data válida.", 422);
  }
  // The calendar day of the request, not an edited/backdated event, selects the
  // immutable context. Repeated sends and retries reuse the same persisted row.
  const snapshot = await dailyAnalysisSummary(connectors, ownerId);
  const todayRecords = await currentDayAnalysisRecords(connectors, ownerId, snapshot.para_dia);
  const [profile, examResponse] = await Promise.all([
    getContextRow(connectors, ownerId),
    supabaseRequest(connectors, `/rest/v1/health_exams?${new URLSearchParams({
      select: "exam_type,exam_date,summary,extracted_data,uncertainties,status",
      owner_id: `eq.${ownerId}`,
      status: "eq.confirmed",
      order: "exam_date.desc.nullslast,created_at.desc",
      limit: "10",
    })}`),
  ]);
  const exams = await examResponse.json();
  if (!Array.isArray(exams) || exams.some((exam) => exam.status !== "confirmed")) {
    throw new SupabaseRecordsError(
      "invalid_clinical_context", "Os exames confirmados não puderam ser carregados com segurança.", 502,
    );
  }
  const stripKeys = (rows) => rows.map(({ import_key, ...row }) => row);
  return {
    ...snapshot,
    perfil_clinico: profile?.clinical_profile ?? "",
    instrucoes_do_gem: profile?.gem_instructions ?? "",
    exames_confirmados_recentes: exams,
    registros_do_dia: todayRecords,
    confirmados: confirmed.map(({ table, rows }) => ({ tipo: table, registros: stripKeys(rows) })),
  };
}

function rounded(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function metricTrend(days, key, label, unit, { positiveOnly = true, thresholdRatio = 0.1 } = {}) {
  const observed = days
    .map((day) => ({ data: day.data, value: day[key] }))
    .filter(
      ({ value }) =>
        typeof value === "number" && Number.isFinite(value) && (!positiveOnly || value > 0),
    );
  if (observed.length === 0) {
    return `Ainda não há registros de ${label} nesta semana.`;
  }
  const average = observed.reduce((sum, item) => sum + item.value, 0) / observed.length;
  if (observed.length === 1) {
    return `Há apenas um registro de ${label} na semana: ${rounded(average)} ${unit}.`;
  }
  const first = observed[0].value;
  const last = observed.at(-1).value;
  const change = last - first;
  const threshold = Math.max(Math.abs(first) * thresholdRatio, 0.1);
  const direction =
    Math.abs(change) < threshold
      ? "permaneceu estável"
      : change > 0
        ? "apresentou tendência de alta"
        : "apresentou tendência de queda";
  return `${label} ${direction} entre os registros da semana, com média de ${rounded(average)} ${unit}.`;
}

function weeklyMealDays(alimentacao, startDate) {
  const days = Array.from({ length: 7 }, (_, index) => ({
    data: shiftDate(startDate, index),
    refeicoes: 0,
  }));
  const byDate = new Map(days.map((day) => [day.data, day]));
  const meals = new Set();
  for (const record of alimentacao) {
    if (byDate.has(record.data) &&
        (record.evento_tipo === "alimentacao" || !record.evento_tipo)) {
      meals.add(`${record.data}|${record.horario ?? ""}`);
    }
  }
  for (const meal of meals) {
    const day = byDate.get(meal.split("|", 1)[0]);
    day.refeicoes += 1;
  }
  return days;
}

export async function weeklyMeals(connectors, requestedEndDate, ownerId) {
  const endDate = requestedEndDate || saoPauloNow().data;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
      !Number.isFinite(Date.parse(`${endDate}T12:00:00Z`)) ||
      new Date(`${endDate}T12:00:00Z`).toISOString().slice(0, 10) !== endDate) {
    throw new SupabaseRecordsError("invalid_date", "A data deve usar o formato AAAA-MM-DD.", 422);
  }
  const startDate = shiftDate(endDate, -6);
  const alimentacao = await rowsForPeriod(
    connectors, ALIMENTACAO_TABLE, startDate, endDate, requireOwnerId(ownerId),
    "data,horario,evento_tipo", "data.asc,horario.asc,id.asc",
  );
  const days = weeklyMealDays(alimentacao, startDate);
  return {
    ok: true,
    periodo: { inicio: startDate, fim: endDate },
    dias: days,
    tendencia: metricTrend(days, "refeicoes", "O número de refeições registradas", "por dia"),
  };
}

export function normalizeSleepLevels(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SupabaseRecordsError("invalid_sleep_levels", "Confira os níveis das fases do sono.", 422);
  }
  const result = {};
  for (const key of ["profundo", "leve", "rem", "acordado"]) {
    if (value[key] == null) continue;
    if (!["baixo", "normal", "alto"].includes(value[key])) {
      throw new SupabaseRecordsError("invalid_sleep_levels", "Nível de sono inválido.", 422);
    }
    result[key] = value[key];
  }
  return result;
}

export async function weightHistory(connectors, payload) {
  const owner = requireOwnerId(payload.owner_id);
  const date = String(payload.data ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) ||
      new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date ||
      !["semana", "dia", "mes", "ano"].includes(payload.periodo)) {
    throw new SupabaseRecordsError("invalid_date", "Confira o período e a data do peso.", 422);
  }
  const period = payload.periodo;
  const start = period === "semana" ? shiftDate(date, -6)
    : period === "ano" ? `${date.slice(0, 4)}-01-01`
    : period === "mes" ? `${date.slice(0, 7)}-01` : date;
  const end = period === "ano" ? `${date.slice(0, 4)}-12-31`
    : period === "mes" ? new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).toISOString().slice(0, 10) : date;
  // Supabase limits a response to 1000 rows; a year can contain more readings.
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      select: "id,data,horario,valor_kg",
      data: `gte.${start}`, owner_id: `eq.${owner}`,
      order: "data.asc,horario.asc,id.asc", limit: "1000", offset: String(offset),
    });
    params.append("data", `lte.${end}`);
    const response = await supabaseRequest(connectors, `/rest/v1/peso?${params}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const points = new Map();
  const dailyPoints = [];
  for (const row of rows) {
    const kg = parseNumber(row.valor_kg);
    if (kg === null || kg <= 0) continue;
    const point = { data: row.data, horario: row.horario, peso_kg: kg };
    if (period === "dia") dailyPoints.push(point);
    else points.set(period === "ano" ? row.data.slice(0, 7) : row.data, point);
  }
  return { ok: true, periodo: { inicio: start, fim: end },
    pontos: period === "dia" ? dailyPoints : [...points.values()] };
}

export async function weeklySummary(connectors, requestedEndDate, ownerId) {
  const endDate = requestedEndDate || saoPauloNow().data;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new SupabaseRecordsError("invalid_date", "A data deve usar o formato AAAA-MM-DD.", 422);
  }
  const id = requireOwnerId(ownerId);
  const startDate = shiftDate(endDate, -6);
  const [alimentacao, hidratacao, exercicios, sono, peso] = await Promise.all([
    rowsForPeriod(
      connectors,
      ALIMENTACAO_TABLE,
      startDate,
      endDate,
      id,
      "data,horario,item,quantidade,evento_tipo",
      "data.asc,horario.asc,id.asc",
    ),
    rowsForPeriod(
      connectors,
      "hidratacao",
      startDate,
      endDate,
      id,
      "data,horario,item,quantidade",
      "data.asc,horario.asc,id.asc",
    ),
    rowsForPeriod(
      connectors,
      "exercicios",
      startDate,
      endDate,
      id,
      "data,duracao_min",
      "data.asc,id.asc",
    ),
    rowsForPeriod(
      connectors,
      "sono",
      startDate,
      endDate,
      id,
      "data,duracao_minutos,sono_profundo_min,sono_leve_min,sono_rem_min,acordado_min,sono_niveis",
      "data.asc,id.asc",
    ),
    rowsForPeriod(
      connectors,
      "peso",
      startDate,
      endDate,
      id,
      "data,horario,valor_kg",
      "data.asc,horario.asc,id.asc",
    ),
  ]);

  const days = Array.from({ length: 7 }, (_, index) => ({
    data: shiftDate(startDate, index),
    agua_ml: 0,
    refeicoes: 0,
    exercicio_min: 0,
    sono_horas: null,
    sono_profundo_horas: null,
    sono_leve_horas: null,
    sono_rem_horas: null,
    acordado_horas: null,
    peso_kg: null,
  }));
  const byDate = new Map(days.map((day) => [day.data, day]));
  for (const mealDay of weeklyMealDays(alimentacao, startDate)) {
    byDate.get(mealDay.data).refeicoes = mealDay.refeicoes;
  }
  for (const day of days) {
    day.agua_ml = waterTotalForDay(
      alimentacao.filter((row) => row.data === day.data),
      hidratacao.filter((row) => row.data === day.data),
    );
  }
  for (const record of exercicios) {
    const day = byDate.get(record.data);
    if (day) day.exercicio_min += Math.round(parseNumber(record.duracao_min) ?? 0);
  }
  for (const record of sono) {
    const day = byDate.get(record.data);
    if (!day) continue;
    const total = parseSleepHours(record.duracao_minutos);
    if (total !== null) day.sono_horas = rounded((day.sono_horas ?? 0) + total);
    for (const [source, target] of [
      ["sono_profundo_min", "sono_profundo_horas"],
      ["sono_leve_min", "sono_leve_horas"],
      ["sono_rem_min", "sono_rem_horas"],
      ["acordado_min", "acordado_horas"],
    ]) {
      const value = parseSleepHours(record[source]);
      if (value !== null) day[target] = rounded((day[target] ?? 0) + value);
    }
    if (record.sono_niveis) {
      day.sono_niveis ??= {};
      for (const key of ["profundo", "leve", "rem", "acordado"]) {
        const level = record.sono_niveis[key];
        if (!["baixo", "normal", "alto"].includes(level)) continue;
        const previous = day.sono_niveis[key];
        day.sono_niveis[key] = previous && previous !== level ? "misto" : level;
      }
    }
  }
  for (const record of peso) {
    const day = byDate.get(record.data);
    const value = parseNumber(record.valor_kg);
    if (day && value !== null) day.peso_kg = value;
  }

  return {
    ok: true,
    periodo: { inicio: startDate, fim: endDate },
    dias: days,
    tendencias: {
      agua: metricTrend(days, "agua_ml", "A hidratação", "ml"),
      refeicoes: metricTrend(days, "refeicoes", "O número de refeições registradas", "por dia"),
      exercicio: metricTrend(days, "exercicio_min", "O tempo de exercício", "min"),
      sono: metricTrend(days, "sono_horas", "A duração do sono", "h"),
      peso: metricTrend(days, "peso_kg", "O peso", "kg", {
        positiveOnly: false,
        thresholdRatio: 0.003,
      }),
    },
  };
}

export async function dailySummary(connectors, requestedDate, ownerId) {
  const data = requestedDate || saoPauloNow().data;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new SupabaseRecordsError("invalid_date", "A data deve usar o formato AAAA-MM-DD.", 422);
  }

  const [alimentacao, hidratacao, exercicios, sono, peso] = await Promise.all([
    rowsForDate(
      connectors,
      ALIMENTACAO_TABLE,
      data,
      ownerId,
      "id,data,horario,item,quantidade,evento_tipo",
      "horario.asc,id.asc",
    ),
    rowsForDate(
      connectors,
      "hidratacao",
      data,
      ownerId,
      "data,horario,item,quantidade",
      "horario.asc,id.asc",
    ),
    rowsForDate(
      connectors,
      "exercicios",
      data,
      ownerId,
      "data,tipo,duracao_min,intensidade,calorias_estimadas",
      "id.asc",
    ),
    rowsForDate(connectors, "sono", data, ownerId, "data,inicio,fim,duracao_minutos", "id.asc"),
    rowsForDate(connectors, "peso", data, ownerId, "data,horario,valor_kg", "horario.asc,id.asc"),
  ]);

  return buildDailySummary(data, { alimentacao, hidratacao, exercicios, sono, peso });
}

export async function mealsForDay(connectors, requestedDate, ownerId) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ||
      !Number.isFinite(Date.parse(`${requestedDate}T12:00:00Z`)) ||
      new Date(`${requestedDate}T12:00:00Z`).toISOString().slice(0, 10) !== requestedDate) {
    throw new SupabaseRecordsError("invalid_date", "A data deve usar o formato AAAA-MM-DD.", 422);
  }
  const alimentacao = await rowsForDate(
    connectors,
    ALIMENTACAO_TABLE,
    requestedDate,
    requireOwnerId(ownerId),
    "id,data,horario,item,quantidade,evento_tipo",
    "horario.asc,id.asc",
  );
  return { data: requestedDate, refeicoes: formatMeals(alimentacao) };
}

function requireWaterHistoryDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) ||
      new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value ||
      value > saoPauloNow().data) {
    throw new SupabaseRecordsError("invalid_water_date", "Escolha uma data válida até hoje.", 422);
  }
  return value;
}

export async function waterHistoryForDay(connectors, requestedDate, ownerId) {
  const data = requireWaterHistoryDate(requestedDate);
  const id = requireOwnerId(ownerId);
  const [hydration, food] = await Promise.all([
    rowsForDate(connectors, "hidratacao", data, id,
      "data,horario,item,quantidade,import_key", "horario.asc,id.asc"),
    rowsForDate(connectors, ALIMENTACAO_TABLE, data, id,
      "data,horario,item,quantidade,evento_tipo", "horario.asc,id.asc"),
  ]);
  const totals = hydration.filter((row) => row.item === DAILY_WATER_TOTAL_LABEL);
  if (totals.length > 1) {
    throw new SupabaseRecordsError(
      "ambiguous_water_total", "Há mais de um total diário para esta data. Confira os registros.", 409,
    );
  }
  const total = totals[0];
  const doses = [
    ...hydration.filter((row) => row.item !== DAILY_WATER_TOTAL_LABEL),
    ...food.filter((row) => row.evento_tipo === "hidratacao" && row.item !== DAILY_WATER_TOTAL_LABEL),
  ].sort((a, b) => String(a.horario ?? "").localeCompare(String(b.horario ?? "")));
  return {
    data,
    total_declarado: total ? {
      import_key: total.import_key,
      horario: total.horario,
      quantidade: total.quantidade,
      quantidade_ml: parseWaterMl(total.quantidade),
    } : null,
    doses: doses.map((row) => ({
      horario: String(row.horario ?? ""),
      item: String(row.item ?? "Água"),
      quantidade: String(row.quantidade ?? "Quantidade não informada"),
    })),
  };
}

export async function correctSavedWaterTotal(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  const data = requireWaterHistoryDate(payload.data);
  const key = String(payload.import_key ?? "");
  const expected = String(payload.expected_quantity ?? "");
  const action = payload.action;
  const milliliters = payload.new_total_ml;
  if (!/^app:[0-9a-f-]{36}$/i.test(key) ||
      !/^[1-9]\d{0,4} ml$/.test(expected) ||
      !["update", "delete"].includes(action) ||
      (action === "update" && (!Number.isInteger(milliliters) || milliliters < 1 || milliliters > 15000)) ||
      (action === "delete" && milliliters !== null)) {
    throw new SupabaseRecordsError("invalid_water_correction", "Confira o total de água selecionado.", 422);
  }
  const response = await supabaseRequest(connectors, "/rest/v1/rpc/correct_daily_water_total", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_owner_id: ownerId,
      p_data: data,
      p_import_key: key,
      p_expected_quantity: expected,
      p_action: action,
      p_new_total_ml: milliliters,
    }),
  });
  const result = await response.json();
  if (result?.ok !== true) {
    throw new SupabaseRecordsError(
      "water_total_changed", "O total diário mudou ou não existe mais. Atualize o histórico.", 409,
    );
  }
  return { ok: true };
}

async function getContextRow(connectors, ownerId) {
  const id = requireOwnerId(ownerId);
  const params = new URLSearchParams({
    select: "owner_id,clinical_profile,gem_instructions,updated_at",
    owner_id: `eq.${id}`,
    limit: "1",
  });
  const response = await supabaseRequest(
    connectors,
    `/rest/v1/health_contexts?${params.toString()}`,
  );
  return (await response.json())[0] ?? null;
}

async function recentOwnerRows(connectors, table, ownerId, select, order, limit = 5) {
  const params = new URLSearchParams({
    select,
    owner_id: `eq.${requireOwnerId(ownerId)}`,
    order,
    limit: String(limit),
  });
  const response = await supabaseRequest(connectors, `/rest/v1/${table}?${params.toString()}`);
  return response.json();
}

async function contextForAnalysis(connectors, ownerId) {
  const id = requireOwnerId(ownerId);
  const [profile, exams, weight, sleep, exercise, food, hydration, dailySummary] = await Promise.all([
    getContextRow(connectors, id),
    recentOwnerRows(
      connectors,
      "health_exams",
      id,
      "id,exam_type,exam_date,summary,extracted_data,uncertainties,status,reviewed_at",
      "exam_date.desc.nullslast,created_at.desc",
      10,
    ),
    recentOwnerRows(connectors, "peso", id, "data,horario,valor_kg", "data.desc,horario.desc", 5),
    recentOwnerRows(
      connectors,
      "sono",
      id,
      "data,inicio,fim,duracao_minutos,sono_profundo_min,sono_leve_min,sono_rem_min,acordado_min",
      "data.desc",
      5,
    ),
    recentOwnerRows(
      connectors,
      "exercicios",
      id,
      "data,tipo,duracao_min,intensidade,calorias_estimadas",
      "data.desc",
      5,
    ),
    recentOwnerRows(
      connectors,
      "alimentacao",
      id,
      "data,horario,item,quantidade",
      "data.desc,horario.desc",
      10,
    ),
    recentOwnerRows(
      connectors,
      "hidratacao",
      id,
      "data,horario,item,quantidade",
      "data.desc,horario.desc",
      10,
    ),
    dailyAnalysisSummary(connectors, id),
  ]);
  const todayRecords = await currentDayAnalysisRecords(connectors, id, dailySummary.para_dia);

  return {
    ok: true,
    profile,
    confirmed_exams: exams.filter(
      (exam) => exam.status === undefined || exam.status === "confirmed",
    ),
    recent: { weight, sleep, exercise, food, hydration },
    daily_summary: dailySummary,
    today_records: todayRecords,
    local_now: saoPauloNow(),
  };
}

export async function upsertHealthContext(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  const response = await supabaseRequest(
    connectors,
    "/rest/v1/health_contexts?on_conflict=owner_id",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        owner_id: ownerId,
        clinical_profile: String(payload.clinical_profile ?? ""),
        gem_instructions: String(payload.gem_instructions ?? ""),
        updated_at: new Date().toISOString(),
      }),
    },
  );
  return { ok: true, profile: (await response.json())[0] ?? null };
}

export async function createHealthExam(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  const response = await supabaseRequest(connectors, "/rest/v1/health_exams", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      owner_id: ownerId,
      file_name: String(payload.file_name ?? "exame"),
      mime_type: String(payload.mime_type ?? "application/octet-stream"),
      exam_type: String(payload.exam_type ?? "outro"),
      exam_date: normalizeNullable(payload.exam_date),
      summary: String(payload.summary ?? ""),
      extracted_data: payload.extracted_data ?? {},
      uncertainties: Array.isArray(payload.uncertainties) ? payload.uncertainties : [],
      status: "pending",
    }),
  });
  return { ok: true, exam: (await response.json())[0] ?? null };
}

async function listHealthExams(connectors, ownerId) {
  const id = requireOwnerId(ownerId);
  const params = new URLSearchParams({
    select:
      "id,file_name,mime_type,exam_type,exam_date,summary,extracted_data,uncertainties,status,created_at,reviewed_at",
    owner_id: `eq.${id}`,
    order: "created_at.desc",
    limit: "30",
  });
  const response = await supabaseRequest(connectors, `/rest/v1/health_exams?${params.toString()}`);
  return { ok: true, exams: await response.json() };
}

export async function reviewHealthExam(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  const examId = String(payload.exam_id ?? "");
  const status = payload.status === "confirmed" ? "confirmed" : "discarded";
  if (!/^[0-9a-f-]{36}$/i.test(examId)) {
    throw new SupabaseRecordsError("invalid_exam", "O exame informado não é válido.", 422);
  }

  const patch = {
    status,
    reviewed_at: new Date().toISOString(),
  };
  if (status === "confirmed") {
    patch.exam_type = String(payload.exam_type ?? "outro");
    patch.exam_date = normalizeNullable(payload.exam_date);
    patch.summary = String(payload.summary ?? "");
    patch.extracted_data = payload.extracted_data ?? {};
    patch.uncertainties = Array.isArray(payload.uncertainties) ? payload.uncertainties : [];
  }

  const params = new URLSearchParams({
    id: `eq.${examId}`,
    owner_id: `eq.${ownerId}`,
    status: "eq.pending",
  });
  const response = await supabaseRequest(connectors, `/rest/v1/health_exams?${params.toString()}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  const exam = (await response.json())[0];
  if (!exam) {
    throw new SupabaseRecordsError(
      "exam_not_pending",
      "Este exame não existe, não pertence à conta ou já foi revisado.",
      409,
    );
  }
  return { ok: true, exam };
}

async function listChatMessages(connectors, ownerId) {
  const today = saoPauloNow().data;
  const params = new URLSearchParams({
    select: "client_id,role,kind,payload,sequence,created_at",
    owner_id: `eq.${requireOwnerId(ownerId)}`,
    created_at: `gte.${today}T00:00:00-03:00`,
    order: "sequence.asc,created_at.asc",
    limit: "100",
  });
  const response = await supabaseRequest(
    connectors,
    `/rest/v1/health_chat_messages?${params.toString()}`,
  );
  return { ok: true, messages: await response.json() };
}

export async function savedAnalysesForDay(connectors, requestedDate, ownerId) {
  if (typeof requestedDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ||
      !Number.isFinite(Date.parse(`${requestedDate}T12:00:00Z`)) ||
      new Date(`${requestedDate}T12:00:00Z`).toISOString().slice(0, 10) !== requestedDate ||
      requestedDate > saoPauloNow().data) {
    throw new SupabaseRecordsError("invalid_date", "Escolha uma data válida até hoje.", 422);
  }
  const params = new URLSearchParams({
    select: "client_id,created_at,payload",
    owner_id: `eq.${requireOwnerId(ownerId)}`,
    role: "eq.assistant",
    kind: "eq.validation",
    created_at: `gte.${requestedDate}T00:00:00-03:00`,
    "payload->>status": "eq.saved",
    "payload->analysis->>status": "eq.ready",
    order: "created_at.asc",
    limit: "100",
  });
  params.append("created_at", `lt.${shiftDate(requestedDate, 1)}T00:00:00-03:00`);
  const response = await supabaseRequest(connectors, `/rest/v1/health_chat_messages?${params}`);
  const rows = await response.json();
  const start = Date.parse(`${requestedDate}T00:00:00-03:00`);
  const end = Date.parse(`${shiftDate(requestedDate, 1)}T00:00:00-03:00`);
  return {
    data: requestedDate,
    analises: rows.flatMap((row) => {
      const text = row.payload?.analysis?.text;
      const timestamp = Date.parse(row.created_at);
      if (row.payload?.status !== "saved" || row.payload?.analysis?.status !== "ready" ||
          typeof text !== "string" || !text.trim() ||
          !Number.isFinite(timestamp) || timestamp < start || timestamp >= end) return [];
      return [{
        id: String(row.client_id),
        created_at: row.created_at,
        texto: text.trim().slice(0, 1600),
      }];
    }),
  };
}

async function saveChatMessages(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  const messages = Array.isArray(payload.messages) ? payload.messages.slice(-100) : [];
  if (messages.length === 0) return { ok: true, saved: 0 };

  const rows = messages
    .filter(
      (message) =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        ["text", "image", "validation"].includes(message.kind),
    )
    .map((message, index) => ({
      owner_id: ownerId,
      client_id: String(message.client_id ?? "").slice(0, 100),
      role: message.role,
      kind: message.kind,
      payload: message.payload && typeof message.payload === "object" ? message.payload : {},
      sequence: Number.isInteger(message.sequence) ? message.sequence : index,
    }))
    .filter((message) => message.client_id);

  if (rows.length === 0) return { ok: true, saved: 0 };
  await supabaseRequest(
    connectors,
    "/rest/v1/health_chat_messages?on_conflict=owner_id,client_id",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
  );
  return { ok: true, saved: rows.length };
}

function photoKey() {
  if (!process.env.SESSION_SECRET) {
    throw new SupabaseRecordsError("app_secret_missing", "A proteção das fotos não está configurada.", 503);
  }
  return createHash("sha256")
    .update("health-photo-jobs:v1:")
    .update(process.env.SESSION_SECRET)
    .digest();
}

function encryptPhotoInput(input) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", photoKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(input), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

function decryptPhotoInput(encoded) {
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length < 29) throw new Error("Encrypted photo is truncated");
  const decipher = createDecipheriv("aes-256-gcm", photoKey(), buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8"));
}

export async function enqueuePhoto(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  const params = new URLSearchParams({
    select: "id",
    owner_id: `eq.${ownerId}`,
    status: "in.(pending,processing)",
    limit: "3",
  });
  const existing = await supabaseRequest(connectors, `/rest/v1/health_photo_jobs?${params}`);
  if ((await existing.json()).length >= 3) {
    throw new SupabaseRecordsError("too_many_photo_jobs", "Aguarde a conclusão das fotos pendentes.", 429);
  }
  const input = payload.input;
  if (!input || typeof input !== "object") {
    throw new SupabaseRecordsError("invalid_photo", "Foto inválida para análise posterior.", 422);
  }
  const encrypted = encryptPhotoInput(input);
  const response = await supabaseRequest(connectors, "/rest/v1/health_photo_jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ owner_id: ownerId, encrypted_input: encrypted }),
  });
  const job = (await response.json())[0];
  return { ok: true, job_id: job.id, status: job.status };
}

async function listPhotoJobs(connectors, ownerId) {
  const params = new URLSearchParams({
    select: "id,status,result,attempts,created_at",
    owner_id: `eq.${requireOwnerId(ownerId)}`,
    status: "in.(pending,processing,ready,failed)",
    order: "created_at.desc",
    limit: "30",
  });
  const response = await supabaseRequest(connectors, `/rest/v1/health_photo_jobs?${params}`);
  return { ok: true, jobs: await response.json() };
}

export async function claimPhoto(connectors) {
  const response = await supabaseRequest(connectors, "/rest/v1/rpc/claim_health_photo_job", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const job = (await response.json())[0];
  if (!job) return { ok: true, job: null };
  try {
    return {
      ok: true,
      job: {
        id: job.id,
        owner_id: job.owner_id,
        attempts: job.attempts,
        input: decryptPhotoInput(job.encrypted_input),
      },
    };
  } catch {
    // A corrupted or undecryptable photo cannot be retried safely.
    await finishPhoto(connectors, { id: job.id, attempts: job.attempts, status: "failed" });
    return { ok: true, job: null };
  }
}

export async function finishPhoto(connectors, payload) {
  const id = String(payload.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new SupabaseRecordsError("invalid_photo_job", "Tarefa inválida.", 422);
  const attempts = Number(payload.attempts);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 8) {
    throw new SupabaseRecordsError("invalid_photo_job", "Tentativa inválida.", 422);
  }
  const status = ["ready", "pending", "failed"].includes(payload.status) ? payload.status : "failed";
  const schedule = [1, 5, 15, 60, 180, 360, 720, 1440];
  const next = new Date(Date.now() + schedule[attempts - 1] * 60_000).toISOString();
  const patch = {
    status: status === "pending" && attempts >= 8 ? "failed" : status,
    next_attempt_at: next,
    claimed_at: null,
    updated_at: new Date().toISOString(),
    ...(status === "ready" ? { result: payload.result, encrypted_input: null } : {}),
    ...(status === "failed" || (status === "pending" && attempts >= 8)
      ? { encrypted_input: null } : {}),
  };
  const params = new URLSearchParams({
    id: `eq.${id}`, status: "eq.processing", attempts: `eq.${attempts}`, select: "id",
  });
  const response = await supabaseRequest(connectors, `/rest/v1/health_photo_jobs?${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  return { ok: true, updated: (await response.json()).length === 1 };
}

async function reviewPhoto(connectors, payload) {
  const params = new URLSearchParams({
    id: `eq.${String(payload.id ?? "")}`,
    owner_id: `eq.${requireOwnerId(payload.owner_id)}`,
    status: "eq.ready",
    select: "id",
  });
  const response = await supabaseRequest(connectors, `/rest/v1/health_photo_jobs?${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ status: "reviewed", result: null, updated_at: new Date().toISOString() }),
  });
  return { ok: true, updated: (await response.json()).length === 1 };
}

export async function cancelPhoto(connectors, payload) {
  const id = String(payload.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new SupabaseRecordsError("invalid_photo_job", "Tarefa inválida.", 422);
  }
  const params = new URLSearchParams({
    id: `eq.${id}`,
    owner_id: `eq.${requireOwnerId(payload.owner_id)}`,
    status: "in.(pending,processing)",
    select: "id",
  });
  const response = await supabaseRequest(connectors, `/rest/v1/health_photo_jobs?${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      status: "reviewed", encrypted_input: null, result: null, updated_at: new Date().toISOString(),
    }),
  });
  return { ok: true, updated: (await response.json()).length === 1 };
}

async function userByEmail(connectors, email) {
  const params = new URLSearchParams({
    select: "id,email,password_hash,created_at",
    email: `eq.${String(email ?? "")
      .trim()
      .toLowerCase()}`,
    limit: "1",
  });
  const response = await supabaseRequest(connectors, `/rest/v1/health_users?${params.toString()}`);
  const users = await response.json();
  return { ok: true, user: users[0] ?? null };
}

async function userById(connectors, id) {
  const params = new URLSearchParams({
    select: "id,email,created_at",
    id: `eq.${id}`,
    limit: "1",
  });
  const response = await supabaseRequest(connectors, `/rest/v1/health_users?${params.toString()}`);
  const users = await response.json();
  return users[0] ?? null;
}

async function createUser(connectors, payload) {
  const response = await supabaseRequest(connectors, "/rest/v1/health_users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      email: String(payload.email ?? "")
        .trim()
        .toLowerCase(),
      password_hash: payload.password_hash,
    }),
  });
  const users = await response.json();
  return { ok: true, user: users[0] ?? null };
}

async function activateUser(connectors, payload) {
  const params = new URLSearchParams({
    id: `eq.${payload.user_id}`,
    password_hash: `eq.${payload.expected_password_hash}`,
    select: "id,email,created_at",
  });
  const response = await supabaseRequest(connectors, `/rest/v1/health_users?${params.toString()}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ password_hash: payload.password_hash }),
  });
  const users = await response.json();
  if (!users[0]) {
    throw new SupabaseRecordsError("user_exists", "Esta conta principal já foi ativada.", 409);
  }
  return { ok: true, user: users[0] };
}

async function createSession(connectors, payload) {
  await supabaseRequest(connectors, "/rest/v1/health_sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      token_hash: payload.token_hash,
      user_id: payload.user_id,
      expires_at: payload.expires_at,
    }),
  });
  return { ok: true };
}

function verifyPassword(password, encoded) {
  try {
    const [algorithm, nValue, rValue, pValue, saltHex, digestHex] = String(encoded).split("$");
    if (algorithm !== "scrypt") return false;
    const expected = Buffer.from(digestHex, "hex");
    const derived = scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length, {
      N: Number(nValue),
      r: Number(rValue),
      p: Number(pValue),
    });
    return expected.length > 0 && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

async function authenticateAndCreateSession(connectors, payload) {
  const result = await userByEmail(connectors, payload.email);
  const user = result.user;
  if (
    !user?.id ||
    typeof user.password_hash !== "string" ||
    !verifyPassword(payload.password, user.password_hash)
  ) {
    return { ok: true, authenticated: false };
  }
  await createSession(connectors, {
    user_id: user.id,
    token_hash: payload.token_hash,
    expires_at: payload.expires_at,
  });
  return {
    ok: true,
    authenticated: true,
    user: { id: user.id, email: user.email },
  };
}

async function sessionUser(connectors, tokenHash) {
  const params = new URLSearchParams({
    select: "user_id",
    token_hash: `eq.${tokenHash}`,
    revoked_at: "is.null",
    expires_at: `gt.${new Date().toISOString()}`,
    limit: "1",
  });
  const response = await supabaseRequest(
    connectors,
    `/rest/v1/health_sessions?${params.toString()}`,
  );
  const sessions = await response.json();
  if (!sessions[0]?.user_id) return { ok: true, user: null };
  return { ok: true, user: await userById(connectors, sessions[0].user_id) };
}

async function revokeSession(connectors, tokenHash) {
  const params = new URLSearchParams({
    token_hash: `eq.${tokenHash}`,
    revoked_at: "is.null",
  });
  await supabaseRequest(connectors, `/rest/v1/health_sessions?${params.toString()}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  return { ok: true };
}

async function claimOwner(connectors, ownerId) {
  const id = requireOwnerId(ownerId);
  const claimed = {};
  await Promise.all(
    HEALTH_TABLES.map(async (table) => {
      const response = await supabaseRequest(
        connectors,
        `/rest/v1/${table}?owner_id=is.null&select=id`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({ owner_id: id }),
        },
      );
      claimed[table] = (await response.json()).length;
    }),
  );
  return { ok: true, claimed };
}

async function main() {
  const connectors = new ReplitConnectors();
  const action = process.argv[2];

  if (action === "save") return saveRecords(connectors);
  if (action === "analysis-context") return savedSevenDayAnalysisContext(connectors, await readJsonInput());
  if (action === "daily-analysis-summary") {
    const payload = await readJsonInput();
    return dailyAnalysisSummary(connectors, payload.owner_id);
  }
  if (action === "change-meal") return changeMealRecord(connectors, await readJsonInput());
  if (action === "weight-history") return weightHistory(connectors, await readJsonInput());
  if (action === "delete-meal") return changeMealRecord(connectors, await readJsonInput(), true);
  if (action === "replace-meal") return replaceMealRecords(connectors, await readJsonInput());
  if (action === "meal-correction-statuses") return mealCorrectionStatuses(connectors, await readJsonInput());
  if (action === "change-meal-time") return changeMealTime(connectors, await readJsonInput());
  if (action === "dated-records" || action === "change-record-dates") {
    const dates = await import("./record_dates.mjs");
    const payload = await readJsonInput();
    return action === "dated-records"
      ? dates.datedRecords(connectors, payload)
      : dates.changeRecordDates(connectors, payload);
  }
  if (action === "sleep-day-status") {
    const payload = await readJsonInput();
    const response = await supabaseRequest(connectors, "/rest/v1/rpc/sleep_day_status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_owner_id: requireOwnerId(payload.owner_id), p_date: payload.data }),
    });
    return response.json();
  }
  if (action === "list-sleep-reviews") {
    const payload = await readJsonInput();
    return listSleepReviews(connectors, payload.owner_id);
  }
  if (action === "list-sleep-records") {
    const payload = await readJsonInput();
    return listSleepRecords(connectors, payload.owner_id);
  }
  if (action === "update-sleep-record") {
    return updateSleepRecord(connectors, await readJsonInput());
  }
  if (action === "consolidate-sleep") {
    return consolidateSleepRecords(connectors, await readJsonInput());
  }
  if (action === "summary") {
    const payload = await readJsonInput();
    return dailySummary(connectors, process.argv[3], requireOwnerId(payload.owner_id));
  }
  if (action === "meals-for-day") {
    const payload = await readJsonInput();
    return mealsForDay(connectors, process.argv[3], payload.owner_id);
  }
  if (action === "water-history") {
    const payload = await readJsonInput();
    return waterHistoryForDay(connectors, process.argv[3], payload.owner_id);
  }
  if (action === "correct-water-total") {
    return correctSavedWaterTotal(connectors, await readJsonInput());
  }
  if (action === "weekly-summary") {
    const payload = await readJsonInput();
    return weeklySummary(connectors, payload.end_date, payload.owner_id);
  }
  if (action === "weekly-meals") {
    const payload = await readJsonInput();
    return weeklyMeals(connectors, payload.end_date, payload.owner_id);
  }
  if (action === "context") {
    const payload = await readJsonInput();
    return contextForAnalysis(connectors, payload.owner_id);
  }
  if (action === "upsert-context") {
    return upsertHealthContext(connectors, await readJsonInput());
  }
  if (action === "create-exam") {
    return createHealthExam(connectors, await readJsonInput());
  }
  if (action === "list-exams") {
    const payload = await readJsonInput();
    return listHealthExams(connectors, payload.owner_id);
  }
  if (action === "review-exam") {
    return reviewHealthExam(connectors, await readJsonInput());
  }
  if (action === "list-chat") {
    const payload = await readJsonInput();
    return listChatMessages(connectors, payload.owner_id);
  }
  if (action === "saved-analyses") {
    const payload = await readJsonInput();
    return savedAnalysesForDay(connectors, process.argv[3], payload.owner_id);
  }
  if (action === "day-analysis-context") {
    return dayAnalysisContext(connectors, await readJsonInput());
  }
  if (action === "period-analysis-context") {
    const { periodAnalysisContext } = await import("./period_analysis_context.mjs");
    return periodAnalysisContext(connectors, await readJsonInput());
  }
  if (action === "save-chat") {
    return saveChatMessages(connectors, await readJsonInput());
  }
  if (action === "enqueue-photo") return enqueuePhoto(connectors, await readJsonInput());
  if (action === "list-photos") {
    const payload = await readJsonInput();
    return listPhotoJobs(connectors, payload.owner_id);
  }
  if (action === "claim-photo") return claimPhoto(connectors);
  if (action === "finish-photo") return finishPhoto(connectors, await readJsonInput());
  if (action === "review-photo") return reviewPhoto(connectors, await readJsonInput());
  if (action === "cancel-photo") return cancelPhoto(connectors, await readJsonInput());
  if (action === "user-by-email") {
    const payload = await readJsonInput();
    return userByEmail(connectors, payload.email);
  }
  if (action === "create-user") return createUser(connectors, await readJsonInput());
  if (action === "activate-user") return activateUser(connectors, await readJsonInput());
  if (action === "create-session") return createSession(connectors, await readJsonInput());
  if (action === "authenticate-and-create-session") {
    return authenticateAndCreateSession(connectors, await readJsonInput());
  }
  if (action === "session-user") {
    const payload = await readJsonInput();
    return sessionUser(connectors, payload.token_hash);
  }
  if (action === "revoke-session") {
    const payload = await readJsonInput();
    return revokeSession(connectors, payload.token_hash);
  }
  if (action === "claim-owner") {
    const payload = await readJsonInput();
    return claimOwner(connectors, payload.owner_id);
  }

  throw new SupabaseRecordsError("unknown_action", "Ação do Supabase não reconhecida.", 400);
}

if (import.meta.main) {
  try {
    process.stdout.write(JSON.stringify(await main()));
  } catch (error) {
    const code = error instanceof SupabaseRecordsError ? error.code : "unexpected_error";
    const message =
      error instanceof Error ? error.message : "Falha inesperada ao acessar o Supabase.";
    const status = error instanceof SupabaseRecordsError ? error.status : 502;

    const retry_after_ms = error instanceof SupabaseRecordsError ? error.retryAfterMs : null;
    // Other Promise.all reads may still be sleeping in the shared cooldown.
    // Flush the structured error, then stop them instead of timing out in Python.
    process.stdout.write(
      JSON.stringify({ ok: false, error: { code, message, status, retry_after_ms } }),
      () => process.exit(1),
    );
  }
}
