import { expect, test } from "bun:test";
import { datedRecords, changeRecordDates } from "./record_dates.mjs";

const owner = "8e165e4f-59bc-4b94-9508-4f596ee87584";
test("date correction listing is owner/date scoped across all health types and refuses mismatched days", async () => {
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-date-list";
  const paths = [];
  const connectors = { proxy: async (_name, path) => {
    paths.push(path);
    return { ok: true, json: async () => path.includes("/sono?")
      ? [{ id: 42, data: "2026-10-06", inicio: "23:40", duracao_minutos: "345 min" }] : [] };
  } };
  try {
    const result = await datedRecords(connectors, { owner_id: owner, data: "2026-10-06" });
    expect(result.registros).toEqual([{ table: "sono", id: "42", evento_tipo: "sono", item: "Sono total", quantidade: "345 min", horario: "23:40" }]);
    expect(paths).toHaveLength(5);
    for (const path of paths) {
      expect(path).toContain(`owner_id=eq.${owner}`);
      expect(path).toContain("data=eq.2026-10-06");
    }
    await expect(datedRecords(connectors, { owner_id: owner, data: "2026-02-30" })).rejects.toThrow();
    await expect(datedRecords({ proxy: async () => ({ ok: true, json: async () => [{ id: 1, data: "2026-10-05" }] }) }, { owner_id: owner, data: "2026-10-06" })).rejects.toThrow();
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  }
});

test("date correction uses one owner-scoped atomic RPC with the reviewed references and stable operation ID", async () => {
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-date-edit";
  const calls = [];
  const connectors = { proxy: async (_name, path, init) => {
    calls.push({ path, init });
    return { ok: true, json: async () => ({ ok: true, updated: 2 }) };
  } };
  const input = { owner_id: owner, operation_id: "11111111-1111-4111-8111-111111111111", source_date: "2026-10-06", target_date: "2026-10-05",
    records: [{ table: "alimentacao", id: "42" }, { table: "sono", id: "43" }] };
  try {
    expect(await changeRecordDates(connectors, input)).toEqual({ ok: true, updated: 2 });
    expect(calls[0].path).toBe("/rest/v1/rpc/change_health_record_dates");
    expect(JSON.parse(calls[0].init.body)).toEqual({
      p_owner_id: owner, p_operation_id: input.operation_id,
      p_source_date: input.source_date, p_target_date: input.target_date, p_records: input.records,
    });
    for (const records of [[], [{ table: "health_users", id: "1" }], [input.records[0], input.records[0]]]) {
      await expect(changeRecordDates(connectors, { ...input, records })).rejects.toThrow();
    }
    expect(calls).toHaveLength(1);
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  }
});
