import { expect, test } from "bun:test";
import { saveRecordsPayload } from "./supabase_health_records.mjs";

test("routes mixed food and hydration groups to their own tables", async () => {
  const requests = [];
  const connectors = {
    proxy: async (name, path, init) => {
      requests.push({ name, path, init });
      return { ok: true };
    },
  };

  const result = await saveRecordsPayload(connectors, {
    grupos: [
      {
        evento_tipo: "alimentacao",
        itens: [
          {
            item: "arroz",
            quantidade_estimada: "1 porção",
            confirmado: true,
          },
        ],
      },
      {
        evento_tipo: "hidratacao",
        itens: [
          {
            item: "água",
            quantidade_estimada: "500ml",
            confirmado: true,
          },
        ],
      },
    ],
  });

  expect(result).toEqual({ ok: true, saved: 2 });
  expect(requests.map(({ name }) => name)).toEqual(["supabase", "supabase"]);
  expect(requests.map(({ path }) => path)).toEqual(["/rest/v1/alimentacao", "/rest/v1/hidratacao"]);
  expect(requests.map(({ init }) => JSON.parse(init.body))).toEqual([
    [
      expect.objectContaining({
        item: "arroz",
        quantidade: "1 porção",
        evento_tipo: "alimentacao",
      }),
    ],
    [
      expect.objectContaining({
        item: "água",
        quantidade: "500ml",
      }),
    ],
  ]);
});
