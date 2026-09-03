import { randomUUID } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";

const CONNECTOR_NAME = "supabase";
const ALIMENTACAO_TABLE = "alimentacao";
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
let nextSupabaseRequestAt = 0;

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
  const appSecret = process.env.SESSION_SECRET;
  if (!appSecret) {
    throw new SupabaseRecordsError(
      "app_secret_missing",
      "A credencial interna de acesso aos dados não está configurada.",
      503,
    );
  }
  const method = String(init.method ?? "GET").toUpperCase();
  const safeToRetry = method === "GET" || method === "HEAD";
  const maxAttempts = safeToRetry ? 3 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const now = Date.now();
    const waitMs = Math.max(0, nextSupabaseRequestAt - now);
    nextSupabaseRequestAt = Math.max(nextSupabaseRequestAt, now) + SUPABASE_REQUEST_SPACING_MS;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

    const response = await connectors.proxy(CONNECTOR_NAME, path, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        "X-Health-App-Secret": appSecret,
      },
    });
    if (response.ok) return response;

    if (safeToRetry && [429, 503].includes(response.status) && attempt < maxAttempts - 1) {
      const retryAfter = Number(response.headers?.get?.("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 250;
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 3000)));
      continue;
    }

    const detail = (await response.text()).slice(0, 500);
    throw new SupabaseRecordsError(
      "supabase_error",
      `Supabase respondeu ${response.status}: ${detail}`,
      response.status,
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

function requireOwnerId(value) {
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
    return {
      table: "exercicios",
      record: {
        owner_id: ownerId,
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
      return items.map((item) => normalizeEventRecord(item, eventType, now, ownerId));
    });
  }

  const eventType = EVENT_TYPES.has(payload.evento_tipo) ? payload.evento_tipo : "outro";
  return (payload.itens ?? [])
    .filter((item) => item.confirmado !== false)
    .map((item) => normalizeEventRecord(item, eventType, now, ownerId));
}

function groupEntriesByTable(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const group = groups.get(entry.table) ?? [];
    group.push(entry);
    groups.set(entry.table, group);
  }
  return groups;
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

  const groups = groupEntriesByTable(entries);
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

async function saveRecords(connectors) {
  return saveRecordsPayload(connectors, await readJsonInput());
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
      "data,horario,quantidade",
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
      "data,duracao_minutos,sono_profundo_min,sono_leve_min,sono_rem_min,acordado_min",
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
  const meals = new Map();

  for (const record of alimentacao) {
    const day = byDate.get(record.data);
    if (!day) continue;
    if (record.evento_tipo === "hidratacao") {
      day.agua_ml += parseWaterMl(record.quantidade);
    } else if (record.evento_tipo === "alimentacao" || !record.evento_tipo) {
      const key = `${record.data}|${record.horario ?? ""}`;
      meals.set(key, record.data);
    }
  }
  for (const data of meals.values()) {
    const day = byDate.get(data);
    if (day) day.refeicoes += 1;
  }
  for (const record of hidratacao) {
    const day = byDate.get(record.data);
    if (day) day.agua_ml += parseWaterMl(record.quantidade);
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

async function dailySummary(connectors, requestedDate, ownerId) {
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
      "data,horario,item,quantidade,evento_tipo",
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
  const [profile, exams, weight, sleep, exercise, food, hydration] = await Promise.all([
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
  ]);

  return {
    ok: true,
    profile,
    confirmed_exams: exams.filter(
      (exam) => exam.status === undefined || exam.status === "confirmed",
    ),
    recent: { weight, sleep, exercise, food, hydration },
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
  const params = new URLSearchParams({
    select: "client_id,role,kind,payload,sequence,created_at",
    owner_id: `eq.${requireOwnerId(ownerId)}`,
    order: "sequence.asc,created_at.asc",
    limit: "100",
  });
  const response = await supabaseRequest(
    connectors,
    `/rest/v1/health_chat_messages?${params.toString()}`,
  );
  return { ok: true, messages: await response.json() };
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
  if (action === "list-sleep-reviews") {
    const payload = await readJsonInput();
    return listSleepReviews(connectors, payload.owner_id);
  }
  if (action === "consolidate-sleep") {
    return consolidateSleepRecords(connectors, await readJsonInput());
  }
  if (action === "summary") {
    const payload = await readJsonInput();
    return dailySummary(connectors, process.argv[3], requireOwnerId(payload.owner_id));
  }
  if (action === "weekly-summary") {
    const payload = await readJsonInput();
    return weeklySummary(connectors, payload.end_date, payload.owner_id);
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
  if (action === "save-chat") {
    return saveChatMessages(connectors, await readJsonInput());
  }
  if (action === "user-by-email") {
    const payload = await readJsonInput();
    return userByEmail(connectors, payload.email);
  }
  if (action === "create-user") return createUser(connectors, await readJsonInput());
  if (action === "activate-user") return activateUser(connectors, await readJsonInput());
  if (action === "create-session") return createSession(connectors, await readJsonInput());
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

    process.stdout.write(JSON.stringify({ ok: false, error: { code, message, status } }));
    process.exitCode = 1;
  }
}
