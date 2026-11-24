import { readConfig } from "./api-config";

export const analysisStageLabels = {
  preparing_images: "Preparando suas fotos para envio...",
  sending_input: "Enviando seu registro para análise...",
  reading_input: "Identificando o que você enviou...",
  loading_context: "Consultando seus registros para contextualizar a análise...",
  analyzing_image: "Aguardando a interpretação das fotos pelo serviço de análise...",
  analyzing_text: "Aguardando a interpretação do texto pelo serviço de análise...",
  retrying_service: "O serviço não respondeu nesta tentativa. Tentando novamente...",
  checking_result: "Conferindo o resultado antes de mostrar a revisão...",
  refining_analysis: "Refinando a interpretação para montar a revisão...",
  loading_saved_context: "Consultando o registro confirmado e seu histórico de referência...",
  analyzing_saved_record: "Aguardando a análise do registro confirmado...",
} as const;

export type AnalysisStage = keyof typeof analysisStageLabels;
export type ProgressCallback = (stage: AnalysisStage) => void;

export function stageLabel(stage?: AnalysisStage, fallback = "Aguardando a análise..."): string {
  return stage ? analysisStageLabels[stage] ?? fallback : fallback;
}

export async function fetchAnalysisStream(
  path: string, body: string, onProgress: ProgressCallback,
  makeError: (status: number, detail?: string) => Error,
): Promise<unknown> {
  const response = await fetch(readConfig().baseUrl.replace(/\/$/, "") + path, {
    method: "POST", body, credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
  });
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("health:unauthorized"));
    }
    const json = await response.json().catch(() => ({}));
    throw makeError(response.status, typeof json.detail === "string" ? json.detail : undefined);
  }
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    throw makeError(502, "Não foi possível acompanhar a análise. Tente novamente.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue; // SSE keepalives don't advance the stage.
        let event;
        try {
          event = JSON.parse(data);
          if (!event || typeof event !== "object") throw new Error("invalid event");
        } catch {
          throw makeError(502, "A análise enviou um retorno inválido. Tente novamente.");
        }
        if (event.type === "progress" && typeof event.stage === "string" &&
            Object.hasOwn(analysisStageLabels, event.stage)) {
          onProgress(event.stage as AnalysisStage);
        } else if (event.type === "result") {
          return event.data;
        } else if (event.type === "error") {
          throw makeError(Number.isInteger(event.status) ? event.status : 502,
            typeof event.detail === "string" ? event.detail : undefined);
        }
      }
      if (done) break;
    }
    throw makeError(502, "A conexão terminou antes do resultado da análise. Tente novamente.");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}