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
  const response = await connectors.proxy(CONNECTOR_NAME, path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "X-Health-App-Secret": appSecret,
    },
  });
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
      return (group.itens ?? [])
        .filter((item) => item.confirmado !== false)
        .map((item) => normalizeEventRecord(item, eventType, now, ownerId));
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
  if (action === "summary") {
    const payload = await readJsonInput();
    return dailySummary(connectors, process.argv[3], requireOwnerId(payload.owner_id));
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
