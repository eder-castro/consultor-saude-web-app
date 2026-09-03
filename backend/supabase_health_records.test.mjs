import { expect, test } from "bun:test";
import {
  consolidateSleepRecords,
  listSleepReviews,
  reviewHealthExam,
  saveRecordsPayload,
  upsertHealthContext,
  weeklySummary,
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

test("consolidates sleep stages into one total sleep record", async () => {
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
        evento_tipo: "sono",
        itens: [
          { item: "Sono profundo", quantidade_estimada: "1h", confirmado: true },
          { item: "Sono leve", quantidade_estimada: "4h", confirmado: true },
          { item: "Sono REM", quantidade_estimada: "2h", confirmado: true },
          { item: "Acordado", quantidade_estimada: "15min", confirmado: true },
        ],
      },
    ],
  });

  expect(result).toEqual({ ok: true, saved: 1 });
  expect(requests).toHaveLength(1);
  expect(JSON.parse(requests[0].init.body)).toEqual([
    expect.objectContaining({
      duracao_minutos: "420 min",
      sono_profundo_min: "60 min",
      sono_leve_min: "240 min",
      sono_rem_min: "120 min",
      acordado_min: "15 min",
    }),
  ]);
});

test("preserves sleep phase fields provided on the total sleep item", async () => {
  const requests = [];
  const connectors = {
    proxy: async (_name, path, init) => {
      requests.push({ path, init });
      return { ok: true };
    },
  };

  await saveRecordsPayload(connectors, {
    owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
    grupos: [
      {
        evento_tipo: "sono",
        itens: [
          {
            item: "Sono total",
            quantidade_estimada: "7h 10min",
            sono_profundo_min: "75 min",
            sono_leve_min: "250 min",
            sono_rem_min: "105 min",
            acordado_min: "20 min",
            confirmado: true,
          },
        ],
      },
    ],
  });

  expect(JSON.parse(requests[0].init.body)[0]).toEqual(
    expect.objectContaining({
      duracao_minutos: "7h 10min",
      sono_profundo_min: "75 min",
      sono_leve_min: "250 min",
      sono_rem_min: "105 min",
      acordado_min: "20 min",
    }),
  );
});

test("builds seven-day dashboard details with sleep phases and trends", async () => {
  const responses = [
    [
      {
        data: "2026-08-29",
        horario: "12:00",
        quantidade: "1 porção",
        evento_tipo: "alimentacao",
      },
    ],
    [{ data: "2026-09-02", quantidade: "2 l" }],
    [{ data: "2026-09-01", duracao_min: "35 min" }],
    [
      {
        data: "2026-09-02",
        duracao_minutos: "7h 10min",
        sono_profundo_min: "75 min",
        sono_leve_min: "250 min",
        sono_rem_min: "105 min",
        acordado_min: "20 min",
      },
    ],
    [
      { data: "2026-08-28", horario: "08:00", valor_kg: "95.5 kg" },
      { data: "2026-09-02", horario: "08:00", valor_kg: "95 kg" },
    ],
  ];
  let index = 0;
  const connectors = {
    proxy: async () => ({
      ok: true,
      json: async () => responses[index++],
    }),
  };

  const result = await weeklySummary(
    connectors,
    "2026-09-03",
    "8e165e4f-59bc-4b94-9508-4f596ee87584",
  );

  expect(result.periodo).toEqual({ inicio: "2026-08-28", fim: "2026-09-03" });
  expect(result.dias).toHaveLength(7);
  expect(result.dias[5]).toEqual(
    expect.objectContaining({
      data: "2026-09-02",
      agua_ml: 2000,
      sono_horas: 7.17,
      sono_profundo_horas: 1.25,
      sono_leve_horas: 4.17,
      sono_rem_horas: 1.75,
      acordado_horas: 0.33,
    }),
  );
  expect(result.tendencias.sono).toContain("duração do sono");
  expect(result.tendencias.peso).toContain("tendência de queda");
});

test("lists suspicious legacy sleep rows without mutating them", async () => {
  const requests = [];
  const connectors = {
    proxy: async (name, path, init) => {
      requests.push({ name, path, init });
      return {
        ok: true,
        text: async () =>
          JSON.stringify([
            {
              id: 9007199254740993n.toString(),
              data: "2026-08-20",
              inicio: "23:00",
              fim: "07:00",
              duracao_minutos: "60 min",
              sono_profundo_min: "60 min",
              sono_leve_min: null,
              sono_rem_min: null,
              acordado_min: null,
            },
            {
              id: 9007199254740994n.toString(),
              data: "2026-08-20",
              inicio: "23:00",
              fim: "07:00",
              duracao_minutos: "240 min",
              sono_profundo_min: null,
              sono_leve_min: "240 min",
              sono_rem_min: null,
              acordado_min: null,
            },
            {
              id: 9007199254740995n.toString(),
              data: "2026-08-21",
              inicio: null,
              fim: null,
              duracao_minutos: "420 min",
              sono_profundo_min: "60 min",
              sono_leve_min: "240 min",
              sono_rem_min: "120 min",
              acordado_min: null,
            },
          ]).replace(/"id":"(\\d+)"/g, '"id":$1'),
      };
    },
  };

  const result = await listSleepReviews(connectors, "8e165e4f-59bc-4b94-9508-4f596ee87584");

  expect(result.revisoes).toHaveLength(1);
  expect(result.revisoes[0].registros).toEqual([
    expect.objectContaining({
      id: "9007199254740993",
      etapa_label: "Sono profundo",
      valor_existente: "60 min",
    }),
    expect.objectContaining({
      id: "9007199254740994",
      etapa_label: "Sono leve",
      valor_existente: "240 min",
    }),
  ]);
  expect(requests).toHaveLength(1);
  expect(requests[0].init?.method).toBeUndefined();
  expect(requests[0].path).toContain("owner_id=eq.8e165e4f-59bc-4b94-9508-4f596ee87584");
});

test("retries rate-limited read requests before failing", async () => {
  let calls = 0;
  const connectors = {
    proxy: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: () => "0" },
          text: async () => '{"error":"rate limit"}',
        };
      }
      return {
        ok: true,
        text: async () =>
          JSON.stringify([
            {
              id: "1",
              data: "2026-08-20",
              inicio: "23:00",
              fim: "07:00",
              duracao_minutos: "420 min",
              sono_profundo_min: "60 min",
              sono_leve_min: "240 min",
              sono_rem_min: "120 min",
              acordado_min: null,
            },
          ]),
      };
    },
  };

  const result = await listSleepReviews(connectors, "8e165e4f-59bc-4b94-9508-4f596ee87584");

  expect(calls).toBe(2);
  expect(result.revisoes).toEqual([]);
});

test("consolidates only selected numeric rows for the authenticated owner", async () => {
  const requests = [];
  const connectors = {
    proxy: async (name, path, init) => {
      requests.push({ name, path, init });
      return {
        ok: true,
        json: async () => ({ ok: true, corrected: true, replaced: 2, record_id: "20" }),
      };
    },
  };

  const result = await consolidateSleepRecords(connectors, {
    owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
    record_ids: ["9007199254740993", "9007199254740994", "9007199254740994"],
    total_sleep_min: 420,
  });

  expect(result).toEqual({ ok: true, corrected: true, replaced: 2, record_id: "20" });
  expect(requests[0].path).toBe("/rest/v1/rpc/consolidate_sleep_records");
  expect(JSON.parse(requests[0].init.body)).toEqual({
    p_owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
    p_record_ids: ["9007199254740993", "9007199254740994"],
    p_total_sleep_min: 420,
  });
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
