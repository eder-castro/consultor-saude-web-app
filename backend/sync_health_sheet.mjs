import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";

const DRIVE_CONNECTOR = "google-drive";
const SUPABASE_CONNECTOR = "supabase";
const FOLDER_NAME = "Gemini Gems";
const SPREADSHEET_NAME = "DadosSaude";
const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const BATCH_SIZE = 200;
const TIME_HEADERS = new Set(["horario", "inicio", "fim", "hora"]);
const SHEET_SCHEMAS = {
  alimentacao: {
    headers: ["data", "horario", "item", "quantidade", "midia_id", "json_filename"],
    required: ["data", "horario", "item"],
  },
  hidratacao: {
    headers: ["data", "horario", "item", "quantidade", "midia_id", "json_filename"],
    required: ["data", "horario", "item"],
  },
  exercicios: {
    headers: [
      "data",
      "tipo",
      "duracao_min",
      "intensidade",
      "calorias_estimadas",
      "midia_id",
      "json_filename",
    ],
    required: ["data", "tipo"],
  },
  sono: {
    headers: [
      "data",
      "inicio",
      "fim",
      "duracao_minutos",
      "sono_profundo_min",
      "sono_leve_min",
      "sono_rem_min",
      "acordado_min",
      "midia_id",
      "json_filename",
    ],
    required: ["data"],
  },
  peso: {
    headers: ["data", "horario", "valor_kg", "json_filename"],
    required: ["data", "valor_kg"],
  },
  midias: {
    headers: [
      "data",
      "tipo_evento",
      "origem",
      "descricao",
      "url_imagem",
      "midia_id",
      "json_filename",
    ],
    required: ["data"],
  },
  analise: {
    headers: [
      "data",
      "evento_tipo",
      "evento_referencia",
      "resumo",
      "pontos_positivos",
      "pontos_atencao",
      "sugestoes",
      "json_filename",
    ],
    required: ["data"],
  },
  log_json: {
    headers: ["data", "hora", "nome_arquivo", "drive_file_id"],
    required: ["data", "nome_arquivo"],
  },
};

class HealthSheetSyncError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function escapeDriveQueryValue(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

async function connectorRequest(connectors, connectorName, path, init = {}) {
  const response = await connectors.proxy(connectorName, path, init);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new HealthSheetSyncError(
      `${connectorName}_error`,
      `${connectorName} respondeu ${response.status}: ${detail}`,
      response.status,
    );
  }
  return response;
}

async function listDriveFiles(connectors, query) {
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,mimeType,modifiedTime,parents,webViewLink)",
    pageSize: "100",
    orderBy: "modifiedTime desc",
  });
  const response = await connectorRequest(
    connectors,
    DRIVE_CONNECTOR,
    `/drive/v3/files?${params.toString()}`,
  );
  return (await response.json()).files ?? [];
}

async function findSpreadsheet(connectors) {
  const folders = await listDriveFiles(
    connectors,
    `name = '${escapeDriveQueryValue(FOLDER_NAME)}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
  );
  const matches = [];

  for (const folder of folders) {
    const files = await listDriveFiles(
      connectors,
      `'${escapeDriveQueryValue(folder.id)}' in parents and name = '${escapeDriveQueryValue(SPREADSHEET_NAME)}' and mimeType = '${SPREADSHEET_MIME_TYPE}' and trashed = false`,
    );
    matches.push(...files);
  }

  if (matches.length === 0) {
    throw new HealthSheetSyncError(
      "spreadsheet_not_found",
      `A planilha "${SPREADSHEET_NAME}" não foi encontrada em "${FOLDER_NAME}".`,
      404,
    );
  }
  if (matches.length > 1) {
    throw new HealthSheetSyncError(
      "multiple_spreadsheets",
      `Foram encontradas ${matches.length} planilhas chamadas "${SPREADSHEET_NAME}".`,
      409,
    );
  }
  return matches[0];
}

function unzipXlsx(bytes) {
  const files = new Map();
  let directoryEnd = -1;

  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) {
      directoryEnd = index;
      break;
    }
  }
  if (directoryEnd < 0) {
    throw new HealthSheetSyncError("invalid_xlsx", "O diretório ZIP do XLSX não foi encontrado.");
  }

  let offset = bytes.readUInt32LE(directoryEnd + 16);
  const end = offset + bytes.readUInt32LE(directoryEnd + 12);

  while (offset < end && bytes.readUInt32LE(offset) === 0x02014b50) {
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const content = method === 8 ? inflateRawSync(compressed) : compressed;
    files.set(name, content.toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function columnIndex(reference) {
  let index = 0;
  for (const character of reference) {
    index = index * 26 + character.charCodeAt(0) - 64;
  }
  return index - 1;
}

function worksheetRows(xml, sharedStrings) {
  const rows = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];

    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const reference = attributes.match(/\br="([A-Z]+)\d+"/)?.[1];
      if (!reference) continue;

      const type = attributes.match(/\bt="([^"]+)"/)?.[1];
      const valueMatch = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/);
      const inlineValues = [...cellMatch[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)];
      let value = valueMatch ? decodeXml(valueMatch[1]) : "";

      if (type === "s") value = sharedStrings[Number(value)] ?? "";
      if (type === "inlineStr") {
        value = inlineValues.map((match) => decodeXml(match[1])).join("");
      }
      row[columnIndex(reference)] = value;
    }

    rows.push(row);
  }

  return rows;
}

function parseWorkbook(bytes) {
  const files = unzipXlsx(bytes);
  const workbook = files.get("xl/workbook.xml") ?? "";
  const relationships = files.get("xl/_rels/workbook.xml.rels") ?? "";
  const sharedStringsXml = files.get("xl/sharedStrings.xml") ?? "";
  const sharedStrings = [...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXml(textMatch[1]))
      .join(""),
  );
  const relationshipMap = new Map(
    [...relationships.matchAll(/<Relationship\b([^>]*)\/>/g)].map((match) => {
      const id = match[1].match(/\bId="([^"]+)"/)?.[1];
      const target = match[1].match(/\bTarget="([^"]+)"/)?.[1];
      return [id, target];
    }),
  );
  const sheets = new Map();

  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = decodeXml(match[1].match(/\bname="([^"]+)"/)?.[1] ?? "");
    const relationId = match[1].match(/\br:id="([^"]+)"/)?.[1];
    const target = relationshipMap.get(relationId);
    if (!name || !target) continue;

    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    sheets.set(name, worksheetRows(files.get(path) ?? "", sharedStrings));
  }

  return sheets;
}

function excelDate(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial)) return value;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function excelTime(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial)) return value;
  const totalMinutes = Math.round((serial - Math.floor(serial)) * 24 * 60) % (24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeCell(header, value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (header === "data" && /^\d+(?:\.\d+)?$/.test(text)) return excelDate(text);
  if (["horario", "inicio", "fim", "hora"].includes(header) && /^\d+(?:\.\d+)?$/.test(text)) {
    return excelTime(text);
  }
  return text;
}

function canonicalValue(header, value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (TIME_HEADERS.has(header)) {
    const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
    if (match) return `${match[1]}:${match[2]}:${match[3] ?? "00"}`;
  }
  return text;
}

function recordFingerprint(record, headers) {
  const canonical = headers.map((header) => canonicalValue(header, record[header]));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function stableImportKey(sourceFileId, sheetName, fingerprint, occurrence) {
  const sourceHash = createHash("sha256").update(`${sourceFileId}:${sheetName}`).digest("hex");
  return `dadossaude:content:v1:${sheetName}:${sourceHash}:${fingerprint}:${occurrence}`;
}

function normalizeRows(sheetName, rows, sourceFileId) {
  const schema = SHEET_SCHEMAS[sheetName];
  if (!schema) {
    throw new HealthSheetSyncError("unknown_sheet", `A aba "${sheetName}" não é reconhecida.`, 422);
  }

  const headers = schema.headers.map((_, index) => String(rows[0]?.[index] ?? "").trim());
  if (headers.join(",") !== schema.headers.join(",")) {
    throw new HealthSheetSyncError(
      "invalid_headers",
      `Cabeçalhos inesperados na aba "${sheetName}". Esperado: ${schema.headers.join(", ")}.`,
      422,
    );
  }

  const records = [];
  const invalidRows = [];

  rows.slice(1).forEach((row, index) => {
    const sourceRow = index + 2;
    if (!row.some((value) => String(value ?? "").trim() !== "")) return;

    const record = Object.fromEntries(
      schema.headers.map((header, column) => [header, normalizeCell(header, row[column])]),
    );
    const invalidFields = schema.required.filter((header) => !record[header]);
    if (record.data && !/^\d{4}-\d{2}-\d{2}$/.test(record.data)) invalidFields.push("data");

    if (invalidFields.length > 0) {
      invalidRows.push({
        sheet: sheetName,
        source_row: sourceRow,
        invalid_fields: [...new Set(invalidFields)],
      });
      return;
    }

    records.push({
      ...record,
      source_file_id: sourceFileId,
      ...(sheetName === "alimentacao" ? { evento_tipo: "alimentacao" } : {}),
    });
  });

  return { records, invalidRows };
}

async function getExistingRecords(connectors, table, sourceFileId, headers) {
  const records = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      select: ["import_key", ...headers].join(","),
      source_file_id: `eq.${sourceFileId}`,
      order: "id.asc",
      limit: "1000",
      offset: String(offset),
    });
    const response = await connectorRequest(
      connectors,
      SUPABASE_CONNECTOR,
      `/rest/v1/${table}?${params.toString()}`,
    );
    const page = await response.json();
    records.push(...page);
    if (page.length < 1000) break;
    offset += page.length;
  }

  return records;
}

async function upsertRecords(connectors, table, records) {
  let inserted = 0;
  let batches = 0;

  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const batch = records.slice(start, start + BATCH_SIZE);
    const response = await connectorRequest(
      connectors,
      SUPABASE_CONNECTOR,
      `/rest/v1/${table}?on_conflict=import_key`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify(batch),
      },
    );
    const created = await response.json();
    inserted += Array.isArray(created) ? created.length : batch.length;
    batches += 1;
  }

  return { inserted, batches };
}

async function syncTable(connectors, table, records, invalidRows, sourceFileId) {
  const schema = SHEET_SCHEMAS[table];
  const existingRecords = await getExistingRecords(connectors, table, sourceFileId, schema.headers);
  const availableFingerprints = new Map();
  existingRecords.forEach((record) => {
    const fingerprint = recordFingerprint(record, schema.headers);
    availableFingerprints.set(fingerprint, (availableFingerprints.get(fingerprint) ?? 0) + 1);
  });

  const occurrences = new Map();
  const newRecords = [];
  let ignoredRows = 0;
  for (const record of records) {
    const fingerprint = recordFingerprint(record, schema.headers);
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    const available = availableFingerprints.get(fingerprint) ?? 0;
    if (available > 0) {
      availableFingerprints.set(fingerprint, available - 1);
      ignoredRows += 1;
      continue;
    }
    newRecords.push({
      import_key: stableImportKey(sourceFileId, table, fingerprint, occurrence),
      ...record,
    });
  }

  let insertResult;
  try {
    insertResult = await upsertRecords(connectors, table, newRecords);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Falha desconhecida.";
    throw new HealthSheetSyncError(
      "partial_sync",
      `Aba "${table}" interrompida após as inserções anteriores. Tente novamente com segurança. ${detail}`,
      502,
    );
  }
  ignoredRows += newRecords.length - insertResult.inserted;
  return {
    table,
    total_rows: records.length + invalidRows.length,
    valid_rows: records.length,
    new_rows: insertResult.inserted,
    ignored_rows: ignoredRows,
    invalid_rows: invalidRows.length,
    invalid_details: invalidRows,
    batches: insertResult.batches,
  };
}

async function main() {
  const connectors = new ReplitConnectors();
  const spreadsheet = await findSpreadsheet(connectors);
  const action = process.argv[2] ?? "sync";

  if (action === "metadata") {
    return {
      ok: true,
      source: {
        id: spreadsheet.id,
        name: spreadsheet.name,
        mimeType: spreadsheet.mimeType,
        modifiedTime: spreadsheet.modifiedTime,
        webViewLink: spreadsheet.webViewLink,
      },
    };
  }

  if (action !== "sync") {
    throw new HealthSheetSyncError("unknown_action", "Ação de sincronização não reconhecida.", 400);
  }

  const response = await connectorRequest(
    connectors,
    DRIVE_CONNECTOR,
    `/drive/v3/files/${encodeURIComponent(spreadsheet.id)}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  );
  const sheets = parseWorkbook(Buffer.from(await response.arrayBuffer()));
  const tableResults = [];

  for (const table of Object.keys(SHEET_SCHEMAS)) {
    const rows = sheets.get(table);
    if (!rows) {
      throw new HealthSheetSyncError(
        "missing_sheet",
        `A aba obrigatória "${table}" não foi encontrada.`,
        422,
      );
    }

    const { records, invalidRows } = normalizeRows(table, rows, spreadsheet.id);
    tableResults.push(await syncTable(connectors, table, records, invalidRows, spreadsheet.id));
  }

  const totals = {
    total_rows: tableResults.reduce((total, table) => total + table.total_rows, 0),
    valid_rows: tableResults.reduce((total, table) => total + table.valid_rows, 0),
    new_rows: tableResults.reduce((total, table) => total + table.new_rows, 0),
    ignored_rows: tableResults.reduce((total, table) => total + table.ignored_rows, 0),
    invalid_rows: tableResults.reduce((total, table) => total + table.invalid_rows, 0),
  };

  return {
    ok: true,
    source: {
      id: spreadsheet.id,
      name: spreadsheet.name,
      modifiedTime: spreadsheet.modifiedTime,
    },
    ...totals,
    new: totals.new_rows,
    ignored: totals.ignored_rows,
    invalid: totals.invalid_rows,
    inserted: totals.new_rows,
    updated: totals.ignored_rows,
    invalid_details: tableResults.flatMap((table) => table.invalid_details),
    batches: tableResults.reduce((total, table) => total + table.batches, 0),
    tables: tableResults,
  };
}

export { SHEET_SCHEMAS, syncTable };

if (import.meta.main) {
  try {
    process.stdout.write(JSON.stringify(await main()));
  } catch (error) {
    const code = error instanceof HealthSheetSyncError ? error.code : "unexpected_error";
    const message =
      error instanceof Error ? error.message : "Falha inesperada ao sincronizar a planilha.";
    const status = error instanceof HealthSheetSyncError ? error.status : 502;
    process.stdout.write(JSON.stringify({ ok: false, error: { code, message, status } }));
    process.exitCode = 1;
  }
}
