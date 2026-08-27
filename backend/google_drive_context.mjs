import { ReplitConnectors } from "@replit/connectors-sdk";

const CONNECTOR_NAME = "google-drive";
const FOLDER_NAME = "Gemini Gems";
const FILE_NAMES = new Set([
  "CONTEXTO_SAUDE_RECENTE.txt",
  "CONTEXTO_SAÚDE_RECENTE.txt",
]);
const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const GOOGLE_DOCUMENT_MIME_TYPE = "application/vnd.google-apps.document";

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

    const response = await driveRequest(
      connectors,
      `/drive/v3/files?${params.toString()}`,
    );
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

async function main() {
  const connectors = new ReplitConnectors();
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
  const code =
    error instanceof ContextFileError ? error.code : "unexpected_error";
  const message =
    error instanceof Error ? error.message : "Falha inesperada ao ler o contexto.";

  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: { code, message },
    }),
  );
  process.exitCode = 1;
}