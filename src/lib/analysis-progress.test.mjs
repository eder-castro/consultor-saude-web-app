import { afterEach, expect, test } from "bun:test";
import { fetchAnalysisStream } from "./analysis-progress";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const makeError = (status, detail) => Object.assign(new Error(detail), { status });

function streamFixture(events) {
  const bytes = new TextEncoder().encode(events);
  // Deliberately split UTF-8 and SSE boundaries into tiny chunks.
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

test("streams real stages and returns the complete result despite split chunks and keepalives", async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return streamFixture(
      'data: {"type":"progress","stage":"loading_context"}\n\n' +
      ': keepalive\n\n' +
      'data: {"type":"progress","stage":"unknown-future-stage"}\n\n' +
      'data: {"type":"progress","stage":"analyzing_image"}\r\n\r\n' +
      'data: {"type":"progress","stage":"retrying_service"}\n\n' +
      'data: {"type":"result","data":{"analysis":"Análise concluída."}}\n\n');
  };
  const stages = [];
  const result = await fetchAnalysisStream("/process-input/stream", "{}", (stage) => stages.push(stage), makeError);
  expect(stages).toEqual(["loading_context", "analyzing_image", "retrying_service"]);
  expect(result).toEqual({ analysis: "Análise concluída." });
  expect(request.url.endsWith("/process-input/stream")).toBe(true);
  expect(request.init.credentials).toBe("include");
});

test("propagates streamed service errors with the original retryable status", async () => {
  globalThis.fetch = async () => streamFixture(
    'data: {"type":"progress","stage":"retrying_service"}\n\n' +
    'data: {"type":"error","status":503,"detail":"Serviço indisponível."}\n\n');
  await expect(fetchAnalysisStream("/process-input/stream", "{}", () => {}, makeError))
    .rejects.toMatchObject({ status: 503, message: "Serviço indisponível." });
});

test("a broken stream fails explicitly instead of displaying a fictitious result", async () => {
  globalThis.fetch = async () => streamFixture('data: {"type":"progress","stage":"analyzing_text"}\n\n');
  await expect(fetchAnalysisStream("/process-input/stream", "{}", () => {}, makeError))
    .rejects.toMatchObject({ status: 502 });
});