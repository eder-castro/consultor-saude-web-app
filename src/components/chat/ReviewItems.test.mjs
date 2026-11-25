import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import "../../test/setup-dom.mjs";

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { ValidationCard } = await import("./ValidationCard");
const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function renderMeal(onEdited) {
  return render(
    createElement(ValidationCard, {
      operationId: "meal-review",
      status: "pending",
      onResolved() {},
      onEdited,
      payload: {
        grupos: [
          {
            evento_tipo: "alimentacao",
            data: "2026-11-25",
            horario: "09:00",
            itens: [
              {
                id: "pao",
                item: "Pão integral",
                quantidade_estimada: "2 fatias",
                confirmado: true,
              },
              { id: "ovo", item: "Ovo", quantidade_estimada: "3 unidades", confirmado: false },
            ],
          },
        ],
      },
    }),
  );
}

test("itens aparecem como lista compacta e um toque edita só aquele item", () => {
  let latest;
  renderMeal((groups) => {
    latest = groups;
  });
  expect(screen.queryByRole("textbox", { name: /Item/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Corrigir Pão integral" }).textContent).toContain(
    "2 fatias",
  );

  fireEvent.click(screen.getByRole("button", { name: "Corrigir Pão integral" }));
  fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "1 fatia" } });
  fireEvent.click(screen.getByRole("button", { name: "OK" }));

  expect(screen.getByRole("button", { name: "Corrigir Pão integral" }).textContent).toContain(
    "1 fatia",
  );
  expect(screen.getByRole("button", { name: "Corrigir Ovo" })).toBeTruthy();
  expect(latest[0].itens[0].quantidade_estimada).toBe("1 fatia");
});

test("segurar um item pede confirmação antes de remover", async () => {
  let latest;
  renderMeal((groups) => {
    latest = groups;
  });
  const row = screen.getByRole("button", { name: "Corrigir Pão integral" });
  fireEvent.pointerDown(row, { pointerType: "touch" });
  await act(() => new Promise((resolve) => setTimeout(resolve, 600)));

  expect(screen.getByText(/Remover/, { selector: "span" }).textContent).toContain("Pão integral");
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.getByRole("button", { name: "Corrigir Pão integral" })).toBeTruthy();

  fireEvent.pointerDown(screen.getByRole("button", { name: "Corrigir Pão integral" }), {
    pointerType: "touch",
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
  fireEvent.click(screen.getByRole("button", { name: "Remover" }));

  expect(screen.queryByRole("button", { name: "Corrigir Pão integral" })).toBeNull();
  expect(latest[0].itens.map((item) => item.id)).toEqual(["ovo"]);
});

test("toque curto não abre a confirmação de remoção", () => {
  renderMeal();
  const row = screen.getByRole("button", { name: "Corrigir Ovo" });
  fireEvent.pointerDown(row, { pointerType: "touch" });
  fireEvent.pointerUp(row, { pointerType: "touch" });
  fireEvent.click(row);
  expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  expect(screen.getByLabelText("Quantidade").value).toBe("3 unidades");
});

test("item não marcado pela IA pode ser incluído antes de salvar", () => {
  let latest;
  renderMeal((groups) => {
    latest = groups;
  });
  const toggle = screen.getByRole("checkbox", { name: "Incluir Ovo" });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(toggle);
  expect(screen.getByRole("checkbox", { name: "Incluir Ovo" }).getAttribute("aria-checked")).toBe(
    "true",
  );
  expect(latest[0].itens[1].confirmado).toBe(true);
});

test("corrigir um item não marcado e tocar em OK inclui o item", () => {
  let latest;
  renderMeal((groups) => {
    latest = groups;
  });
  fireEvent.click(screen.getByRole("button", { name: "Corrigir Ovo" }));
  fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "2 unidades" } });
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.getByRole("checkbox", { name: "Incluir Ovo" }).getAttribute("aria-checked")).toBe(
    "true",
  );
  expect(latest[0].itens[1]).toMatchObject({ quantidade_estimada: "2 unidades", confirmado: true });
});
