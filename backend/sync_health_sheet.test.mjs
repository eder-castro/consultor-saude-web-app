import { describe, expect, test } from "bun:test";
import { SHEET_SCHEMAS, syncTable } from "./sync_health_sheet.mjs";

const SOURCE_ID = "test-spreadsheet";

class FakeConnectors {
  constructor() {
    this.tables = new Map(Object.keys(SHEET_SCHEMAS).map((table) => [table, []]));
  }

  async proxy(connector, path, init = {}) {
    expect(connector).toBe("supabase");
    const url = new URL(path, "https://supabase.test");
    const table = url.pathname.split("/").at(-1);
    const rows = this.tables.get(table);
    expect(rows).toBeArray();

    if ((init.method ?? "GET") === "GET") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 1000);
      return Response.json(rows.slice(offset, offset + limit));
    }

    const requested = JSON.parse(init.body);
    const existingKeys = new Set(rows.map((record) => record.import_key));
    const inserted = requested.filter((record) => !existingKeys.has(record.import_key));
    rows.push(...inserted);
    return Response.json(inserted, { status: 201 });
  }
}

function recordsFor(table, count) {
  const headers = SHEET_SCHEMAS[table].headers;
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const record = Object.fromEntries(
      headers.map((header) => {
        if (header === "data") return [header, "2026-08-27"];
        if (["horario", "inicio", "fim", "hora"].includes(header)) {
          return [header, `${String(number % 24).padStart(2, "0")}:00`];
        }
        return [header, `${header}-${number}`];
      }),
    );
    return {
      ...record,
      source_file_id: SOURCE_ID,
      ...(table === "alimentacao" ? { evento_tipo: "alimentacao" } : {}),
    };
  });
}

describe("multi-tab health sheet synchronization", () => {
  test("inserts two batches in every table and ignores them on retry", async () => {
    const connectors = new FakeConnectors();

    for (const table of Object.keys(SHEET_SCHEMAS)) {
      const records = recordsFor(table, 205);
      const first = await syncTable(connectors, table, records, [], SOURCE_ID);
      expect(first).toMatchObject({
        table,
        new_rows: 205,
        ignored_rows: 0,
        invalid_rows: 0,
        batches: 2,
      });

      const retry = await syncTable(connectors, table, records, [], SOURCE_ID);
      expect(retry).toMatchObject({
        table,
        new_rows: 0,
        ignored_rows: 205,
        invalid_rows: 0,
        batches: 0,
      });
      expect(connectors.tables.get(table)).toHaveLength(205);
    }
  });
});
