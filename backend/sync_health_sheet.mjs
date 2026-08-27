import { ReplitConnectors } from "@replit/connectors-sdk";

const DRIVE_CONNECTOR = "google-drive";
const SUPABASE_CONNECTOR = "supabase";
const FOLDER_NAME = "Gemini Gems";
const SPREADSHEET_NAME = "DadosSaude";
const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const TABLE_NAME = "health_records";
const BATCH_SIZE = 200;

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

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    const next = csv[index + 1];

    if (quoted) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeRows(csv, sourceFileId) {
  const rows = parseCsv(csv);
  const headers = rows.shift() ?? [];
  const expectedHeaders = ["data", "horario", "item", "quantidade", "midia_id", "json_filename"];

  if (headers.join(",") !== expectedHeaders.join(",")) {
    throw new HealthSheetSyncError(
      "invalid_headers",
      `Cabeçalhos inesperados. Esperado: ${expectedHeaders.join(", ")}.`,
      422,
    );
  }

  const records = [];
  const invalidRows = [];

  rows.forEach((row, index) => {
    const sourceRow = index + 2;
    if (!row.some((value) => value.trim() !== "")) return;

    const invalidFields = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row[0] ?? "")) invalidFields.push("data");
    if (!(row[1] ?? "").trim()) invalidFields.push("horario");
    if (!(row[2] ?? "").trim()) invalidFields.push("item");

    if (invalidFields.length > 0) {
      invalidRows.push({ source_row: sourceRow, invalid_fields: invalidFields });
      return;
    }

    records.push({
      import_key: `dadossaude:${sourceRow}`,
      data: row[0],
      horario: row[1],
      item: row[2],
      quantidade: row[3] || null,
      midia_id: row[4] || null,
      json_filename: row[5] || null,
      source_file_id: sourceFileId,
      evento_tipo: "alimentacao",
    });
  });

  return { records, invalidRows };
}

async function getExistingKeys(connectors, sourceFileId) {
  const keys = new Set();
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      select: "import_key",
      source_file_id: `eq.${sourceFileId}`,
      order: "import_key.asc",
      limit: "1000",
      offset: String(offset),
    });
    const response = await connectorRequest(
      connectors,
      SUPABASE_CONNECTOR,
      `/rest/v1/${TABLE_NAME}?${params.toString()}`,
    );
    const page = await response.json();
    page.forEach((record) => keys.add(record.import_key));
    if (page.length < 1000) break;
    offset += page.length;
  }

  return keys;
}

async function upsertRecords(connectors, records) {
  let batches = 0;

  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const batch = records.slice(start, start + BATCH_SIZE);
    await connectorRequest(
      connectors,
      SUPABASE_CONNECTOR,
      `/rest/v1/${TABLE_NAME}?on_conflict=import_key`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(batch),
      },
    );
    batches += 1;
  }

  return batches;
}

async function main() {
  const connectors = new ReplitConnectors();
  const spreadsheet = await findSpreadsheet(connectors);
  const response = await connectorRequest(
    connectors,
    DRIVE_CONNECTOR,
    `/drive/v3/files/${encodeURIComponent(spreadsheet.id)}/export?mimeType=text/csv`,
  );
  const { records, invalidRows } = normalizeRows(await response.text(), spreadsheet.id);
  const existingKeys = await getExistingKeys(connectors, spreadsheet.id);
  const inserted = records.filter((record) => !existingKeys.has(record.import_key)).length;
  const updated = records.length - inserted;
  const batches = await upsertRecords(connectors, records);

  return {
    ok: true,
    source: {
      id: spreadsheet.id,
      name: spreadsheet.name,
      modifiedTime: spreadsheet.modifiedTime,
    },
    total_rows: records.length + invalidRows.length,
    valid_rows: records.length,
    inserted,
    updated,
    invalid_rows: invalidRows,
    batches,
  };
}

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
