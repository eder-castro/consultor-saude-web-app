import { ReplitConnectors } from "@replit/connectors-sdk";

const CONNECTOR_NAME = "google-drive";
const FOLDER_NAME = "Gemini Gems";
const SPREADSHEET_NAME = "DadosSaude";
const FILE_NAMES = new Set(["CONTEXTO_SAUDE_RECENTE.txt", "CONTEXTO_SAÚDE_RECENTE.txt"]);
const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const GOOGLE_DOCUMENT_MIME_TYPE = "application/vnd.google-apps.document";
const GOOGLE_SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

class ContextFileError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function escapeDriveQueryValue(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

async function driveRequest(connectors, path) {
  const response = await connectors.proxy(CONNECTOR_NAME, path, {
    method: "GET",
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new ContextFileError(
      "google_drive_error",
      `Google Drive respondeu ${response.status}: ${detail}`,
    );
  }

  return response;
}

async function listFiles(connectors, query) {
  const files = [];
  let pageToken;

  do {
    const params = new URLSearchParams({
      q: query,
      fields:
        "nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,parents,webViewLink)",
      pageSize: "1000",
      orderBy: "modifiedTime desc",
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await driveRequest(connectors, `/drive/v3/files?${params.toString()}`);
    const page = await response.json();

    if (page.incompleteSearch) {
      throw new ContextFileError(
        "incomplete_search",
        "O Google Drive retornou uma busca incompleta.",
      );
    }

    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return files;
}

async function findContextFile(connectors) {
  const escapedFolderName = escapeDriveQueryValue(FOLDER_NAME);
  const folders = await listFiles(
    connectors,
    `name = '${escapedFolderName}' and mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and trashed = false`,
  );

  if (folders.length === 0) {
    throw new ContextFileError(
      "folder_not_found",
      `A pasta "${FOLDER_NAME}" não foi encontrada no Google Drive.`,
    );
  }

  const matches = [];

  for (const folder of folders) {
    const children = await listFiles(
      connectors,
      `'${escapeDriveQueryValue(folder.id)}' in parents and trashed = false`,
    );

    for (const file of children) {
      if (FILE_NAMES.has(file.name)) {
        matches.push(file);
      }
    }
  }

  if (matches.length === 0) {
    throw new ContextFileError(
      "context_file_not_found",
      `O arquivo de contexto não foi encontrado dentro de "${FOLDER_NAME}".`,
    );
  }

  if (matches.length > 1) {
    throw new ContextFileError(
      "multiple_context_files",
      `Foram encontrados ${matches.length} arquivos de contexto. Mantenha apenas um arquivo com o nome esperado.`,
    );
  }

  return matches[0];
}

async function findSpreadsheet(connectors) {
  const escapedName = escapeDriveQueryValue(SPREADSHEET_NAME);
  const matches = await listFiles(
    connectors,
    `name = '${escapedName}' and mimeType = '${GOOGLE_SPREADSHEET_MIME_TYPE}' and trashed = false`,
  );

  if (matches.length === 0) {
    throw new ContextFileError(
      "spreadsheet_not_found",
      `A planilha "${SPREADSHEET_NAME}" não foi encontrada no Google Drive.`,
    );
  }

  if (matches.length > 1) {
    throw new ContextFileError(
      "multiple_spreadsheets",
      `Foram encontradas ${matches.length} planilhas chamadas "${SPREADSHEET_NAME}". Mantenha apenas uma.`,
    );
  }

  return matches[0];
}

async function downloadContext(connectors, file) {
  const encodedFileId = encodeURIComponent(file.id);

  if (file.mimeType === GOOGLE_DOCUMENT_MIME_TYPE) {
    const params = new URLSearchParams({ mimeType: "text/plain" });
    const response = await driveRequest(
      connectors,
      `/drive/v3/files/${encodedFileId}/export?${params.toString()}`,
    );
    return response.text();
  }

  const params = new URLSearchParams({ alt: "media" });
  const response = await driveRequest(
    connectors,
    `/drive/v3/files/${encodedFileId}?${params.toString()}`,
  );
  return response.text();
}

async function downloadSpreadsheet(connectors, file) {
  const encodedFileId = encodeURIComponent(file.id);
  const params = new URLSearchParams({ mimeType: "text/csv" });
  const response = await driveRequest(
    connectors,
    `/drive/v3/files/${encodedFileId}/export?${params.toString()}`,
  );
  return response.text();
}

function parseCsv(csvText) {
  const rows = [];
  let fields = [];
  let field = "";
  let quoted = false;
  let rowNumber = 1;

  const finishRow = () => {
    fields.push(field);
    rows.push({ rowNumber, values: fields });
    fields = [];
    field = "";
    rowNumber += 1;
  };

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];

    if (quoted) {
      if (character === '"') {
        if (csvText[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      fields.push(field);
      field = "";
    } else if (character === "\r") {
      if (csvText[index + 1] === "\n") index += 1;
      finishRow();
    } else if (character === "\n") {
      finishRow();
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new ContextFileError(
      "invalid_spreadsheet",
      "A exportação CSV da planilha contém aspas sem fechamento.",
    );
  }

  if (field !== "" || fields.length > 0 || rows.length === 0) {
    finishRow();
  }

  return rows;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase();
}

async function readSpreadsheet(connectors) {
  const file = await findSpreadsheet(connectors);
  const csv = await downloadSpreadsheet(connectors, file);
  const parsedRows = parseCsv(csv);
  const expectedHeaders = ["data", "horario", "item", "quantidade", "midia_id", "json_filename"];
  const headers = (parsedRows.shift()?.values ?? []).map(normalizeHeader);

  if (
    headers.length !== expectedHeaders.length ||
    headers.some((header, index) => header !== expectedHeaders[index])
  ) {
    throw new ContextFileError(
      "invalid_spreadsheet",
      `A planilha "${SPREADSHEET_NAME}" precisa ter as colunas: ${expectedHeaders.join(", ")}.`,
    );
  }

  return {
    ok: true,
    source: {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
      webViewLink: file.webViewLink,
    },
    headers,
    rows: parsedRows.map((row) => ({
      row_number: row.rowNumber,
      values: row.values,
    })),
  };
}

async function main() {
  const connectors = new ReplitConnectors();
  const action = process.argv[2];

  if (action === "sheet") return readSpreadsheet(connectors);

  const file = await findContextFile(connectors);
  const context = await downloadContext(connectors, file);

  return {
    ok: true,
    context,
    source: {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
      webViewLink: file.webViewLink,
    },
  };
}

try {
  process.stdout.write(JSON.stringify(await main()));
} catch (error) {
  const code = error instanceof ContextFileError ? error.code : "unexpected_error";
  const message = error instanceof Error ? error.message : "Falha inesperada ao ler o contexto.";

  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: { code, message },
    }),
  );
  process.exitCode = 1;
}
