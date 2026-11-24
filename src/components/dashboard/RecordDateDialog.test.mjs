import { afterAll, afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../test/setup-dom.mjs";

const { cleanup, render, screen, fireEvent, waitFor } = await import("@testing-library/react");
const { RecordDateDialog } = await import("./RecordDateDialog");
const originalFetch = globalThis.fetch;
let client;
afterEach(() => { cleanup(); client?.clear(); });
afterAll(() => { globalThis.fetch = originalFetch; });

function mount() {
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(createElement(QueryClientProvider, { client }, createElement(RecordDateDialog)));
}

test("date changes require a reviewed selection and keep identical operation IDs on failed-save retry", async () => {
  const writes = [];
  let date;
  let moved = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/dated-records?")) {
      date = new URL(String(url), "https://example.test").searchParams.get("data");
      return new Response(JSON.stringify({ data: date, registros: moved ? [] : [
        { table: "alimentacao", id: "42", evento_tipo: "alimentacao", item: "Arroz", quantidade: "3 colheres", horario: "00:15" },
        { table: "sono", id: "43", evento_tipo: "sono", item: "Sono total", quantidade: "345 min", horario: null },
      ] }), { headers: { "Content-Type": "application/json" } });
    }
    writes.push(JSON.parse(init.body));
    if (writes.length === 1) return new Response(JSON.stringify({ detail: "Falha temporária." }), { status: 503 });
    moved = true;
    return new Response(JSON.stringify({ ok: true, updated: 2 }));
  };
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Corrigir datas de registros" }));
  await screen.findByText("Arroz");
  expect(writes).toHaveLength(0);
  expect(screen.getByTestId("button-review-record-date").disabled).toBe(true);
  fireEvent.click(screen.getByTestId("checkbox-record-42"));
  fireEvent.click(screen.getByTestId("checkbox-record-43"));
  fireEvent.click(screen.getByTestId("button-review-record-date"));
  expect(screen.getByTestId("button-confirm-record-date")).toBeTruthy();
  expect(writes).toHaveLength(0);
  expect(screen.getByTestId("checkbox-record-42").disabled).toBe(true);
  fireEvent.click(screen.getByTestId("button-confirm-record-date"));
  expect((await screen.findByRole("alert")).textContent).toContain("Falha temporária.");
  fireEvent.click(screen.getByTestId("button-confirm-record-date"));
  await waitFor(() => expect(screen.getByTestId("status-record-date-success").textContent).toContain("2 registros"));
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  expect(writes[0].source_date).toBe(date);
  expect(writes[0].target_date < writes[0].source_date).toBe(true);
  expect(writes[0].records).toEqual([{ table: "alimentacao", id: "42" }, { table: "sono", id: "43" }]);
  expect(writes[0].operation_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(screen.queryByTestId("button-confirm-record-date")).toBeNull();
});

test("records from a different date never become selectable", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ data: "2000-01-01", registros: [
    { table: "peso", id: "99", evento_tipo: "peso", item: "Peso", quantidade: "70 kg", horario: "10:00" },
  ] }));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Corrigir datas de registros" }));
  expect((await screen.findByRole("alert")).textContent).toContain("não corresponde ao dia escolhido");
  expect(screen.queryByTestId("checkbox-record-99")).toBeNull();
});
