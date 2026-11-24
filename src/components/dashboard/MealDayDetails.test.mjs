import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../test/setup-dom.mjs";

const { act, cleanup, fireEvent, render, screen, waitFor } =
  await import("@testing-library/react");
const { MealDayDetails } = await import("./MealDayDetails.tsx");
const originalFetch = globalThis.fetch;
const date = "2026-09-28";
let client;
let responses;
let requests;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function mountDay() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } },
  });
  render(createElement(QueryClientProvider, { client },
    createElement("div", { "data-testid": "weekly-detail" },
      createElement(MealDayDetails, { date }))));
}

beforeEach(() => {
  localStorage.clear();
  requests = [];
  responses = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const respond = responses.shift();
    if (!respond) throw new Error(`Unexpected meals request: ${url}`);
    return respond();
  };
});

afterEach(() => {
  cleanup();
  client?.clear();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

test("retry keeps the selected day open, shows progress, then distinguishes another error from empty meals", async () => {
  let finishRetry;
  responses = [
    () => jsonResponse({ detail: "Serviço temporariamente indisponível." }, 503),
    () => new Promise((resolve) => { finishRetry = resolve; }),
    () => jsonResponse({ data: date, refeicoes: [] }),
  ];
  mountDay();

  expect((await screen.findByRole("alert")).textContent)
    .toContain("Serviço temporariamente indisponível.");
  expect(screen.getByRole("heading", { level: 3 }).textContent).toContain("Refeições de");
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await screen.findByRole("status");
  expect(screen.getByRole("status").textContent).toContain("Tentando carregar novamente");
  expect(screen.getByTestId("weekly-detail")).toBeTruthy();
  expect(screen.getByRole("heading", { level: 3 }).textContent).toContain("Refeições de");
  await waitFor(() => expect(finishRetry).toBeDefined());

  await act(async () => {
    finishRetry(jsonResponse({ detail: "Ainda indisponível." }, 503));
  });
  expect((await screen.findByRole("alert")).textContent).toContain("Ainda indisponível.");
  expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();
  expect(screen.queryByText("Nenhuma refeição registrada neste dia.")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await screen.findByText("Nenhuma refeição registrada neste dia.");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByTestId("weekly-detail")).toBeTruthy();
  expect(requests).toEqual(Array(3).fill(`/api/meals-for-day?data=${date}`));
});

test("a response for another date can be retried without changing the selected day", async () => {
  responses = [
    () => jsonResponse({ data: "2026-09-27", refeicoes: [] }),
    () => jsonResponse({ data: date, refeicoes: [] }),
  ];
  mountDay();
  expect((await screen.findByRole("alert")).textContent)
    .toContain("não correspondem ao dia selecionado");
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await screen.findByText("Nenhuma refeição registrada neste dia.");
  expect(requests).toEqual(Array(2).fill(`/api/meals-for-day?data=${date}`));
});