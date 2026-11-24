import { expect, test } from "bun:test";
import { periodAnalysisContext } from "./period_analysis_context.mjs";

process.env.SESSION_SECRET ??= "unit-test-only";
const owner = "8e165e4f-59bc-4b94-9508-4f596ee87584";
const payload = { owner_id: owner, start_date: "2026-09-03", end_date: "2026-10-02" };

function fixtures(rowsByTable, calls) {
  return { proxy: async (_name, path, init = {}) => {
    expect(init.method ?? "GET").toBe("GET");
    expect(path.startsWith("/rest/v1/rpc/")).toBe(false);
    const [pathname, search] = path.split("?");
    const params = new URLSearchParams(search);
    expect(params.get("owner_id")).toBe(`eq.${owner}`);
    expect(params.getAll("data")).toEqual(["gte.2026-09-03", "lte.2026-10-02"]);
    expect(params.get("order")).toBe("data.asc,id.asc");
    const table = pathname.split("/").at(-1);
    calls.push({ table, offset: Number(params.get("offset")) });
    const rows = rowsByTable[table] ?? [];
    const offset = Number(params.get("offset"));
    return { ok: true, json: async () => rows.slice(offset, offset + 500) };
  } };
}

test("reads all five owned tables with inclusive bounds and reconciles water per day, without any writes or fixed-week RPC", async () => {
  const calls = [];
  const context = await periodAnalysisContext(fixtures({
    peso: [{ data: "2026-09-03", valor_kg: 70.8, import_key: "internal" }],
    hidratacao: [
      { data: "2026-09-03", horario: "09:00", item: "Água", quantidade: "200 ml" },
      { data: "2026-09-03", horario: "12:00", item: "Total diário de água", quantidade: "1000 ml" },
      { data: "2026-09-03", horario: "16:00", item: "Água", quantidade: "400 ml" },
      { data: "2026-10-02", horario: "12:00", item: "Água", quantidade: "1 l" },
    ],
  }, calls), payload);
  expect(calls).toHaveLength(5);
  expect(Object.keys(context.registros).sort()).toEqual(["alimentacao", "exercicios", "hidratacao", "peso", "sono"]);
  expect(context.registros.peso).toEqual([{ data: "2026-09-03", valor_kg: 70.8 }]);
  expect(context.agua_registrada_por_dia).toEqual([
    { data: "2026-09-03", total_ml: 1400 }, { data: "2026-10-02", total_ml: 1000 },
  ]);
  expect(context.periodo).toEqual({ inicio: payload.start_date, fim: payload.end_date });
});

test("pagination includes records beyond first page rather than silently limiting a long period", async () => {
  const calls = [];
  const rows = Array.from({ length: 501 }, () => ({ data: "2026-09-03", item: "Alimento", quantidade: "1 porção" }));
  const result = await periodAnalysisContext(fixtures({ alimentacao: rows }, calls), payload);
  expect(result.registros.alimentacao).toHaveLength(501);
  expect(calls.filter((call) => call.table === "alimentacao").map((call) => call.offset)).toEqual([0, 500]);
});

test("uncertain water amounts stay unknown rather than zero; a later daily total reconciles earlier uncertainty", async () => {
  const result = await periodAnalysisContext(fixtures({ hidratacao: [
    { data: "2026-09-03", horario: "09:00", item: "Água", quantidade: "alguns copos" },
    { data: "2026-10-02", horario: "09:00", item: "Água", quantidade: "alguns copos" },
    { data: "2026-10-02", horario: "12:00", item: "Total diário de água", quantidade: "1000 ml" },
  ] }, []), payload);
  expect(result.agua_registrada_por_dia).toEqual([
    { data: "2026-09-03", total_ml: null }, { data: "2026-10-02", total_ml: 1000 },
  ]);
});

test("invalid dates and unexpected out-of-range rows fail explicitly", async () => {
  await expect(periodAnalysisContext(fixtures({}, []), { ...payload, start_date: "2026-02-30" })).rejects.toThrow();
  await expect(periodAnalysisContext(fixtures({}, []), { ...payload, end_date: "2026-01-01" })).rejects.toThrow();
  await expect(periodAnalysisContext(fixtures({ peso: [{ data: "2026-09-02", valor_kg: 70.8 }] }, []), payload)).rejects.toThrow();
});