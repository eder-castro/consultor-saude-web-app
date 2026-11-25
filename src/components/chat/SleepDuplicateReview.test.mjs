import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import "../../test/setup-dom.mjs";
const { render, cleanup, screen, fireEvent, waitFor } = await import("@testing-library/react");
const { ValidationCard } = await import("./ValidationCard");
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });
const payload = { grupos: [{
  evento_tipo: "sono", data: "2026-10-11", data_imagem: "2026-10-11",
  itens: [{ id: "sleep", item: "Sono total", confirmado: true, quantidade_estimada: "345 min",
    sono_profundo_min: "117 min", sono_leve_min: "167 min", sono_rem_min: "61 min", acordado_min: "5 min" }],
}] };
const response = value => new Response(JSON.stringify(value));
const approval = () => screen.getByRole("checkbox", { name: /Substituir o sono salvo/ });
const confirm = () => screen.getByRole("button", { name: "Salvar" });

test("duplicate photo uses event/image date, requires opt-in and retries the identical replacement after a lost response", async () => {
  localStorage.clear();
  const writes = [], dates = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/sleep-day-status")) {
      const data = new URL(String(url), "https://example.test").searchParams.get("data");
      dates.push(data);
      return response({ data, count: 2, token: "a".repeat(32) });
    }
    writes.push(JSON.parse(init.body));
    if (writes.length === 1) return new Response(JSON.stringify({ detail: "Falha temporária" }), { status: 503 });
    return response({ ok: true, record_refs: [{ table: "sono", import_key: "app:new-sleep" }] });
  };
  let resolved;
  render(createElement(ValidationCard, { payload, operationId: "sleep-replacement", status: "pending",
    onResolved: (...args) => { resolved = args; } }));
  expect(confirm().disabled).toBe(true);
  expect((await screen.findByRole("checkbox", { name: /Substituir o sono salvo/ })).checked).toBe(false);
  expect(screen.getByText(/Já existe sono salvo/).textContent).toContain("11/10/2026");
  expect(dates).toEqual(["2026-10-11"]);
  expect(confirm().disabled).toBe(true);
  expect(writes).toHaveLength(0);
  fireEvent.click(approval());
  fireEvent.click(confirm());
  await screen.findByText(/Não foi possível salvar ainda/);
  expect(approval().checked).toBe(true);
  fireEvent.click(confirm());
  await waitFor(() => expect(resolved?.[0]).toBe("saved"));
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0].sleep_replacements).toEqual([{ data: "2026-10-11", expected_token: "a".repeat(32) }]);
  expect(writes[0].grupos[0].data).toBe("2026-10-11");
  expect(writes[0].grupos[0].itens).toHaveLength(1);
});

test("a concurrently changed saved sleep requires a fresh review and never silently replaces it", async () => {
  localStorage.clear();
  let reads = 0, writes = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/sleep-day-status")) {
      reads++;
      return response({ data: "2026-10-11", count: 1, token: (reads === 1 ? "a" : "b").repeat(32) });
    }
    writes++;
    return new Response(JSON.stringify({ detail: "O sono salvo mudou. Confira novamente." }), { status: 409 });
  };
  render(createElement(ValidationCard, { payload, operationId: "sleep-changed", status: "pending", onResolved() {} }));
  await screen.findByRole("checkbox", { name: /Substituir o sono salvo/ });
  fireEvent.click(approval());
  fireEvent.click(confirm());
  await waitFor(() => expect(reads).toBe(2));
  await waitFor(() => expect(approval().checked).toBe(false));
  expect(confirm().disabled).toBe(true);
  expect(writes).toBe(1);
  expect(screen.getByText(/Não foi possível salvar ainda/).textContent).toContain("sono salvo mudou");
});
