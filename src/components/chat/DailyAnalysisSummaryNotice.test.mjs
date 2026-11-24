import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../test/setup-dom.mjs";

mock.module("@/providers/auth-context", () => ({
  useAuth: () => ({ user: { id: "summary-owner" } }),
}));
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { DailyAnalysisSummaryNotice } = await import("./DailyAnalysisSummaryNotice");
const { saoPauloDay } = await import("@/lib/daily-analysis-summary");
const originalFetch = globalThis.fetch;
let client;
let requests;
let respond;

function snapshot() {
  const today = saoPauloDay();
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + i - 7);
    return {
      data: date.toISOString().slice(0, 10), agua_ml: null, refeicoes: 0,
      alimentos: [], alimentos_omitidos: 0, exercicio_min: null,
      atividades: [], atividades_omitidas: 0,
      sono_min: null, peso_kg: null, avisos: [],
    };
  });
  return {
    ok: true, para_dia: today, periodo: { inicio: days[0].data, fim: days[6].data },
    gerado_em: `${today}T03:00:00Z`, origem: "fechamento_diario", resumo: { dias: days },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } },
  });
  render(createElement(QueryClientProvider, { client }, createElement(DailyAnalysisSummaryNotice)));
}

beforeEach(() => {
  localStorage.clear();
  requests = 0;
  respond = () => jsonResponse(snapshot());
  globalThis.fetch = async (url) => {
    expect(String(url)).toBe("/api/daily-analysis-summary");
    requests += 1;
    return respond();
  };
});
afterEach(() => { cleanup(); client?.clear(); });
afterAll(() => { globalThis.fetch = originalFetch; });

test("shows the fixed prior-week context and keeps missing records distinct from measured zero", async () => {
  mount();
  await screen.findByText(/Contexto de hoje:/);
  expect(screen.getByText(/comenta somente o novo envio/)).toBeTruthy();
  expect(document.querySelectorAll("details li")).toHaveLength(7);
  expect(document.querySelector("details li").textContent).toContain("Água: sem registro");
  expect(requests).toBe(1);
});

test("loads daily analysis context in the background without a blocking loading notice", async () => {
  let finish;
  respond = () => new Promise((resolve) => { finish = resolve; });
  mount();
  await waitFor(() => expect(requests).toBe(1));
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText(/Preparando o contexto/)).toBeNull();
  expect(screen.queryByText(/Contexto de hoje:/)).toBeNull();
  finish(jsonResponse(snapshot()));
  await screen.findByText(/Contexto de hoje:/);
  expect(requests).toBe(1);
});

test("failed context loading can be retried without pretending a summary exists", async () => {
  respond = () => jsonResponse({ detail: "Indisponível." }, 503);
  mount();
  await screen.findByRole("button", { name: "Tentar carregar contexto" });
  expect(screen.queryByText(/Contexto de hoje:/)).toBeNull();
  respond = () => jsonResponse(snapshot());
  fireEvent.click(screen.getByRole("button", { name: "Tentar carregar contexto" }));
  await screen.findByText(/Contexto de hoje:/);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Tentar carregar contexto" })).toBeNull());
  expect(requests).toBe(3);
});