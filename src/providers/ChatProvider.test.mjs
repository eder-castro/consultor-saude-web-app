import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import "../test/setup-dom.mjs";

mock.module("@/providers/auth-context", () => ({
  useAuth: () => ({ user: { id: "test-owner", email: "teste@exemplo.com" } }),
}));

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ChatProvider, shouldShowFailedPhotoJob } = await import("./ChatProvider.tsx");
const { ChatFeed } = await import("@/components/chat/ChatFeed");
const { useChat } = await import("@/providers/chat-context");
const { writeChatSession } = await import("@/lib/chat-session-cache");
const originalFetch = globalThis.fetch;
HTMLElement.prototype.scrollIntoView ??= function scrollIntoView() {};

let client;
let historyReads;
let historyWrites;
let historyResponses;
let photoJobs;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ChatHarness() {
  const { messages, setMessages, historyStatus, retryHistory, historySyncError } = useChat();
  return createElement(
    "div",
    null,
    createElement("output", { "data-testid": "history-status" }, historyStatus),
    historySyncError && createElement("button", {
      onClick: retryHistory,
    }, "Tentar sincronizar histórico"),
    createElement("button", {
      onClick: () => setMessages((current) => [...current,
        { id: "new-user-time", role: "user", kind: "text", text: "Mensagem com horário" },
        { id: "new-analysis-time", role: "assistant", kind: "loading", inputKind: "image" },
      ]),
    }, "Criar mensagens"),
    createElement("button", {
      onClick: () => setMessages((current) => current.map((message) =>
        message.id === "new-analysis-time" && message.kind === "loading"
          ? { ...message, stage: "preparing_images" }
          : message)),
    }, "Atualizar etapa da análise"),
    createElement("button", {
      onClick: () => setMessages((current) => current.map((message) =>
        message.id === "new-analysis-time" && message.kind === "loading"
          ? { ...message, stage: "analyzing_image" }
          : message)),
    }, "Avançar etapa da análise"),
    createElement("button", {
      onClick: () => setMessages((current) => [...current, {
        id: "saved-analysis-stage",
        role: "assistant",
        kind: "validation",
        payload: {
          grupos: [{
            evento_tipo: "alimentacao",
            data: saoPauloDate(),
            itens: [{
              id: "saved-meal",
              item: "Arroz",
              quantidade_estimada: "1 porção",
              confirmado: true,
            }],
          }],
        },
        status: "saved",
        analysis: {
          status: "pending",
          stage: "loading_saved_context",
          recordRefs: [{ table: "alimentacao", import_key: "saved-meal-key" }],
        },
      }]),
    }, "Criar análise salva em andamento"),
    createElement("button", {
      onClick: () => setMessages((current) => current.map((message) =>
        message.id === "saved-analysis-stage" && message.kind === "validation"
          ? { ...message, analysis: { ...message.analysis, stage: "analyzing_saved_record" } }
          : message)),
    }, "Avançar etapa da análise salva"),
    createElement("button", {
      onClick: () => setMessages((current) => current.map((message) =>
        message.id === "saved-analysis-stage" && message.kind === "validation"
          ? { ...message, analysis: { ...message.analysis, status: "ready", text: "Análise concluída." } }
          : message)),
    }, "Concluir análise salva"),
    createElement("button", {
      onClick: () => setMessages((current) => current.map((message) =>
        message.id === "new-analysis-time"
          ? { id: message.id, role: "assistant", kind: "text", text: "Análise concluída" }
          : message)),
    }, "Concluir análise"),
    createElement(ChatFeed, {
      messages,
      historyStatus,
      onRetryHistory: retryHistory,
      onDismissPhotoError: (id) =>
        setMessages((current) =>
          current.map((message) =>
            message.id === id && message.kind === "error"
              ? { ...message, acknowledged: true }
              : message,
          ),
        ),
      onValidationResolved: () => {},
      onCorrectionResolved: () => {},
      onRetry: () => {},
      onRetrySavedAnalysis: () => {},
      onCancelPhoto: () => {},
    }),
  );
}

function mountChat() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
  render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ChatProvider, null, createElement(ChatHarness)),
    ),
  );
}

beforeEach(() => {
  localStorage.clear();
  window.sessionStorage.clear();
  historyReads = 0;
  historyWrites = [];
  historyResponses = [];
  photoJobs = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url);
    if (path.endsWith("/chat-history") && init.method === "PUT") {
      historyWrites.push(JSON.parse(init.body));
      return jsonResponse({ ok: true });
    }
    if (path.endsWith("/chat-history")) {
      historyReads += 1;
      return historyResponses.shift() ?? jsonResponse({ messages: [] });
    }
    if (path.endsWith("/daily-analysis-summary")) return jsonResponse(dailySummary());
    if (path.endsWith("/photo-jobs")) return jsonResponse({ jobs: photoJobs });
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

function dailySummary() {
  const today = saoPauloDate(0);
  const end = new Date(`${saoPauloDate(-1)}T12:00:00Z`);
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - (6 - index));
    return {
      data: day.toISOString().slice(0, 10),
      agua_ml: null,
      refeicoes: 0,
      alimentos: [],
      alimentos_omitidos: 0,
      atividades: [],
      atividades_omitidas: 0,
      exercicio_min: null,
      sono_min: null,
      peso_kg: null,
      avisos: [],
    };
  });
  return {
    ok: true,
    para_dia: today,
    periodo: { inicio: days[0].data, fim: days[6].data },
    gerado_em: new Date().toISOString(),
    origem: "fechamento_diario",
    resumo: { dias },
  };
}

function saoPauloDate(offsetDays = 0) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const shifted = new Date(`${today}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  return shifted.toISOString().slice(0, 10);
}

test("restores original sent time, falls back to server time for old messages, and persists both", async () => {
  const today = saoPauloDate();
  historyResponses = [jsonResponse({ messages: [
    {
      client_id: "original-time", role: "user", kind: "text", sequence: 0,
      created_at: `${today}T14:36:00-03:00`,
      payload: { text: "Mensagem original", sent_at: `${today}T14:34:00-03:00` },
    },
    {
      client_id: "legacy-time", role: "assistant", kind: "text", sequence: 1,
      created_at: `${today}T17:59:00-03:00`, payload: { text: "Mensagem antiga" },
    },
  ] })];
  mountChat();
  await screen.findByText("Mensagem original");
  expect(screen.getByText("14:34").getAttribute("datetime")).toBe(`${today}T14:34:00-03:00`);
  expect(screen.getByText("17:59").getAttribute("datetime")).toBe(`${today}T17:59:00-03:00`);
  await waitFor(() => expect(historyWrites.length).toBeGreaterThan(0));
  const stored = historyWrites.at(-1).messages;
  expect(stored.find((row) => row.client_id === "original-time").payload.sent_at).toBe(`${today}T14:34:00-03:00`);
  expect(stored.find((row) => row.client_id === "legacy-time").payload.sent_at).toBe(`${today}T17:59:00-03:00`);
});

test("new messages have stable timestamps when loading becomes a result", async () => {
  mountChat();
  await waitFor(() => expect(screen.getByTestId("history-status").textContent).toBe("ready"));
  fireEvent.click(screen.getByRole("button", { name: "Criar mensagens" }));
  expect(screen.getByRole("status", { name: "Analisando sua foto..." })).toBeTruthy();
  const analysisElement = document.querySelector('[data-message-id="new-analysis-time"]');
  const initialTime = analysisElement.querySelector("time").getAttribute("datetime");
  expect(Number.isFinite(Date.parse(initialTime))).toBe(true);
  expect(document.querySelector('[data-message-id="new-user-time"] time')).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Concluir análise" }));
  expect(screen.queryByRole("status", { name: "Analisando sua foto..." })).toBeNull();
  expect(analysisElement.querySelector("time").getAttribute("datetime")).toBe(initialTime);
  await waitFor(() => expect(historyWrites.at(-1)?.messages.some((row) =>
    row.client_id === "new-analysis-time")).toBe(true));
  expect(historyWrites.at(-1).messages.find((row) =>
    row.client_id === "new-analysis-time").payload.sent_at).toBe(initialTime);
});

test("first visit opens chat before history arrives and merges messages sent during background loading", async () => {
  let finishRefresh;
  historyResponses = [new Promise((resolve) => { finishRefresh = resolve; })];
  mountChat();

  await waitFor(() => expect(screen.getByTestId("history-status").textContent).toBe("ready"));
  expect(historyReads).toBe(1);
  expect(screen.queryByTestId("status-chat-history")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Criar mensagens" }));
  await screen.findByText("Mensagem com horário");
  fireEvent.click(screen.getByRole("button", { name: "Concluir análise" }));
  await screen.findByText("Análise concluída");
  await new Promise((resolve) => setTimeout(resolve, 550));
  // Never replace remote conversations with the first local messages.
  expect(historyWrites).toHaveLength(0);
  expect(window.sessionStorage.getItem("health:resume:v1:chat")).toContain("Mensagem com horário");

  finishRefresh(jsonResponse({ messages: [{
    client_id: "remote-earlier", role: "user", kind: "text", sequence: 0,
    payload: { text: "Conversa anterior do dia" },
    created_at: `${saoPauloDate()}T08:00:00-03:00`,
  }] }));
  await screen.findByText("Conversa anterior do dia");
  expect(screen.getAllByText("Mensagem com horário")).toHaveLength(1);
  expect(screen.getAllByText("Análise concluída")).toHaveLength(1);
  await waitFor(() => expect(historyWrites.length).toBeGreaterThan(0));
  expect(historyWrites.at(-1).messages.map((row) => row.client_id)).toEqual([
    "remote-earlier", "new-user-time", "new-analysis-time",
  ]);
});

test("cached chat appears before a slow history refresh and preserves edits made during it", async () => {
  const today = saoPauloDate();
  const cached = {
    client_id: "cached-message", role: "user", kind: "text", sequence: 0,
    payload: { text: "Conversa disponível sem esperar", sent_at: `${today}T10:00:00-03:00` },
  };
  writeChatSession("test-owner", [cached]);
  let finishRefresh;
  historyResponses = [new Promise((resolve) => { finishRefresh = resolve; })];
  mountChat();

  await screen.findByText("Conversa disponível sem esperar");
  expect(screen.getByTestId("history-status").textContent).toBe("ready");
  fireEvent.click(screen.getByRole("button", { name: "Criar mensagens" }));
  await new Promise((resolve) => setTimeout(resolve, 550));
  expect(historyWrites).toHaveLength(0);
  finishRefresh(jsonResponse({ messages: [{
    ...cached, created_at: `${today}T10:00:00-03:00`,
  }] }));
  await waitFor(() => expect(historyWrites.length).toBeGreaterThan(0));
  expect(screen.getByText("Mensagem com horário")).toBeTruthy();
  expect(screen.getAllByText("Conversa disponível sem esperar")).toHaveLength(1);
  const local = window.sessionStorage.getItem("health:resume:v1:chat");
  expect(local).toContain("Mensagem com horário");
  expect(local).not.toContain('"kind":"loading"');
});

test("another owner's temporary chat cache never appears", async () => {
  writeChatSession("another-owner", [{
    client_id: "private-message", role: "user", kind: "text", sequence: 0,
    payload: { text: "Conversa de outra conta", sent_at: new Date().toISOString() },
  }]);
  mountChat();
  await waitFor(() => expect(screen.getByTestId("history-status").textContent).toBe("ready"));
  expect(screen.queryByText("Conversa de outra conta")).toBeNull();
});

test("transient analysis stages do not repeat persistence, while durable results do", async () => {
  mountChat();
  await waitFor(() => expect(screen.getByTestId("history-status").textContent).toBe("ready"));
  fireEvent.click(screen.getByRole("button", { name: "Criar mensagens" }));
  await waitFor(() => expect(historyWrites).toHaveLength(1));

  fireEvent.click(screen.getByRole("button", { name: "Atualizar etapa da análise" }));
  fireEvent.click(screen.getByRole("button", { name: "Avançar etapa da análise" }));
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(historyWrites).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "Concluir análise" }));
  await waitFor(() => expect(historyWrites).toHaveLength(2));
  expect(historyWrites.at(-1).messages.find((row) =>
    row.client_id === "new-analysis-time").payload.text).toBe("Análise concluída");
});

test("saved-analysis stage changes are transient but its terminal result persists", async () => {
  mountChat();
  await waitFor(() => expect(screen.getByTestId("history-status").textContent).toBe("ready"));
  fireEvent.click(screen.getByRole("button", { name: "Criar análise salva em andamento" }));
  await waitFor(() => expect(historyWrites).toHaveLength(1));
  const initialAnalysis = historyWrites[0].messages.find((row) =>
    row.client_id === "saved-analysis-stage").payload.analysis;
  expect(initialAnalysis).toEqual({
    status: "pending",
    recordRefs: [{ table: "alimentacao", import_key: "saved-meal-key" }],
  });

  fireEvent.click(screen.getByRole("button", { name: "Avançar etapa da análise salva" }));
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(historyWrites).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "Concluir análise salva" }));
  await waitFor(() => expect(historyWrites).toHaveLength(2));
  expect(historyWrites.at(-1).messages.find((row) =>
    row.client_id === "saved-analysis-stage").payload.analysis).toEqual({
    status: "ready",
    recordRefs: [{ table: "alimentacao", import_key: "saved-meal-key" }],
    text: "Análise concluída.",
  });
});

test("pending photo metadata keeps its timestamp across reload and shows animation only while processing", async () => {
  const today = saoPauloDate();
  const jobId = "00000000-0000-4000-8000-000000000123";
  historyResponses = [jsonResponse({ messages: [{
    client_id: `photo-job:${jobId}`, role: "assistant", kind: "text", sequence: 0,
    created_at: `${today}T16:04:00-03:00`,
    payload: { deferred_photo_job_id: jobId, sent_at: `${today}T16:00:00-03:00` },
  }] })];
  photoJobs = [{ id: jobId, status: "processing", result: null, attempts: 1,
    created_at: `${today}T16:04:00-03:00` }];
  mountChat();
  await screen.findByRole("status", { name: "A nova tentativa de análise da foto está em andamento..." });
  expect(screen.getByText("16:00")).toBeTruthy();
  await waitFor(() => expect(historyWrites.length).toBeGreaterThan(0));
  const stored = historyWrites.at(-1).messages.find((row) => row.client_id === `photo-job:${jobId}`);
  expect(stored.payload).toEqual({
    deferred_photo_job_id: jobId, sent_at: `${today}T16:00:00-03:00`,
  });
});

test("failed background history offers retry without blocking chat or saving empty history", async () => {
  historyResponses = [
    jsonResponse({ detail: "Histórico temporariamente indisponível." }, 503),
    jsonResponse({ messages: [] }),
  ];
  mountChat();

  await screen.findByRole("button", { name: "Tentar sincronizar histórico" });
  expect(screen.getByTestId("history-status").textContent).toBe("ready");
  expect(screen.queryByTestId("status-chat-history")).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 550));
  expect(historyReads).toBe(1);
  expect(historyWrites).toHaveLength(0);

  fireEvent.click(screen.getByRole("button", { name: "Tentar sincronizar histórico" }));
  await waitFor(() => expect(historyReads).toBe(2));
  await waitFor(() => expect(screen.getByTestId("history-status").textContent).toBe("ready"));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Tentar sincronizar histórico" })).toBeNull());
  expect(historyWrites).toHaveLength(0);
});

test("restored saved exercise review keeps its structured facts visible", async () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  historyResponses = [
    jsonResponse({
      messages: [
        {
          client_id: "exercise-review-message",
          role: "assistant",
          kind: "validation",
          payload: {
            validation: {
              grupos: [
                {
                  evento_tipo: "exercicio",
                  data: today,
                  horario: "14:34",
                  itens: [
                    {
                      id: "walk",
                      item: "Caminhada",
                      quantidade_estimada: "38 min",
                      confirmado: true,
                      exercicio: {
                        inicio: "14:34",
                        fim: "15:12",
                        duracao_segundos: 2_296,
                        intensidade: "Moderada",
                        calorias_estimadas: 238,
                        distancia_km: 3.29,
                        passos: 4_387,
                        pontos_cardio: 37,
                        ritmo_min_km: "11:35/km",
                      },
                    },
                  ],
                },
              ],
            },
            status: "saved",
          },
          sequence: 0,
          created_at: new Date().toISOString(),
        },
      ],
    }),
  ];
  mountChat();

  expect((await screen.findByTestId("exercise-walk-duration-value")).textContent).toBe("38:16");
  expect(screen.getByTestId("exercise-walk-inicio-value").textContent).toBe("14:34");
  expect(screen.getByTestId("exercise-walk-distancia_km-value").textContent).toBe("3,29");
  expect(screen.getByTestId("exercise-walk-pace-value").textContent).toBe("11:35/km");
  expect(screen.queryByTestId("exercise-walk-duration")).toBeNull();
});

test("restored legacy exercise quantity hydrates the previously blank duration field", async () => {
  const today = saoPauloDate();
  historyResponses = [jsonResponse({ messages: [{
    client_id: "legacy-exercise-message",
    role: "assistant",
    kind: "validation",
    payload: {
      validation: {
        grupos: [{
          evento_tipo: "exercicio",
          data: today,
          horario: null,
          itens: [{
            id: "legacy-walk",
            item: "Caminhada",
            quantidade_estimada: "38 min",
            confirmado: true,
          }],
        }],
      },
      status: "saved",
    },
    sequence: 0,
    created_at: new Date().toISOString(),
  }] })];
  mountChat();

  expect((await screen.findByTestId("exercise-legacy-walk-duration-value")).textContent)
    .toBe("38:00");
  expect(screen.queryByTestId("exercise-legacy-walk-duration")).toBeNull();
});

test("restored cleared exercise duration does not fall back to its old legacy quantity", async () => {
  const today = saoPauloDate();
  historyResponses = [jsonResponse({ messages: [{
    client_id: "cleared-exercise-message",
    role: "assistant",
    kind: "validation",
    payload: {
      validation: {
        grupos: [{
          evento_tipo: "exercicio",
          data: today,
          horario: null,
          itens: [{
            id: "cleared-walk",
            item: "Caminhada",
            quantidade_estimada: "38 min",
            confirmado: true,
            exercicio: { duracao_segundos: null },
          }],
        }],
      },
      status: "saved",
    },
    sequence: 0,
    created_at: new Date().toISOString(),
  }] })];
  mountChat();

  expect((await screen.findByTestId("exercise-cleared-walk-duration-value")).textContent)
    .toBe("—");
  expect(screen.queryByText("38:00")).toBeNull();
});

test("old failed photo jobs stay out of today's chat while current failures keep an acknowledged record", async () => {
  const today = saoPauloDate();
  const yesterday = saoPauloDate(-1);
  historyResponses = [jsonResponse({ messages: [] })];
  photoJobs = [
    {
      id: "old-failed-job",
      status: "failed",
      result: null,
      attempts: 8,
      created_at: `${yesterday}T15:00:00-03:00`,
    },
    {
      id: "current-failed-job",
      status: "failed",
      result: null,
      attempts: 8,
      created_at: `${today}T15:00:00-03:00`,
    },
  ];
  mountChat();

  const alert = await screen.findByRole("alert");
  const todayLabel = new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(`${today}T15:00:00-03:00`));
  const yesterdayLabel = new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(`${yesterday}T15:00:00-03:00`));
  expect(alert.textContent).toContain(`foto enviada em ${todayLabel}`);
  expect(screen.queryByText(new RegExp(`foto enviada em ${yesterdayLabel}`))).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dispensar aviso" }));

  await screen.findByText("Aviso dispensado. O histórico foi mantido.");
  await waitFor(() => expect(historyWrites.length).toBeGreaterThan(0));
  const storedMessage = historyWrites
    .at(-1)
    .messages.find((message) => message.payload.photo_job_id === "current-failed-job");
  expect(storedMessage.payload).toMatchObject({
    acknowledged: true,
    error: true,
  });

  const persistedAt = `${today}T15:30:00-03:00`;
  cleanup();
  client.clear();
  historyResponses = [
    jsonResponse({
      messages: [
        {
          ...storedMessage,
          client_id: "photo-job:current-failed-job",
          role: "assistant",
          kind: "text",
          created_at: persistedAt,
        },
      ],
    }),
  ];
  mountChat();
  await screen.findByText("Aviso dispensado. O histórico foi mantido.");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("does not restore an already-saved generic legacy photo failure as a current chat event", async () => {
  const yesterday = saoPauloDate(-1);
  const legacyText =
    "A análise da foto não ficou pronta após as novas tentativas. Nenhum registro foi criado.";
  historyResponses = [
    jsonResponse({
      messages: [
        {
          client_id: "photo-job:old-failed-job",
          role: "assistant",
          kind: "text",
          payload: { text: legacyText, error: true },
          sequence: 0,
          created_at: new Date().toISOString(),
        },
      ],
    }),
  ];
  photoJobs = [
    {
      id: "old-failed-job",
      status: "failed",
      result: null,
      attempts: 8,
      created_at: `${yesterday}T15:00:00-03:00`,
    },
  ];
  mountChat();

  await waitFor(() => expect(screen.getByTestId("history-status").textContent).toBe("ready"));
  expect(screen.queryByText(legacyText)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("only old failed jobs are hidden; current failed and existing in-flight jobs remain eligible", () => {
  const yesterday = "2026-09-29T15:00:00-03:00";
  const today = "2026-09-30T15:00:00-03:00";
  const trackedDeferred = [
    { id: "photo-job:tracked", role: "assistant", kind: "deferred", jobId: "tracked" },
  ];

  expect(
    shouldShowFailedPhotoJob(
      { id: "old", status: "failed", created_at: yesterday },
      [],
      "2026-09-30",
    ),
  ).toBe(false);
  expect(
    shouldShowFailedPhotoJob(
      { id: "today", status: "failed", created_at: today },
      [],
      "2026-09-30",
    ),
  ).toBe(true);
  expect(
    shouldShowFailedPhotoJob(
      { id: "tracked", status: "failed", created_at: yesterday },
      trackedDeferred,
      "2026-09-30",
    ),
  ).toBe(true);
  for (const status of ["pending", "processing", "ready"]) {
    expect(
      shouldShowFailedPhotoJob({ id: "active", status, created_at: yesterday }, [], "2026-09-30"),
    ).toBe(true);
  }
});
