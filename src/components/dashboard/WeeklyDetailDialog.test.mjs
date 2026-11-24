import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import "../../test/setup-dom.mjs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { sessionDay } from "@/lib/session-state";

globalThis.requestAnimationFrame ??= (callback) => setTimeout(() => callback(performance.now()), 16);
globalThis.cancelAnimationFrame ??= (timer) => clearTimeout(timer);
globalThis.ResizeObserver ??= class {
  constructor(callback) { this.callback = callback; }
  observe() { this.callback([{ contentRect: { width: 360, height: 240 } }]); }
  unobserve() {}
  disconnect() {}
};
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { WeeklyDetailDialog } = await import("./WeeklyDetailDialog");
const originalFetch = globalThis.fetch;
let client;
afterEach(() => {
  cleanup();
  client?.clear();
  globalThis.fetch = originalFetch;
});

test("opening sleep and meal history enables their queries after initially mounting closed", async () => {
  const day = sessionDay();
  const weekly = {
    ok: true, periodo: { inicio: day, fim: day },
    dias: [{
      data: day, agua_ml: 0, refeicoes: 1, exercicio_min: 0, peso_kg: 80,
      sono_horas: 7, sono_profundo_horas: 1, sono_leve_horas: 5, sono_rem_horas: 1,
      acordado_horas: 5 / 60, sono_niveis: { profundo: "alto", leve: "normal", rem: "baixo" },
    }],
    tendencias: { agua: "", refeicoes: "", exercicio: "", sono: "Durações registradas", peso: "" },
  };
  weekly.dias = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${day}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (6 - index));
    return { ...weekly.dias[0], data: date.toISOString().slice(0, 10) };
  });
  weekly.periodo.inicio = weekly.dias[0].data;
  const requests = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    requests.push(path);
    const body = path.endsWith("/weekly-summary") ? weekly
      : path.endsWith("/weekly-meals") ? {
        ok: true, periodo: weekly.periodo, dias: weekly.dias.map((entry) => ({ data: entry.data, refeicoes: 1 })), tendencia: "Refeições registradas",
      } : path.endsWith("/sleep-records") ? { ok: true, registros: [] } : {};
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (metric) => createElement(QueryClientProvider, { client },
    createElement(WeeklyDetailDialog, { metric, onOpenChange: () => {} }));
  const view = render(tree(null));
  expect(requests).toHaveLength(0);
  view.rerender(tree("sono"));
  await screen.findByText("Ver durações e classificações");
  expect(requests.some((path) => path.endsWith("/weekly-summary"))).toBe(true);
  expect(screen.getAllByText("Profundo: 01:00h · Alto")).toHaveLength(7);
  expect(screen.getAllByText("Acordado: 00:05h · Sem classificação")).toHaveLength(7);
  await waitFor(() => {
    const bars = [...document.querySelectorAll(".recharts-bar")];
    expect(bars).toHaveLength(4);
    const segments = bars.map((bar) => bar.querySelector("path.recharts-rectangle"));
    expect(segments.every(Boolean)).toBe(true);
    // Phases share one horizontal position and have distinct stacked heights.
    expect(new Set(segments.map((segment) => segment.getAttribute("x"))).size).toBe(1);
    expect(new Set(segments.map((segment) => segment.getAttribute("y"))).size).toBe(4);
    for (const [index, level] of ["alto", "normal", "baixo", "desconhecido"].entries()) {
      const phase = ["profundo", "leve", "rem", "acordado"][index];
      const fill = segments[index].getAttribute("fill");
      expect(fill).toContain(`-${phase}-${level})`);
      const pattern = document.getElementById(fill.slice(5, -1));
      expect(pattern.querySelector("rect").getAttribute("fill")).toBe(
        ["#6366f1", "#38bdf8", "#a78bfa", "#f59e0b"][index],
      );
      expect(pattern.querySelectorAll("path, circle").length).toBe(level === "alto" ? 0 : 1);
      if (level === "normal") expect(pattern.querySelector("path")).toBeTruthy();
      if (level === "baixo") expect(pattern.querySelector("circle")).toBeTruthy();
      // All levels of a phase retain its original hue; only texture changes.
      for (const alternative of ["baixo", "normal", "alto"]) {
        const alternativeId = pattern.id.replace(new RegExp(`${level}$`), alternative);
        expect(document.getElementById(alternativeId).querySelector("rect").getAttribute("fill"))
          .toBe(pattern.querySelector("rect").getAttribute("fill"));
      }
    }
  }, { timeout: 3000 });
  view.rerender(tree("refeicoes"));
  await screen.findByText("Selecione um dos sete dias para ver as refeições salvas.");
  expect(requests.some((path) => path.endsWith("/weekly-meals"))).toBe(true);
});

test("weight opens on a seven-day week and still offers day, month and year", async () => {
  const day = sessionDay();
  const requests = [];
  globalThis.fetch = async (url) => {
    const params = new URL(String(url), "http://test").searchParams;
    requests.push({ period: params.get("periodo"), date: params.get("data") });
    const end = params.get("data");
    const start = new Date(`${end}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 6);
    return new Response(JSON.stringify({
      ok: true, periodo: { inicio: start.toISOString().slice(0, 10), fim: end },
      pontos: [{ data: end, horario: "08:00", peso_kg: 80.2 }],
    }), { headers: { "Content-Type": "application/json" } });
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (metric) => createElement(QueryClientProvider, { client },
    createElement(WeeklyDetailDialog, { metric, onOpenChange: () => {} }));
  const view = render(tree("peso"));
  await screen.findByText("Ver valores do período");
  expect(requests[0]).toEqual({ period: "semana", date: day });
  expect(screen.getByRole("button", { name: "Semana" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByLabelText("Semana encerrada em").value).toBe(day);
  for (const [name, period] of [["Dia", "dia"], ["Mês", "mes"], ["Ano", "ano"]]) {
    fireEvent.click(screen.getByRole("button", { name }));
    await screen.findByText("Ver valores do período");
    expect(requests.at(-1).period).toBe(period);
    expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("true");
  }
  view.rerender(tree(null));
  view.rerender(tree("peso"));
  await screen.findByText("Ver valores do período");
  expect(screen.getByRole("button", { name: "Semana" }).getAttribute("aria-pressed")).toBe("true");
});
