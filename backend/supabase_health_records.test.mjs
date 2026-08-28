import { expect, test } from "bun:test";
import {
  reviewHealthExam,
  saveRecordsPayload,
  upsertHealthContext,
} from "./supabase_health_records.mjs";

test("routes mixed food and hydration groups to their own tables", async () => {
  const requests = [];
  const connectors = {
    proxy: async (name, path, init) => {
      requests.push({ name, path, init });
      return { ok: true };
    },
  };

  const result = await saveRecordsPayload(connectors, {
    owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
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
        owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
      }),
    ],
    [
      expect.objectContaining({
        item: "água",
        quantidade: "500ml",
        owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
      }),
    ],
  ]);
});

test("upserts health context with the authenticated owner id", async () => {
  const requests = [];
  const connectors = {
    proxy: async (name, path, init) => {
      requests.push({ name, path, init });
      return {
        ok: true,
        json: async () => [{ owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584" }],
      };
    },
  };

  await upsertHealthContext(connectors, {
    owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
    clinical_profile: "perfil",
    gem_instructions: "instruções",
  });

  expect(requests[0].path).toContain("/rest/v1/health_contexts");
  expect(JSON.parse(requests[0].init.body)).toEqual(
    expect.objectContaining({
      owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
      clinical_profile: "perfil",
    }),
  );
});

test("reviews only a pending exam belonging to the owner", async () => {
  const requests = [];
  const connectors = {
    proxy: async (name, path, init) => {
      requests.push({ name, path, init });
      return {
        ok: true,
        json: async () => [{ id: "84bfb4de-41d2-4c97-90fb-0914ef62cb3d", status: "confirmed" }],
      };
    },
  };

  await reviewHealthExam(connectors, {
    owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
    exam_id: "84bfb4de-41d2-4c97-90fb-0914ef62cb3d",
    status: "confirmed",
    exam_type: "hemograma",
    extracted_data: { marcadores: [] },
  });

  expect(requests[0].path).toContain("owner_id=eq.8e165e4f-59bc-4b94-9508-4f596ee87584");
  expect(requests[0].path).toContain("status=eq.pending");
});
