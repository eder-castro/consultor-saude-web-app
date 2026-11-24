import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createElement, useState } from "react";
import "../test/setup-dom.mjs";

mock.module("@/providers/auth-context", () => ({
  useAuth: () => ({ user: { id: "test-owner", email: "teste@exemplo.com" } }),
}));
const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { ComposerDraftProvider, useComposerDraft } = await import("./ComposerDraftProvider");
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
let revoked;

function DraftEditor() {
  const { draft, setText, addFiles, takeDraft } = useComposerDraft();
  return createElement("section", null,
    createElement("input", { "aria-label": "Rascunho", value: draft.text,
      onChange: (event) => setText(event.target.value) }),
    createElement("output", null, `Fotos: ${draft.files.length}`),
    createElement("button", { onClick: () => addFiles([
      new File(["sensitive-photo"], "photo.png", { type: "image/png" }),
    ]) }, "Anexar"),
    createElement("button", { onClick: takeDraft }, "Enviar"),
  );
}

function NavigationHarness() {
  const [visible, setVisible] = useState(true);
  return createElement("div", null,
    createElement("button", { onClick: () => setVisible(!visible) }, "Trocar tela"),
    visible ? createElement(DraftEditor) : createElement("p", null, "Outra tela"),
  );
}

function mount() {
  render(createElement(ComposerDraftProvider, null, createElement(NavigationHarness)));
}

beforeEach(() => {
  window.sessionStorage.clear();
  revoked = [];
  URL.createObjectURL = () => "blob:temporary-photo";
  URL.revokeObjectURL = (url) => revoked.push(url);
});
afterEach(() => {
  cleanup();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

test("navigation keeps text and attachments in memory; reload restores text only", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Rascunho"), { target: { value: "Meu rascunho" } });
  fireEvent.click(screen.getByRole("button", { name: "Anexar" }));
  fireEvent.click(screen.getByRole("button", { name: "Trocar tela" }));
  fireEvent.click(screen.getByRole("button", { name: "Trocar tela" }));
  expect(screen.getByLabelText("Rascunho").value).toBe("Meu rascunho");
  expect(screen.getByText("Fotos: 1")).toBeTruthy();
  expect(revoked).toHaveLength(0);
  const stored = window.sessionStorage.getItem("health:resume:v1:composer");
  expect(stored).toContain("Meu rascunho");
  expect(stored).not.toContain("sensitive-photo");
  expect(stored).not.toContain("blob:");
  cleanup();
  expect(revoked).toEqual(["blob:temporary-photo"]);
  mount();
  expect(screen.getByLabelText("Rascunho").value).toBe("Meu rascunho");
  expect(screen.getByText("Fotos: 0")).toBeTruthy();
});

test("sending clears the draft without revoking previews transferred to the chat", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Rascunho"), { target: { value: "Legenda" } });
  fireEvent.click(screen.getByRole("button", { name: "Anexar" }));
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  expect(screen.getByLabelText("Rascunho").value).toBe("");
  expect(screen.getByText("Fotos: 0")).toBeTruthy();
  expect(revoked).toHaveLength(0);
  cleanup();
  mount();
  expect(screen.getByLabelText("Rascunho").value).toBe("");
});
