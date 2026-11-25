import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import "../../test/setup-dom.mjs";
import { ValidationPayloadSchema } from "../../lib/api-schemas";

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ValidationCard } = await import("./ValidationCard");
const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test("sleep screenshot with hr duration confirms one total and preserves stages, excluding awake time", async () => {
  localStorage.clear();
  let saved;
  let resolved;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/sleep-day-status")) {
      return new Response(JSON.stringify({ data: new URL(String(url), "https://example.test").searchParams.get("data"),
        count: 0, token: "0".repeat(32) }));
    }
    expect(String(url)).toBe("/api/save-records");
    saved = JSON.parse(init.body);
    return new Response(JSON.stringify({ ok: true, record_refs: [{ table: "sono", import_key: "app:sleep" }] }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  render(createElement(ValidationCard, {
    operationId: "sleep-screenshot",
    status: "pending",
    payload: { grupos: [{
      evento_tipo: "sono", data: "2026-10-01", horario: "08:00",
      itens: [{
        id: "sleep-total", item: "Sono total", confirmado: true,
        quantidade_estimada: "6hr 27min",
        sono_profundo_min: "159 min", sono_leve_min: "191 min",
        sono_rem_min: "37 min", acordado_min: "05 min",
      }],
    }] },
    onResolved: (...args) => { resolved = args; },
  }));
  expect(screen.getByLabelText("Duração de Sono total em hh:mm").value).toBe("06:27");
  expect(screen.getByLabelText("Sono leve em hh:mm").value).toBe("03:11");
  expect(screen.getByLabelText("Sono REM em hh:mm").value).toBe("00:37");
  expect(screen.getByLabelText("Acordado em hh:mm").value).toBe("00:05");
  await waitFor(() => expect(screen.getByRole("button", { name: "Salvar" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(resolved?.[0]).toBe("saved"));
  expect(saved.grupos[0].itens).toHaveLength(1);
  expect(saved.grupos[0].itens[0]).toMatchObject({
    quantidade_estimada: "387 min", sono_profundo_min: "159 min",
    sono_leve_min: "191 min", sono_rem_min: "37 min", acordado_min: "5 min",
  });
  expect(screen.queryByText(/Confira as durações do sono/)).toBeNull();
});

test("incomplete photo extraction shows its warning and leaves missing phases blank", () => {
  const warning = "A leitura da imagem não identificou: sono leve, acordado/despertar. Confira esses campos na imagem.";
  const payload = ValidationPayloadSchema.parse({
    grupos: [{
      evento_tipo: "sono", data: "2026-09-01",
      itens: [{
        id: "incomplete-sleep", item: "Sono total", confirmado: true,
        quantidade_estimada: "480 min", sono_profundo_min: "60 min",
        sono_rem_min: "150 min", sono_leve_min: null, acordado_min: null,
      }],
    }],
    avisos_extracao: [warning],
  });
  render(createElement(ValidationCard, {
    operationId: "incomplete-sleep-photo", status: "pending", payload,
    onResolved() {},
  }));
  expect(screen.getByRole("alert").textContent).toBe(warning);
  expect(screen.getByLabelText("Sono leve em hh:mm").value).toBe("");
  expect(screen.getByLabelText("Acordado em hh:mm").value).toBe("");
  expect(screen.getByLabelText("Duração de Sono total em hh:mm").value).toBe("08:00");
});

test("yesterday selection is retained in the review draft after leaving and returning, without saving", () => {
  localStorage.clear();
  let requests = 0;
  globalThis.fetch = async (url, init) => {
    if (init?.method === "POST") { requests++; throw new Error("Must not save"); }
    return new Response(JSON.stringify({ data: new URL(String(url), "https://example.test").searchParams.get("data"),
      count: 0, token: "0".repeat(32) }));
  };
  const initial = { grupos: [{
    evento_tipo: "sono", data: "2026-10-11",
    itens: [{ id: "sleep-draft", item: "Sono total", confirmado: true,
      quantidade_estimada: "345 min", sono_profundo_min: "117 min",
      sono_leve_min: "167 min", sono_rem_min: "61 min", acordado_min: "5 min",
    }],
  }] };
  let draft;
  const props = { operationId: "sleep-draft", status: "pending", payload: initial,
    onResolved() {}, onEdited: (groups) => { draft = groups; } };
  const mounted = render(createElement(ValidationCard, props));
  fireEvent.click(screen.getByRole("button", { name: "Ontem" }));
  const yesterday = screen.getByLabelText("Data de Sono").value;
  expect(draft[0].data).toBe(yesterday);
  mounted.unmount();
  render(createElement(ValidationCard, { ...props, payload: { grupos: draft } }));
  expect(screen.getByLabelText("Data de Sono").value).toBe(yesterday);
  expect(screen.getByLabelText("Sono leve em hh:mm").value).toBe("02:47");
  expect(screen.getByLabelText("Acordado em hh:mm").value).toBe("00:05");
  expect(requests).toBe(0);
});