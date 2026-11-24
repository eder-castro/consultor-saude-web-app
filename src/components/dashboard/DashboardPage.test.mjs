import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../test/setup-dom.mjs";

// Keep the real Dashboard, shell navigation and meal list; isolate only dialogs
// and account state unrelated to summary failures.
mock.module("@tanstack/react-router", () => ({
  createFileRoute: () => (config) => config,
  Link: ({ to, children, ...props }) => createElement("a", { ...props, href: to }, children),
  useLocation: () => ({ pathname: "/dashboard" }),
}));
mock.module("@/providers/auth-context", () => ({
  useAuth: () => ({ user: { email: "teste@exemplo.com" }, logout: async () => {} }),
}));
mock.module("@/providers/theme-context", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: () => {} }),
}));
mock.module("@/components/auth/ProtectedRoute", () => ({
  ProtectedRoute: ({ children }) => children,
}));
mock.module("@/components/dashboard/WaterHistoryDialog", () => ({
  WaterHistoryDialog: () => null,
}));

const { cleanup, fireEvent, render, screen, waitFor, act } =
  await import("@testing-library/react");
const { DashboardPage } = await import("../../routes/dashboard.tsx");
const originalFetch = globalThis.fetch;
let client;
let summaryFetches;
let responseForSummary;

const emptySummary = {
  data: "2026-09-29",
  agua_ml: 0,
  agua_meta_ml: 2500,
  refeicoes: [],
  exercicio: null,
  sono_horas: null,
  peso_kg: null,
  tendencia: null,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function mountDashboard(cachedSummary) {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false },
    },
  });
  if (cachedSummary) client.setQueryData(["daily-summary"], cachedSummary);
  render(createElement(QueryClientProvider, { client }, createElement(DashboardPage)));
  return client;
}

beforeEach(() => {
  localStorage.clear();
  summaryFetches = 0;
  responseForSummary = () => jsonResponse(emptySummary);
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.endsWith("/daily-summary")) {
      summaryFetches += 1;
      return responseForSummary();
    }
    if (path.endsWith("/sleep-reviews")) {
      return jsonResponse({ ok: true, revisoes: [] });
    }
    throw new Error(`Unexpected API request: ${path}`);
  };
});

afterEach(() => {
  cleanup();
  client?.clear();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

test("an initial summary failure shows an alert and retry while navigation stays available", async () => {
  responseForSummary = () => summaryFetches === 1
    ? jsonResponse({ detail: "Resumo indisponível." }, 503)
    : jsonResponse(emptySummary);
  mountDashboard();

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Não foi possível carregar o resumo do dia.");
  expect(alert.textContent).toContain("Resumo indisponível.");
  expect(screen.getByRole("link", { name: "Consultar análises anteriores" }).getAttribute("href"))
    .toBe("/analises");
  expect(screen.getByRole("navigation").querySelectorAll("a[href]")).toHaveLength(3);
  expect(screen.getByRole("link", { name: "Chat" }).getAttribute("href")).toBe("/");
  expect(screen.getByRole("link", { name: "Dia" }).getAttribute("href")).toBe("/dashboard");
  expect(screen.getByRole("link", { name: "Perfil" }).getAttribute("href")).toBe("/perfil");
  expect(screen.queryByText("Nada registrado ainda hoje.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

  await screen.findByText("Nada registrado ainda hoje.");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(summaryFetches).toBe(2);
});

test("a failed refetch keeps cached meals visible with an explicit stale-data warning", async () => {
  const cached = {
    ...emptySummary,
    agua_ml: 800,
    refeicoes: [{ hora: "12:00", itens: [{ item: "Arroz", quantidade: "1 prato" }] }],
  };
  responseForSummary = () => jsonResponse({ detail: "Falha na atualização." }, 503);
  const queryClient = mountDashboard(cached);
  expect(screen.getByText("Arroz (1 prato)")).toBeTruthy();

  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ["daily-summary"] });
  });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Falha na atualização."));
  expect(queryClient.getQueryData(["daily-summary"])).toEqual(cached);
  expect(screen.getByText("Arroz (1 prato)")).toBeTruthy();
  expect(screen.getByText("800 / 2500 ml")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("últimos dados carregados");
  expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Chat" }).getAttribute("href")).toBe("/");
});

test("a valid empty summary remains the normal empty meals state", async () => {
  mountDashboard();
  await screen.findByText("Nada registrado ainda hoje.");
  expect(screen.getByText("0 / 2500 ml")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});