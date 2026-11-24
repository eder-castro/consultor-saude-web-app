import { expect, test } from "bun:test";
import {
  changeMealRecord,
  changeMealTime,
  dailySummary,
  dailyAnalysisSummary,
  currentDayAnalysisRecords,
  waterHistoryForDay,
  correctSavedWaterTotal,
  mealsForDay,
  replaceMealRecords,
  mealCorrectionStatuses,
  cancelPhoto,
  claimPhoto,
  consolidateSleepRecords,
  enqueuePhoto,
  finishPhoto,
  listSleepReviews,
  listSleepRecords,
  updateSleepRecord,
  reviewHealthExam,
  saveRecordsPayload,
  savedSevenDayAnalysisContext,
  upsertHealthContext,
  weeklySummary,
  weeklyMeals,
  savedAnalysesForDay,
  weightHistory,
  normalizeSleepLevels,
} from "./supabase_health_records.mjs";

test("weight periods are owner-scoped and keep all daily readings or last per day/month", async () => {
  const owner = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  let records = [];
  let request;
  const connectors = { proxy: async (_name, path) => {
    request = new URLSearchParams(path.split("?")[1]);
    return { ok: true, json: async () => records };
  }};
  records = [
    { id: 1, data: "2026-10-21", horario: "08:00", valor_kg: "80.5 kg" },
    { id: 2, data: "2026-10-21", horario: "20:00", valor_kg: "80.2 kg" },
  ];
  let result = await weightHistory(connectors, { owner_id: owner, data: "2026-10-21", periodo: "dia" });
  expect(result.pontos).toHaveLength(2);
  expect(request.get("owner_id")).toBe(`eq.${owner}`);
  expect(request.getAll("data")).toEqual(["gte.2026-10-21", "lte.2026-10-21"]);
  result = await weightHistory(connectors, { owner_id: owner, data: "2026-10-21", periodo: "semana" });
  expect(result.pontos.map((point) => point.peso_kg)).toEqual([80.2]);
  expect(result.periodo).toEqual({ inicio: "2026-10-15", fim: "2026-10-21" });
  expect(request.getAll("data")).toEqual(["gte.2026-10-15", "lte.2026-10-21"]);
  result = await weightHistory(connectors, { owner_id: owner, data: "2026-10-21", periodo: "mes" });
  expect(result.pontos.map((point) => point.peso_kg)).toEqual([80.2]);
  expect(result.periodo).toEqual({ inicio: "2026-10-01", fim: "2026-10-31" });
  records.push({ id: 3, data: "2026-11-02", horario: "08:00", valor_kg: "79 kg" });
  result = await weightHistory(connectors, { owner_id: owner, data: "2026-10-21", periodo: "ano" });
  expect(result.pontos.map((point) => point.peso_kg)).toEqual([80.2, 79]);
  expect(result.periodo).toEqual({ inicio: "2026-01-01", fim: "2026-12-31" });
  await expect(weightHistory(connectors, { owner_id: owner, data: "2026-02-30", periodo: "mes" })).rejects.toThrow();
  records = [];
  result = await weightHistory(connectors, { owner_id: owner, data: "2026-01-03", periodo: "semana" });
  expect(result.periodo).toEqual({ inicio: "2025-12-28", fim: "2026-01-03" });
  expect(result.pontos).toEqual([]);
});

test("meal item changes persist name, quantity, date and time in one owner-filtered PATCH", async () => {
  const owner = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  let writes = 0;
  const connectors = { proxy: async (_name, path, init) => {
    writes++;
    expect(new URLSearchParams(path.split("?")[1]).get("owner_id")).toBe(`eq.${owner}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ item: "Arroz", quantidade: "100 g", data: "2026-10-20", horario: "12:35" });
    return { ok: true, json: async () => [{ id: "42" }] };
  }};
  const payload = { owner_id: owner, record_id: "42", item: "Arroz", quantidade: "100 g", data: "2026-10-20", horario: "12:35" };
  await changeMealRecord(connectors, payload);
  expect(writes).toBe(1);
  await expect(changeMealRecord(connectors, { ...payload, horario: "25:00" })).rejects.toThrow();
  await expect(changeMealRecord(connectors, { ...payload, data: "2026-02-30" })).rejects.toThrow();
  expect(writes).toBe(1);
});

test("sleep source labels survive saves and weekly summaries without inferred defaults", async () => {
  const owner = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const levels = { profundo: "alto", leve: "normal", rem: "baixo" };
  expect(normalizeSleepLevels(levels)).toEqual(levels);
  expect(normalizeSleepLevels({})).toEqual({});
  expect(() => normalizeSleepLevels({ profundo: "inventado" })).toThrow();
  let saved;
  await saveRecordsPayload({ proxy: async (_name, path, init) => {
    saved = JSON.parse(init.body);
    return { ok: true, json: async () => ({ ok: true, record_refs: [] }) };
  }}, {
    operation_id: "phase-labels", owner_id: owner,
    grupos: [{ evento_tipo: "sono", data: "2026-10-21",
      itens: [{ item: "Sono total", quantidade_estimada: "420 min", sono_niveis: levels }] }],
  });
  expect(saved.p_entries[0].record.sono_niveis).toEqual(levels);
  const connectors = { proxy: async (_name, path) => ({
    ok: true,
    json: async () => path.startsWith("/rest/v1/sono?") ? [{
      data: "2026-10-21", duracao_minutos: "420 min", sono_niveis: levels,
      sono_profundo_min: "60 min", sono_leve_min: "300 min", sono_rem_min: "60 min",
    }] : [],
  }) };
  const summary = await weeklySummary(connectors, "2026-10-21", owner);
  expect(summary.dias.at(-1).sono_niveis).toEqual(levels);
  expect(summary.dias.at(-1).sono_horas).toBe(7);
});

test("water history separates declared totals from owned doses and corrections target only the reviewed total", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const key = "app:22222222-2222-4222-8222-222222222222";
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-water-history";
  const correctionCalls = [];
  let changed = false;
  const connectors = {
    proxy: async (_name, path, init = {}) => {
      expect(init.headers["X-Health-App-Secret"]).toBe("test-only-water-history");
      if (path === "/rest/v1/rpc/correct_daily_water_total") {
        correctionCalls.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ ok: !changed }) };
      }
      const params = new URLSearchParams(path.split("?")[1]);
      expect(params.get("owner_id")).toBe(`eq.${ownerId}`);
      expect(params.get("data")).toBe("eq.2026-08-20");
      if (path.startsWith("/rest/v1/hidratacao?")) return {
        ok: true, json: async () => [
          { horario: "11:00", item: "Total diário de água", quantidade: "2500 ml", import_key: key },
          { horario: "09:00", item: "Água", quantidade: "300 ml" },
        ],
      };
      return {
        ok: true, json: async () => [
          { horario: "08:00", item: "Copo de água", quantidade: "250 ml", evento_tipo: "hidratacao" },
          { horario: "10:00", item: "Total diário de água", quantidade: "1000 ml", evento_tipo: "hidratacao" },
          { horario: "12:00", item: "Almoço", quantidade: "1 prato", evento_tipo: "alimentacao" },
        ],
      };
    },
  };
  try {
    const history = await waterHistoryForDay(connectors, "2026-08-20", ownerId);
    expect(history.total_declarado).toEqual({
      import_key: key, horario: "11:00", quantidade: "2500 ml", quantidade_ml: 2500,
    });
    expect(history.doses.map((dose) => dose.item)).toEqual(["Copo de água", "Água"]);
    await correctSavedWaterTotal(connectors, {
      owner_id: ownerId, data: "2026-08-20", import_key: key,
      expected_quantity: "2500 ml", action: "update", new_total_ml: 2000,
    });
    expect(correctionCalls[0]).toEqual({
      p_owner_id: ownerId, p_data: "2026-08-20", p_import_key: key,
      p_expected_quantity: "2500 ml", p_action: "update", p_new_total_ml: 2000,
    });
    changed = true;
    await expect(correctSavedWaterTotal(connectors, {
      owner_id: ownerId, data: "2026-08-20", import_key: key,
      expected_quantity: "2500 ml", action: "delete", new_total_ml: null,
    })).rejects.toMatchObject({ code: "water_total_changed", status: 409 });
  } finally {
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  }
});

test("historical analyses return only saved analysis text for the owned São Paulo date, never photos", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-historical-analysis";
  const requests = [];
  const connectors = {
    proxy: async (_name, path, init = {}) => {
      requests.push(path);
      expect(init.headers["X-Health-App-Secret"]).toBe("test-only-historical-analysis");
      const params = new URLSearchParams(path.split("?")[1]);
      expect(path.startsWith("/rest/v1/health_chat_messages?")).toBe(true);
      expect(params.get("owner_id")).toBe(`eq.${ownerId}`);
      expect(params.get("kind")).toBe("eq.validation");
      expect(params.get("role")).toBe("eq.assistant");
      expect(params.getAll("created_at")).toEqual([
        "gte.2026-09-25T00:00:00-03:00", "lt.2026-09-26T00:00:00-03:00",
      ]);
      expect(params.get("payload->>status")).toBe("eq.saved");
      expect(params.get("payload->analysis->>status")).toBe("eq.ready");
      const rows = [
        { client_id: "saved-1", created_at: "2026-09-26T02:50:00Z", payload: {
          status: "saved", analysis: { status: "ready", text: "Uma análise salva." },
          validation: { photo: "data:image/jpeg;base64,secret-photo-bytes" },
        } },
        { client_id: "next-day", created_at: "2026-09-26T03:00:00Z", payload: {
          status: "saved", analysis: { status: "ready", text: "Dia seguinte." },
        } },
        { client_id: "not-ready", created_at: "2026-09-25T12:00:00Z", payload: {
          status: "saved", analysis: { status: "failed", text: "Não publicar." },
        } },
      ];
      return { ok: true, json: async () => rows };
    },
  };
  try {
    expect(await savedAnalysesForDay(connectors, "2026-09-25", ownerId)).toEqual({
      data: "2026-09-25",
      analises: [{ id: "saved-1", created_at: "2026-09-26T02:50:00Z", texto: "Uma análise salva." }],
    });
    expect(requests).toHaveLength(1);
    await expect(savedAnalysesForDay(connectors, "2026-02-30", ownerId)).rejects.toThrow();
    await expect(savedAnalysesForDay(connectors, "2027-01-01", ownerId)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  }
});

test("saved sleep correction updates one owned session and retains known phases", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-sleep-edit";
  const requests = [];
  const saved = {
    id: "42", data: "2026-09-28", inicio: "23:00", fim: "07:00",
    duracao_minutos: "420 min", sono_profundo_min: "80 min",
    sono_leve_min: "250 min", sono_rem_min: "90 min", acordado_min: null,
  };
  const connectors = {
    proxy: async (_name, path, init = {}) => {
      requests.push({ path, init });
      if (init.method === "PATCH") {
        return { ok: true, text: async () => JSON.stringify([{ ...saved, ...JSON.parse(init.body) }]) };
      }
      return { ok: true, json: async () => [saved], text: async () => JSON.stringify([saved]) };
    },
  };
  const payload = {
    owner_id: ownerId, record_id: "42", total_sleep_min: 450,
    sono_profundo_min: 90, sono_leve_min: 250, sono_rem_min: 110, acordado_min: 25,
  };
  try {
    expect((await listSleepRecords(connectors, ownerId)).registros).toHaveLength(1);
    const result = await updateSleepRecord(connectors, payload);
    expect(result.registro.duracao_minutos).toBe("450 min");
    expect(result.registro.sono_rem_min).toBe("110 min");
    const patch = requests.find(({ init }) => init.method === "PATCH");
    expect(patch.path).toContain("id=eq.42");
    expect(patch.path).toContain(`owner_id=eq.${ownerId}`);
    expect(JSON.parse(patch.init.body)).toEqual({
      duracao_minutos: "450 min", sono_profundo_min: "90 min",
      sono_leve_min: "250 min", sono_rem_min: "110 min", acordado_min: "25 min",
    });
    const count = requests.length;
    await expect(updateSleepRecord(connectors, { ...payload, total_sleep_min: 440 })).rejects.toThrow("fases dormidas");
    await expect(updateSleepRecord(connectors, { ...payload, record_id: "42;delete" })).rejects.toThrow("inválido");
    expect(requests).toHaveLength(count);
    const missing = { proxy: async () => ({ ok: true, json: async () => [] }) };
    await expect(updateSleepRecord(missing, payload)).rejects.toThrow("não encontrado");
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  }
});

test("meal time edits change all selected owned items in one patch without changing food or date", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-time-edit";
  const requests = [];
  let rows = [{ id: 42, data: "2026-10-05", horario: "21:10" }, { id: 43, data: "2026-10-05", horario: "21:10" }];
  const connectors = { proxy: async (_name, path, init) => {
    requests.push({ path, init });
    return { ok: true, json: async () => rows };
  } };
  try {
    expect(await changeMealTime(connectors, { owner_id: ownerId, record_ids: ["42", "43"], horario: "15:30" })).toEqual({ ok: true });
    expect(requests).toHaveLength(2);
    const patch = requests[1];
    expect(patch.init.method).toBe("PATCH");
    expect(JSON.parse(patch.init.body)).toEqual({ horario: "15:30" });
    expect(decodeURIComponent(patch.path)).toContain("id=in.(42,43)");
    expect(patch.path).toContain(`owner_id=eq.${ownerId}`);
    expect(patch.path).toContain("evento_tipo=eq.alimentacao");
    for (const horario of ["24:00", "15:60", "3pm", ""]) {
      await expect(changeMealTime(connectors, { owner_id: ownerId, record_ids: ["42"], horario })).rejects.toThrow();
    }
    expect(requests).toHaveLength(2);
    requests.length = 0;
    rows = [{ id: 42, data: "2026-10-05", horario: "21:10" }];
    await expect(changeMealTime(connectors, { owner_id: ownerId, record_ids: ["42", "43"], horario: "15:30" })).rejects.toThrow();
    expect(requests).toHaveLength(1); // Missing/foreign row: no item is patched.
    requests.length = 0;
    rows = [{ id: 42, data: "2026-10-05", horario: "21:10" }, { id: 43, data: "2026-10-04", horario: "21:10" }];
    await expect(changeMealTime(connectors, { owner_id: ownerId, record_ids: ["42", "43"], horario: "15:30" })).rejects.toThrow();
    expect(requests).toHaveLength(1);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("meal corrections target exactly one owned food row, not a new insert", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-meal-edit";
  const requests = [];
  const connectors = {
    proxy: async (_name, path, init) => {
      requests.push({ path, init });
      return { ok: true, json: async () => [{ id: 42 }] };
    },
  };
  try {
    expect(await changeMealRecord(connectors, {
      owner_id: ownerId, record_id: "42",
      item: "Vitamina de goiaba, maçã, banana e leite",
      quantidade: "1 copo; ingredientes sem porções informadas",
    })).toEqual({ ok: true });
    expect(requests[0].init.method).toBe("PATCH");
    expect(requests[0].path).toContain("id=eq.42");
    expect(requests[0].path).toContain(`owner_id=eq.${ownerId}`);
    expect(requests[0].path).toContain("evento_tipo=eq.alimentacao");
    expect(JSON.parse(requests[0].init.body).item).toContain("goiaba");
    expect(await changeMealRecord(connectors, {
      owner_id: ownerId, record_id: "42",
    }, true)).toEqual({ ok: true });
    expect(requests[1].init.method).toBe("DELETE");
    await expect(changeMealRecord(connectors, {
      owner_id: ownerId, record_id: "42;DELETE", item: "pão", quantidade: "1",
    })).rejects.toThrow("inválido");
    expect(requests).toHaveLength(2);
    const missing = { proxy: async () => ({ ok: true, json: async () => [] }) };
    await expect(changeMealRecord(missing, {
      owner_id: ownerId, record_id: "42", item: "pão", quantidade: "1",
    })).rejects.toThrow("não encontrado");
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  }
});

test("replacement sends exactly one owner-scoped transactional RPC with reviewed rows", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-meal-replacement";
  const requests = [];
  const connectors = {
    proxy: async (_name, path, init = {}) => {
      requests.push({ path, init });
      expect(path).toBe("/rest/v1/rpc/apply_meal_correction");
      expect(init.method).toBe("POST");
      return { ok: true, json: async () => ({ ok: true, corrected: 3, kept_id: "41" }) };
    },
  };
  const expectedRows = [41, 42, 43].map((id) => ({
    id: String(id), data: "2026-09-27", horario: "11:01",
    item: `item ${id}`, quantidade: "não informada",
  }));
  const payload = {
    owner_id: ownerId, correction_id: "proposal-41",
    record_ids: ["41", "42", "43"], keep_record_id: "41",
    item: "Pão com creme de ricota; pedaço de bolo; suco de vegetais",
    quantidade: "conforme descrição; demais não informadas",
    expected_rows: expectedRows,
  };
  try {
    expect(await replaceMealRecords(connectors, payload)).toEqual({
      ok: true, corrected: 3, kept_id: "41",
    });
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0].init.body)).toEqual({
      p_owner_id: ownerId, p_correction_id: "proposal-41",
      p_record_ids: payload.record_ids,
      p_keep_record_id: "41", p_item: payload.item,
      p_quantidade: payload.quantidade, p_expected_rows: expectedRows,
    });
    requests.length = 0;
    await expect(replaceMealRecords(connectors, {
      ...payload, record_ids: ["41", "41"], expected_rows: expectedRows.slice(0, 2),
    })).rejects.toThrow("Selecione registros válidos");
    expect(requests).toHaveLength(0);
    requests.length = 0;
    const statuses = {
      proxy: async (_name, path, init) => {
        requests.push({ path, init });
        return { ok: true, json: async () => ["proposal-41"] };
      },
    };
    expect(await mealCorrectionStatuses(statuses, {
      owner_id: ownerId, correction_ids: ["proposal-41", "proposal-999"],
    })).toEqual(["proposal-41"]);
    expect(requests[0].path).toBe("/rest/v1/rpc/meal_correction_statuses");
    expect(JSON.parse(requests[0].init.body)).toEqual({
      p_owner_id: ownerId, p_correction_ids: ["proposal-41", "proposal-999"],
    });
    requests.length = 0;
    await expect(replaceMealRecords(connectors, {
      ...payload, record_ids: ["41", "9223372036854775808"], expected_rows: expectedRows.slice(0, 2),
    })).rejects.toThrow("Selecione registros válidos");
    expect(requests).toHaveLength(0);
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  }
});

test("daily meal summary exposes database row IDs for exact corrections", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-meal-summary";
  const requests = [];
  const connectors = {
    proxy: async (_name, path) => {
      requests.push(path);
      return {
        ok: true,
        json: async () => path.startsWith("/rest/v1/alimentacao?")
          ? [{ id: 42, data: "2026-09-26", horario: "10:27", item: "Vitamina",
            quantidade: "1 copo", evento_tipo: "alimentacao" }]
          : [],
      };
    },
  };
  try {
    const summary = await dailySummary(connectors, "2026-09-26", ownerId);
    expect(summary.refeicoes[0].itens[0]).toEqual({
      id: "42", item: "Vitamina", quantidade: "1 copo",
    });
    expect(requests.find((path) => path.startsWith("/rest/v1/alimentacao?"))).toContain("select=id%2Cdata");
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  }
});

test("selected meal day reads only that owner's saved meals, including legacy rows and an empty day", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const requests = [];
  const connectors = {
    proxy: async (_name, path, init = {}) => {
      requests.push({ path, method: init.method ?? "GET" });
      const query = new URLSearchParams(path.split("?")[1]);
      const date = query.get("data");
      expect(query.get("owner_id")).toBe(`eq.${ownerId}`);
      const food = [
        { id: 12, data: "2026-09-25", horario: "08:10", item: "Pão",
          quantidade: "1 unidade", evento_tipo: "alimentacao" },
        { id: 13, data: "2026-09-25", horario: "08:10", item: "Queijo",
          quantidade: "2 fatias", evento_tipo: null },
        { id: 14, data: "2026-09-25", horario: "12:40", item: "Arroz",
          quantidade: "3 colheres", evento_tipo: "alimentacao" },
      ];
      return {
        ok: true,
        json: async () => path.startsWith("/rest/v1/alimentacao?") && date === "eq.2026-09-25"
          ? food : [],
      };
    },
  };
  const selected = await dailySummary(connectors, "2026-09-25", ownerId);
  expect(selected.data).toBe("2026-09-25");
  expect(selected.refeicoes).toEqual([
    { hora: "08:10", itens: [
      { id: "12", item: "Pão", quantidade: "1 unidade" },
      { id: "13", item: "Queijo", quantidade: "2 fatias" },
    ] },
    { hora: "12:40", itens: [{ id: "14", item: "Arroz", quantidade: "3 colheres" }] },
  ]);
  const empty = await dailySummary(connectors, "2026-09-24", ownerId);
  expect(empty.refeicoes).toEqual([]);
  expect(requests).toHaveLength(10);
  expect(requests.every(({ path, method }, index) =>
    method === "GET" && new URLSearchParams(path.split("?")[1]).get("data") ===
      `eq.${index < 5 ? "2026-09-25" : "2026-09-24"}`,
  )).toBe(true);
});

test("meal day queries only owned food on the exact date and ignores unrelated health failures", async () => {
  const ownerA = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const ownerB = "359d77b1-54aa-438e-90e9-d6cd25c2dc22";
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-meal-day";
  const requests = [];
  const records = [
    { id: 10, owner_id: ownerA, data: "2026-09-25", horario: "08:10",
      item: "Pão", quantidade: "1 unidade", evento_tipo: "alimentacao" },
    { id: 11, owner_id: ownerA, data: "2026-09-25", horario: "08:10",
      item: "Queijo", quantidade: null, evento_tipo: null },
    { id: 12, owner_id: ownerA, data: "2026-09-25", horario: "11:00",
      item: "Água", quantidade: "1 copo", evento_tipo: "hidratacao" },
    { id: 13, owner_id: ownerB, data: "2026-09-25", horario: "08:10",
      item: "Privado", quantidade: "1", evento_tipo: "alimentacao" },
    { id: 14, owner_id: ownerA, data: "2026-09-24", horario: "08:10",
      item: "Ontem", quantidade: "1", evento_tipo: "alimentacao" },
  ];
  const connectors = {
    proxy: async (_name, path, init = {}) => {
      requests.push(path);
      if (!path.startsWith("/rest/v1/alimentacao?")) {
        return { ok: false, status: 503, text: async () => "unrelated health table unavailable" };
      }
      expect(init.headers["X-Health-App-Secret"]).toBe("test-only-meal-day");
      const query = new URLSearchParams(path.split("?")[1]);
      expect(query.get("select")).toBe("id,data,horario,item,quantidade,evento_tipo");
      expect(query.get("order")).toBe("horario.asc,id.asc");
      return {
        ok: true,
        json: async () => records.filter((row) =>
          query.get("owner_id") === `eq.${row.owner_id}` &&
          query.get("data") === `eq.${row.data}`),
      };
    },
  };
  try {
    expect(await mealsForDay(connectors, "2026-09-25", ownerA)).toEqual({
      data: "2026-09-25",
      refeicoes: [{ hora: "08:10", itens: [
        { id: "10", item: "Pão", quantidade: "1 unidade" },
        { id: "11", item: "Queijo", quantidade: "N/A" },
      ] }],
    });
    expect(await mealsForDay(connectors, "2026-09-25", ownerB)).toEqual({
      data: "2026-09-25",
      refeicoes: [{ hora: "08:10", itens: [{ id: "13", item: "Privado", quantidade: "1" }] }],
    });
    expect(await mealsForDay(connectors, "2026-09-23", ownerA)).toEqual({
      data: "2026-09-23", refeicoes: [],
    });
    expect(requests).toHaveLength(3);
    await expect(mealsForDay(connectors, "2026-09-31", ownerA)).rejects.toThrow("AAAA-MM-DD");
    await expect(mealsForDay(connectors, "2026-09-25", "invalid")).rejects.toThrow("identificador válido");
    expect(requests).toHaveLength(3);
    await expect(dailySummary(connectors, "2026-09-25", ownerA)).rejects.toThrow("Supabase respondeu 503");
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  }
});

test("photo retries keep image encrypted until structured analysis is ready", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const id = "00000000-0000-4000-8000-000000000001";
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-secret-for-photo-retries";
  const requests = [];
  let encrypted;
  const connectors = {
    proxy: async (_name, path, init = {}) => {
      requests.push({ path, init });
      const body = init.body ? JSON.parse(init.body) : {};
      if (path.includes("/rpc/claim_health_photo_job")) {
        return { ok: true, json: async () => [{
          id, owner_id: ownerId, attempts: 1, encrypted_input: encrypted,
        }] };
      }
      if (init.method === "POST" && path === "/rest/v1/health_photo_jobs") {
        encrypted = body.encrypted_input;
        return { ok: true, json: async () => [{ id, status: "pending" }] };
      }
      if (init.method === "PATCH") {
        return { ok: true, json: async () => [{ id }] };
      }
      return { ok: true, json: async () => [] };
    },
  };
  try {
    const input = { images: [{ image_base64: "aGVsbG8=", mime_type: "image/png" }] };
    expect(await enqueuePhoto(connectors, { owner_id: ownerId, input })).toEqual({
      ok: true, job_id: id, status: "pending",
    });
    expect(encrypted).not.toContain("aGVsbG8=");
    expect((await claimPhoto(connectors)).job.input).toEqual(input);
    await finishPhoto(connectors, { id, attempts: 1, status: "pending" });
    expect(JSON.parse(requests.at(-1).init.body)).toMatchObject({
      status: "pending",
    });
    await finishPhoto(connectors, {
      id, attempts: 2, status: "ready", result: { grupos: [{ evento_tipo: "alimentacao" }] },
    });
    expect(JSON.parse(requests.at(-1).init.body)).toMatchObject({
      status: "ready", encrypted_input: null,
    });
    await cancelPhoto(connectors, { id, owner_id: ownerId });
    expect(requests.at(-1).path).toContain(`owner_id=eq.${ownerId}`);
    expect(JSON.parse(requests.at(-1).init.body)).toMatchObject({
      status: "reviewed", encrypted_input: null,
    });
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("routes mixed food and hydration groups to their own tables", async () => {
  const requests = [];
  const connectors = {
    proxy: async (name, path, init) => {
      requests.push({ name, path, init });
      const entries = JSON.parse(init.body).p_entries;
      return { ok: true, json: async () => ({
        ok: true, saved: entries.length,
        record_refs: entries.map(({ table, record }) => ({ table, import_key: record.import_key })),
      }) };
    },
  };

  const result = await saveRecordsPayload(connectors, {
    owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
    operation_id: "mixed-meal-hydration",
    grupos: [
      {
        evento_tipo: "alimentacao",
        horario: "12:35",
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

  expect(result).toMatchObject({ ok: true, saved: 2 });
  expect(result.record_refs.map((ref) => ref.table)).toEqual(["alimentacao", "hidratacao"]);
  const body = JSON.parse(requests[0].init.body);
  expect(requests.map(({ name }) => name)).toEqual(["supabase"]);
  expect(requests.map(({ path }) => path)).toEqual(["/rest/v1/rpc/save_health_records_checked"]);
  expect(body.p_entries.map(({ table }) => table)).toEqual(["alimentacao", "hidratacao"]);
  expect(body.p_entries.map(({ record }) => record)).toEqual([
      expect.objectContaining({
        item: "arroz",
        quantidade: "1 porção",
        evento_tipo: "alimentacao",
        horario: "12:35",
        owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
      }),
      expect.objectContaining({
        item: "água",
        quantidade: "500ml",
        owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
      }),
  ]);
});

test("failure of a table rolls back the whole save; retry and replay cannot duplicate rows", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const operationId = "review-message-123";
  const persisted = [];
  const outcomes = new Map();
  let failHydration = true;
  const calls = [];
  const connectors = {
    proxy: async (_name, path, init) => {
      expect(path).toBe("/rest/v1/rpc/save_health_records_checked");
      const body = JSON.parse(init.body);
      calls.push(body);
      const prior = outcomes.get(body.p_operation_id);
      if (prior) return { ok: true, json: async () => prior };
      // Model the database transaction: earlier inserts cannot be committed if
      // a later table rejects its row.
      const staged = [];
      for (const entry of body.p_entries) {
        if (entry.table === "hidratacao" && failHydration) {
          return { ok: false, status: 400, text: async () => "hydration rejected" };
        }
        staged.push(entry);
      }
      persisted.push(...staged);
      const result = {
        ok: true, saved: staged.length,
        record_refs: staged.map(({ table, record }) => ({ table, import_key: record.import_key })),
      };
      outcomes.set(body.p_operation_id, result);
      return { ok: true, json: async () => result };
    },
  };
  const payload = {
    owner_id: ownerId, operation_id: operationId,
    grupos: [
      { evento_tipo: "alimentacao", data: "2026-09-28", horario: "12:00",
        itens: [{ item: "arroz", quantidade_estimada: "1 porção" }] },
      { evento_tipo: "hidratacao", data: "2026-09-28", horario: "12:00",
        itens: [{ item: "água", quantidade_estimada: "500 ml" }] },
    ],
  };
  await expect(saveRecordsPayload(connectors, payload)).rejects.toThrow("hydration rejected");
  expect(persisted).toHaveLength(0);
  failHydration = false;
  const saved = await saveRecordsPayload(connectors, payload);
  expect(saved).toMatchObject({ ok: true, saved: 2 });
  expect(persisted).toHaveLength(2);
  expect(await saveRecordsPayload(connectors, payload)).toEqual(saved);
  expect(persisted).toHaveLength(2);
  expect(calls.map((call) => call.p_entries)).toEqual([calls[0].p_entries, calls[0].p_entries, calls[0].p_entries]);
  expect(calls.every((call) => call.p_owner_id === ownerId && call.p_operation_id === operationId)).toBe(true);
});

test("a save without an operation identifier is rejected before contacting the database", async () => {
  let called = false;
  const connectors = { proxy: async () => { called = true; } };
  await expect(saveRecordsPayload(connectors, {
    owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
    grupos: [{ evento_tipo: "alimentacao", data: "2026-09-28", horario: "12:00",
      itens: [{ item: "arroz", quantidade_estimada: "1 porção" }] }],
  })).rejects.toThrow("Confirmação inválida");
  expect(called).toBe(false);
});

test("daily water goal replaces the declared total, stays idempotent, and feeds daily and weekly summaries", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  const date = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const yesterday = new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const rows = [
    { data: date, horario: "09:00", item: "Água", quantidade: "500 ml",
      import_key: "app:8c0acaa7-ce98-4c7a-bd30-33c0e3d97cc8" },
  ];
  const outcomes = new Map();
  const calls = [];
  const connectors = {
    proxy: async (_name, path, init = {}) => {
      calls.push({ path, init });
      if (path === "/rest/v1/rpc/save_health_records_checked") {
        const { p_operation_id, p_entries } = JSON.parse(init.body);
        if (!outcomes.has(p_operation_id)) {
          const refs = [];
          for (const entry of p_entries) {
            const record = entry.record;
            const previous = rows.find((row) => row.data === record.data && row.item === "Total diário de água");
            if (previous) {
              previous.quantidade = record.quantidade;
              previous.horario = record.horario;
            } else rows.push(record);
            refs.push({ table: entry.table, import_key: previous?.import_key ?? record.import_key });
          }
          outcomes.set(p_operation_id, { ok: true, saved: p_entries.length, record_refs: refs });
        }
        return { ok: true, json: async () => outcomes.get(p_operation_id) };
      }
      const [route, query] = path.split("?");
      const params = new URLSearchParams(query);
      const table = route.split("/").at(-1);
      if (table !== "hidratacao") return { ok: true, json: async () => [] };
      if ((init.method ?? "GET") === "GET") {
        expect(params.get("owner_id")).toBe(`eq.${ownerId}`);
        const selected = rows.filter((row) =>
          (!params.has("item") || row.item === "Total diário de água") &&
          (params.get("data")?.startsWith("eq.") ? row.data === params.get("data").slice(3) :
            row.data >= params.getAll("data")[0].slice(4) &&
            row.data <= params.getAll("data")[1].slice(4)),
        );
        return { ok: true, json: async () => selected.map((row) => ({ ...row })) };
      }
    },
  };
  const declaration = (time, selectedDate = date) => ({
    owner_id: ownerId,
    operation_id: `water-${selectedDate}-${time}`,
    grupos: [{
      evento_tipo: "hidratacao", data: selectedDate, horario: time,
      itens: [{ item: "Total diário de água", quantidade_estimada: "2500 ml",
        total_diario: true, confirmado: true }],
    }],
  });
  const first = await saveRecordsPayload(connectors, declaration("11:00"));
  expect(first.saved).toBe(1);
  expect(first.record_refs[0].table).toBe("hidratacao");
  expect(rows).toHaveLength(2);
  expect((await dailySummary(connectors, date, ownerId)).agua_ml).toBe(2500);
  rows.push({ data: date, horario: "13:00", item: "Água", quantidade: "250 ml" });
  expect((await dailySummary(connectors, date, ownerId)).agua_ml).toBe(2750);
  const repeated = await saveRecordsPayload(connectors, declaration("14:00"));
  expect(repeated.record_refs).toEqual(first.record_refs);
  expect(rows).toHaveLength(3);
  expect(calls.filter((call) => call.path === "/rest/v1/rpc/save_health_records_checked")).toHaveLength(2);
  expect((await dailySummary(connectors, date, ownerId)).agua_ml).toBe(2500);
  rows.push({ data: yesterday, horario: "19:00", item: "Água", quantidade: "700 ml" });
  await saveRecordsPayload(connectors, declaration("11:00", yesterday));
  expect(rows.find((row) => row.data === yesterday && row.item === "Total diário de água").horario).toBe("23:59");
  expect((await dailySummary(connectors, yesterday, ownerId)).agua_ml).toBe(2500);
  const week = await weeklySummary(connectors, date, ownerId);
  expect(week.dias.at(-1).agua_ml).toBe(2500);
  expect(week.dias.at(-2).agua_ml).toBe(2500);
});

test("consolidates sleep stages into one total sleep record", async () => {
  const requests = [];
  const connectors = {
    proxy: async (name, path, init) => {
      requests.push({ name, path, init });
      return { ok: true, json: async () => ({
        ok: true, saved: 1, record_refs: [{ table: "sono", import_key: JSON.parse(init.body).p_entries[0].record.import_key }],
      }) };
    },
  };

  const result = await saveRecordsPayload(connectors, {
    owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
    operation_id: "sleep-consolidation",
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

  expect(result).toMatchObject({ ok: true, saved: 1 });
  expect(result.record_refs[0]).toEqual({
    table: "sono", import_key: JSON.parse(requests[0].init.body).p_entries[0].record.import_key,
  });
  expect(requests).toHaveLength(1);
  expect(JSON.parse(requests[0].init.body).p_entries[0].record).toEqual(
    expect.objectContaining({
      duracao_minutos: "420 min",
      sono_profundo_min: "60 min",
      sono_leve_min: "240 min",
      sono_rem_min: "120 min",
      acordado_min: "15 min",
    }),
  );
});

test("exercise save persists reviewed structured details and preserves legacy summary fields", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-exercise-details";
  const savedRequests = [];
  const connectors = {
    proxy: async (_name, path, init = {}) => {
      expect(path).toBe("/rest/v1/rpc/save_health_records_checked");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body);
      savedRequests.push(body);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          saved: body.p_entries.length,
          record_refs: body.p_entries.map(({ table, record }) => ({
            table, import_key: record.import_key,
          })),
        }),
      };
    },
  };
  const details = {
    inicio: "14:34",
    fim: "15:12",
    duracao_segundos: 2_296,
    intensidade: "Moderada",
    calorias_estimadas: 238,
    distancia_km: 3.29,
    passos: 4_387,
    pontos_cardio: 37,
    ritmo_min_km: "11:35/km",
    ritmos_parciais: "1 km: 11:44; 2 km: 10:32; 3,65 km: 12:17",
  };
  try {
    await saveRecordsPayload(connectors, {
      owner_id: ownerId,
      operation_id: "exercise-review-complete",
      grupos: [{
        evento_tipo: "exercicio",
        data: "2026-09-30",
        horario: details.inicio,
        itens: [{
          item: "Caminhada",
          quantidade_estimada: "38 min",
          confirmado: true,
          exercicio: details,
        }],
      }],
    });
    const record = savedRequests[0].p_entries[0].record;
    expect(record).toMatchObject({
      data: "2026-09-30",
      tipo: "Caminhada",
      duracao_min: "38",
      intensidade: "Moderada",
      calorias_estimadas: "238",
      detalhes_exercicio: details,
    });

    await saveRecordsPayload(connectors, {
      owner_id: ownerId,
      operation_id: "exercise-review-cleared-duration",
      grupos: [{
        evento_tipo: "exercicio",
        data: "2026-09-30",
        itens: [{
          item: "Caminhada",
          quantidade_estimada: "38 min",
          confirmado: true,
          exercicio: {
            duracao_segundos: null,
            intensidade: null,
            calorias_estimadas: null,
          },
        }],
      }],
    });
    expect(savedRequests[1].p_entries[0].record).toMatchObject({
      duracao_min: null,
      intensidade: null,
      calorias_estimadas: null,
      detalhes_exercicio: {
        duracao_segundos: null,
        intensidade: null,
        calorias_estimadas: null,
      },
    });

    await saveRecordsPayload(connectors, {
      owner_id: ownerId,
      operation_id: "exercise-review-legacy",
      grupos: [{
        evento_tipo: "exercicio",
        data: "2026-09-29",
        itens: [{
          item: "Corrida",
          quantidade_estimada: "30 min",
          confirmado: true,
        }],
      }],
    });
    expect(savedRequests[2].p_entries[0].record).toMatchObject({
      data: "2026-09-29",
      tipo: "Corrida",
      duracao_min: "30 min",
      detalhes_exercicio: null,
    });
    await expect(saveRecordsPayload(connectors, {
      owner_id: ownerId,
      operation_id: "exercise-review-invalid-duration",
      evento_tipo: "exercicio",
      itens: [{
        item: "Corrida",
        quantidade_estimada: "30 min",
        confirmado: true,
        exercicio: { duracao_segundos: 0 },
      }],
    })).rejects.toThrow("valores numéricos do exercício");
    await expect(saveRecordsPayload(connectors, {
      owner_id: ownerId,
      operation_id: "exercise-review-invalid",
      evento_tipo: "exercicio",
      itens: [{
        item: "Corrida",
        quantidade_estimada: "30 min",
        confirmado: true,
        exercicio: { zona_nao_revisada: 5 },
      }],
    })).rejects.toThrow("campo de exercício inválido");
    expect(savedRequests).toHaveLength(3);
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  }
});

test("saved analysis combines the fixed previous week with refreshed owned records from today", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const foodKey = "app:ca22a124-32df-4117-83a2-3dbe0011569f";
  const waterKey = "app:bd435fc7-8f22-4c89-a3f7-d06bf16a247c";
  const requests = [];
  let lunchQuantity = "1 porção";
  let examStatus = "confirmed";
  const snapshot = {
    ok: true, para_dia: "2026-09-30",
    periodo: { inicio: "2026-09-23", fim: "2026-09-29" },
    gerado_em: "2026-09-30T03:00:00Z", origem: "fechamento_diario",
    resumo: { dias: Array.from({ length: 7 }, (_, i) => ({ data: `2026-09-${23 + i}` })) },
  };
  const connectors = {
    proxy: async (_name, path, init) => {
      requests.push(path);
      if (path === "/rest/v1/rpc/health_daily_analysis_context") {
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body)).toEqual({ p_owner_id: ownerId });
        return { ok: true, json: async () => snapshot };
      }
      expect(init?.method ?? "GET").toBe("GET");
      const [route, query] = path.split("?");
      const params = new URLSearchParams(query);
      expect(params.get("owner_id")).toBe(`eq.${ownerId}`);
      const table = route.split("/").at(-1);
      if (table === "health_contexts") {
        return { ok: true, json: async () => [{
          clinical_profile: "Perfil fictício: adulto com hipertensão",
          gem_instructions: "Explique a principal prioridade e uma ação prática",
        }] };
      }
      if (table === "health_exams") {
        expect(params.get("status")).toBe("eq.confirmed");
        expect(params.get("limit")).toBe("10");
        return { ok: true, json: async () => [{
          exam_type: "Laboratorial", exam_date: "2026-09-01",
          extracted_data: { marcadores: [{ nome: "LDL", valor: "140 mg/dL" }] },
          status: examStatus,
        }] };
      }
      if (params.has("data")) {
        expect(params.get("data")).toBe("eq.2026-09-30");
        expect(params.get("order")).toBe("id.asc");
        expect(params.get("limit")).toBe("500");
        return { ok: true, json: async () => table === "alimentacao" ? [{
          data: "2026-09-30", horario: "12:00", item: "carne do almoço",
          quantidade: lunchQuantity, import_key: "app:today-lunch",
        }] : [] };
      }
      const rows = table === "alimentacao"
        ? [
            { data: "2026-09-28", item: "arroz corrigido", quantidade: "1 porção", import_key: foodKey },
            { data: "2026-09-22", item: "banana", quantidade: "1", import_key: "app:historic" },
          ]
        : table === "hidratacao"
          ? [{ data: "2026-09-28", item: "água", quantidade: "250 ml", import_key: waterKey }]
          : [];
      const selected = params.has("import_key")
        ? rows.filter((row) => params.get("import_key").includes(row.import_key))
        : rows;
      return { ok: true, json: async () => selected };
    },
  };
  const context = await savedSevenDayAnalysisContext(connectors, {
    owner_id: ownerId,
    record_refs: [
      { table: "alimentacao", import_key: foodKey },
      { table: "hidratacao", import_key: waterKey },
    ],
  });
  expect(context.periodo).toEqual(snapshot.periodo);
  expect(context.para_dia).toBe("2026-09-30");
  expect(context.confirmados.map(({ tipo, registros }) => [tipo, registros.length])).toEqual([
    ["alimentacao", 1], ["hidratacao", 1],
  ]);
  expect(context.confirmados[0].registros[0].item).toBe("arroz corrigido");
  expect(context.resumo).toEqual(snapshot.resumo);
  expect(context.ultimos_sete_dias).toBeUndefined();
  expect(JSON.stringify(context)).not.toContain("import_key");
  expect(context.registros_do_dia.data).toBe("2026-09-30");
  expect(context.registros_do_dia.registros.alimentacao[0].item).toBe("carne do almoço");
  expect(context.registros_do_dia.registros.alimentacao[0].quantidade).toBe("1 porção");
  expect(context.perfil_clinico).toContain("hipertensão");
  expect(context.instrucoes_do_gem).toContain("ação prática");
  expect(context.exames_confirmados_recentes[0].status).toBe("confirmed");
  expect(JSON.stringify(context)).not.toContain("image_base64");
  expect(requests).toHaveLength(10);
  lunchQuantity = "2 porções corrigidas";
  const repeated = await savedSevenDayAnalysisContext(connectors, {
    owner_id: ownerId, record_refs: [{ table: "hidratacao", import_key: waterKey }],
  });
  expect(repeated.resumo).toEqual(context.resumo);
  expect(repeated.gerado_em).toBe(context.gerado_em);
  expect(repeated.confirmados).toHaveLength(1);
  expect(repeated.confirmados[0].tipo).toBe("hidratacao");
  expect(repeated.registros_do_dia.registros.alimentacao[0].quantidade).toBe("2 porções corrigidas");
  expect(context.registros_do_dia.registros.alimentacao[0].quantidade).toBe("1 porção");
  expect(requests).toHaveLength(19);
  expect(requests.some((path) => path.includes("gte."))).toBe(false);
  examStatus = "pending_review";
  await expect(savedSevenDayAnalysisContext(connectors, {
    owner_id: ownerId, record_refs: [{ table: "hidratacao", import_key: waterKey }],
  })).rejects.toThrow("exames confirmados");
  await expect(savedSevenDayAnalysisContext({
    proxy: async () => ({ ok: true, json: async () => [] }),
  }, { owner_id: ownerId, record_refs: [{ table: "alimentacao", import_key: foodKey }] }))
    .rejects.toThrow("não encontrados");
  await expect(savedSevenDayAnalysisContext(connectors, {
    owner_id: ownerId, record_refs: [{ table: "health_exams", import_key: foodKey }],
  })).rejects.toThrow("inválidas");
});

test("today's context paginates rather than dropping records and rejects rows from another day", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const pages = [];
  const result = await currentDayAnalysisRecords({
    proxy: async (_name, path) => {
      const [route, query] = path.split("?");
      const params = new URLSearchParams(query);
      expect(params.get("owner_id")).toBe(`eq.${ownerId}`);
      expect(params.get("data")).toBe("eq.2026-09-30");
      if (!route.endsWith("/alimentacao")) return { ok: true, json: async () => [] };
      const offset = Number(params.get("offset"));
      pages.push(offset);
      return { ok: true, json: async () => Array.from({ length: offset === 0 ? 500 : 1 }, (_, i) => ({
        data: "2026-09-30", item: `Alimento ${offset + i}`, import_key: `internal-${offset + i}`,
      })) };
    },
  }, ownerId, "2026-09-30");
  expect(pages).toEqual([0, 500]);
  expect(result.registros.alimentacao).toHaveLength(501);
  expect(JSON.stringify(result)).not.toContain("import_key");
  await expect(currentDayAnalysisRecords({
    proxy: async () => ({ ok: true, json: async () => [{ data: "2026-09-29" }] }),
  }, ownerId, "2026-09-30")).rejects.toThrow("com segurança");
});

test("daily summary rejects an incomplete calendar window instead of analyzing partial context", async () => {
  await expect(dailyAnalysisSummary({
    proxy: async () => ({
      ok: true, json: async () => ({
        ok: true, para_dia: "2026-09-30",
        periodo: { inicio: "2026-09-23", fim: "2026-09-29" },
        resumo: { dias: [{ data: "2026-09-29" }] },
      }),
    }),
  }, "8e165e4f-59bc-4b94-9508-4f596ee87584")).rejects.toThrow("com segurança");
});
test("preserves sleep phase fields provided on the total sleep item", async () => {
  const requests = [];
  const connectors = {
    proxy: async (_name, path, init) => {
      requests.push({ path, init });
      return { ok: true, json: async () => ({ ok: true, saved: 1, record_refs: [] }) };
    },
  };

  await saveRecordsPayload(connectors, {
    owner_id: "8e165e4f-59bc-4b94-9508-4f596ee87584",
    operation_id: "sleep-phase-preservation",
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

  expect(JSON.parse(requests[0].init.body).p_entries[0].record).toEqual(
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

test("meal week stays available when unrelated weekly health tables fail", async () => {
  const ownerId = "8e165e4f-59bc-4b94-9508-4f596ee87584";
  const otherOwner = "3d9ff589-7eca-483a-9043-f3c665734320";
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-meal-week";
  const requests = [];
  const rows = [
    { owner_id: ownerId, data: "2026-09-22", horario: "08:10", evento_tipo: "alimentacao" },
    { owner_id: ownerId, data: "2026-09-22", horario: "08:10", evento_tipo: null },
    { owner_id: ownerId, data: "2026-09-28", horario: "12:40", evento_tipo: "alimentacao" },
    { owner_id: ownerId, data: "2026-09-28", horario: "13:00", evento_tipo: "hidratacao" },
    { owner_id: otherOwner, data: "2026-09-28", horario: "18:00", evento_tipo: "alimentacao" },
    { owner_id: ownerId, data: "2026-09-21", horario: "18:00", evento_tipo: "alimentacao" },
  ];
  const connectors = {
    proxy: async (_name, path, init = {}) => {
      requests.push(path);
      if (!path.startsWith("/rest/v1/alimentacao?")) {
        return { ok: false, status: 400, text: async () => "unrelated health table unavailable" };
      }
      expect(init.headers["X-Health-App-Secret"]).toBe("test-only-meal-week");
      const params = new URLSearchParams(path.split("?")[1]);
      expect(params.get("owner_id")).toBe(`eq.${ownerId}`);
      expect(params.getAll("data")).toEqual(["gte.2026-09-22", "lte.2026-09-28"]);
      expect(params.get("select")).toBe("data,horario,evento_tipo");
      return {
        ok: true,
        json: async () => rows.filter((row) =>
          row.owner_id === ownerId && row.data >= "2026-09-22" && row.data <= "2026-09-28"),
      };
    },
  };
  try {
    await expect(weeklySummary({
      proxy: async () => ({
        ok: false, status: 400, text: async () => "unrelated health table unavailable",
      }),
    }, "2026-09-28", ownerId)).rejects.toThrow();
    const result = await weeklyMeals(connectors, "2026-09-28", ownerId);
    expect(requests).toHaveLength(1);
    expect(result.periodo).toEqual({ inicio: "2026-09-22", fim: "2026-09-28" });
    expect(result.dias.map((day) => day.data)).toEqual([
      "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25",
      "2026-09-26", "2026-09-27", "2026-09-28",
    ]);
    expect(result.dias.map((day) => day.refeicoes)).toEqual([1, 0, 0, 0, 0, 0, 1]);
    expect(result.tendencia).toContain("refeições");
    requests.length = 0;
    await expect(weeklyMeals(connectors, "2026-02-30", ownerId)).rejects.toThrow();
    expect(requests).toHaveLength(0);
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  }
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
