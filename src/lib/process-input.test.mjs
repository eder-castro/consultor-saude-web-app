import { afterEach, expect, test } from "bun:test";
import { DayAnalysisSchema, PeriodAnalysisSchema } from "./api-schemas";
import { processInput } from "./api";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function streamResult(result, stage = "analyzing_text") {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        `data: ${JSON.stringify({ type: "progress", stage })}\n\n` +
        `data: ${JSON.stringify({ type: "result", data: result })}\n\n`,
      ));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

test("validates day-analysis dates and nonempty analysis text", () => {
  const result = { kind: "day_analysis", date: "2024-02-29", analysis: "Seu dia foi equilibrado." };
  expect(DayAnalysisSchema.parse(result)).toEqual(result);
  expect(DayAnalysisSchema.safeParse({ ...result, date: "2025-02-29" }).success).toBe(false);
  expect(DayAnalysisSchema.safeParse({ ...result, date: "29-02-2024" }).success).toBe(false);
  expect(DayAnalysisSchema.safeParse({ ...result, analysis: "" }).success).toBe(false);
  expect(DayAnalysisSchema.safeParse({ ...result, analysis: "   " }).success).toBe(false);
});

test("returns streamed day analysis distinctly from a meal correction", async () => {
  const dayResult = {
    kind: "day_analysis",
    date: "2025-06-15",
    analysis: "Você registrou refeições e hidratação ao longo do dia.",
  };
  const stages = [];
  globalThis.fetch = async () => streamResult(dayResult);

  const analysis = await processInput({ text: "analise meu dia" }, (stage) => stages.push(stage));
  expect(analysis).toEqual(dayResult);
  expect(stages).toEqual(["analyzing_text"]);

  globalThis.fetch = async () => new Response(JSON.stringify({
    kind: "meal_correction",
    source_text: "corrigir almoço",
    target_count: 1,
  }), { headers: { "Content-Type": "application/json" } });
  const correction = await processInput({ text: "corrija meu almoço" });
  expect(correction).toEqual({
    kind: "meal_correction",
    source_text: "corrigir almoço",
    target_count: 1,
  });
});

test("rejects malformed day-analysis envelopes from the streamed result", async () => {
  globalThis.fetch = async () => streamResult({
    kind: "day_analysis",
    date: "2025-13-01",
    analysis: "Texto.",
  });
  await expect(processInput({ text: "analise meu dia" }, () => {})).rejects.toThrow();

  globalThis.fetch = async () => new Response(JSON.stringify({
    kind: "day_analysis",
    date: "2025-06-15",
    analysis: "",
  }), { headers: { "Content-Type": "application/json" } });
  await expect(processInput({ text: "analise meu dia" })).rejects.toThrow();
});

test("validates period-analysis dates, range, and bounded nonempty text", () => {
  const result = {
    kind: "period_analysis",
    start_date: "2024-02-29",
    end_date: "2024-03-01",
    analysis: "Resumo do período.",
  };
  expect(PeriodAnalysisSchema.parse(result)).toEqual(result);
  expect(PeriodAnalysisSchema.safeParse({ ...result, start_date: "2025-02-29" }).success).toBe(false);
  expect(PeriodAnalysisSchema.safeParse({ ...result, end_date: "2024-02-30" }).success).toBe(false);
  expect(PeriodAnalysisSchema.safeParse({ ...result, start_date: "2024-03-02" }).success).toBe(false);
  expect(PeriodAnalysisSchema.safeParse({ ...result, analysis: "" }).success).toBe(false);
  expect(PeriodAnalysisSchema.safeParse({ ...result, analysis: "   " }).success).toBe(false);
  expect(PeriodAnalysisSchema.safeParse({ ...result, analysis: "a".repeat(6001) }).success).toBe(false);
});

test("returns streamed period analysis as its own envelope", async () => {
  const periodResult = {
    kind: "period_analysis",
    start_date: "2025-06-09",
    end_date: "2025-06-15",
    analysis: "A semana teve registros consistentes.",
  };
  const stages = [];
  globalThis.fetch = async () => streamResult(periodResult);

  const analysis = await processInput({ text: "analise esta semana" }, (stage) => stages.push(stage));
  expect(analysis).toEqual(periodResult);
  expect(analysis.kind).toBe("period_analysis");
  expect(stages).toEqual(["analyzing_text"]);
});

test("parses a non-streamed period-analysis envelope before other response envelopes", async () => {
  const periodResult = {
    kind: "period_analysis",
    start_date: "2025-06-09",
    end_date: "2025-06-15",
    analysis: "A semana teve registros consistentes.",
  };
  globalThis.fetch = async () => new Response(JSON.stringify(periodResult), {
    headers: { "Content-Type": "application/json" },
  });

  expect(await processInput({ text: "analise esta semana" })).toEqual(periodResult);
});

test("rejects malformed period-analysis envelopes from streamed and non-streamed responses", async () => {
  globalThis.fetch = async () => streamResult({
    kind: "period_analysis",
    start_date: "2025-13-01",
    end_date: "2025-06-15",
    analysis: "Resumo.",
  });
  await expect(processInput({ text: "analise esta semana" }, () => {})).rejects.toThrow();

  globalThis.fetch = async () => new Response(JSON.stringify({
    kind: "period_analysis",
    start_date: "2025-06-16",
    end_date: "2025-06-15",
    analysis: "Resumo.",
  }), { headers: { "Content-Type": "application/json" } });
  await expect(processInput({ text: "analise esta semana" })).rejects.toThrow();
});