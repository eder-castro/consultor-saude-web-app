import { expect, test } from "bun:test";
import { dayAnalysisContext } from "./supabase_health_records.mjs";

test("day analysis reads only owned saved rows for the snapshot day and never inserts health records", async () => {
  process.env.SESSION_SECRET ??= "unit-test-only";
  const owner = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const snapshot = {
    ok: true, para_dia: "2026-10-02",
    periodo: { inicio: "2026-09-25", fim: "2026-10-01" },
    resumo: { dias: [
      ...Array.from({ length: 6 }, (_, index) => ({ data: `2026-09-${25 + index}` })),
      { data: "2026-10-01", peso_kg: 70.6 },
    ] },
  };
  const calls = [];
  const context = await dayAnalysisContext({
    proxy: async (_name, path, init = {}) => {
      calls.push({ path, method: init.method ?? "GET" });
      if (path === "/rest/v1/rpc/health_daily_analysis_context") {
        expect(JSON.parse(init.body)).toEqual({ p_owner_id: owner });
        return { ok: true, json: async () => snapshot };
      }
      expect(init.method ?? "GET").toBe("GET");
      const query = new URLSearchParams(path.split("?")[1]);
      expect(query.get("owner_id")).toBe(`eq.${owner}`);
      expect(query.get("data")).toBe("eq.2026-10-02");
      const rows = path.startsWith("/rest/v1/peso?")
        ? [{ data: "2026-10-02", valor_kg: 70.8, import_key: "private-key" }] : [];
      return { ok: true, json: async () => rows };
    },
  }, { owner_id: owner });
  expect(calls).toHaveLength(6);
  expect(calls.filter((call) => call.method !== "GET").map((call) => call.path))
    .toEqual(["/rest/v1/rpc/health_daily_analysis_context"]);
  expect(context.resumo).toEqual(snapshot.resumo);
  expect(context.registros_do_dia.registros.peso).toEqual([{ data: "2026-10-02", valor_kg: 70.8 }]);
  expect(Object.keys(context.registros_do_dia.registros).sort())
    .toEqual(["alimentacao", "exercicios", "hidratacao", "peso", "sono"]);
  expect(context).not.toHaveProperty("confirmados");
});