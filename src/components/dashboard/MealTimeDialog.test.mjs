import { afterEach, afterAll, expect, test } from "bun:test";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../test/setup-dom.mjs";

const { cleanup, render, screen, fireEvent, waitFor } = await import("@testing-library/react");
const { MealTimeDialog } = await import("./MealTimeDialog");
const originalFetch = globalThis.fetch;
let client;
afterEach(() => { cleanup(); client?.clear(); });
afterAll(() => { globalThis.fetch = originalFetch; });

function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(createElement(QueryClientProvider, { client },
    createElement(MealTimeDialog, { meal: { hora: "21:10", itens: [
      { id: "42", item: "Arroz", quantidade: "3 colheres" },
      { id: "43", item: "Feijão", quantidade: "1 concha" },
    ] } })));
}

test("saved meal time form submits every selected ID, refreshes views and closes on success", async () => {
  localStorage.clear();
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  };
  mount();
  const invalidated = [];
  client.invalidateQueries = async ({ queryKey }) => { invalidated.push(queryKey[0]); };
  fireEvent.click(screen.getByRole("button", { name: "Editar horário da refeição das 21:10" }));
  expect(screen.getByText("Arroz (3 colheres)")).toBeTruthy();
  const input = screen.getByLabelText("Horário em que você comeu");
  expect(input.value).toBe("21:10");
  fireEvent.change(input, { target: { value: "15:30" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("/api/meal-times");
  expect(requests[0].init.method).toBe("PATCH");
  expect(JSON.parse(requests[0].init.body)).toEqual({ record_ids: ["42", "43"], horario: "15:30" });
  expect(invalidated).toEqual(["daily-summary", "meals-for-day", "weekly-summary", "weekly-meals", "health-context"]);
});

test("failed time correction keeps the form and requested time visible for retry", async () => {
  localStorage.clear();
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: "Serviço indisponível." }), {
    status: 503, headers: { "Content-Type": "application/json" },
  });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Editar horário da refeição das 21:10" }));
  fireEvent.change(screen.getByLabelText("Horário em que você comeu"), { target: { value: "15:30" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Serviço indisponível.");
  expect(screen.getByLabelText("Horário em que você comeu").value).toBe("15:30");
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("button", { name: "Editar horário da refeição das 21:10" }));
  expect(screen.getByLabelText("Horário em que você comeu").value).toBe("21:10");
});
