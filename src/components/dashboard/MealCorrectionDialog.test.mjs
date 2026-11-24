import { expect, test } from "bun:test";
import { Children, createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MealCorrectionList } from "./MealCorrectionDialog";
import { MealEditor } from "./MealEditor";
import { MealSummaryList } from "./MealSummaryList";

const meals = [
  { hora: "08:10", itens: [
    { id: "42", item: "Pão", quantidade: "1 unidade" },
    { id: "43", item: "Queijo", quantidade: "2 fatias" },
  ] },
];

function correctionAction(node) {
  if (!isValidElement(node)) return null;
  const props = node.props;
  if (props["aria-label"] === "Corrigir Pão das 08:10") return props.onClick ?? null;
  for (const child of Children.toArray(props.children)) {
    const action = correctionAction(child);
    if (action) return action;
  }
  return null;
}

function markupWithClient(node) {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, node));
}

test("the daily meal summary is read-only, while a separate correction list selects the saved item", () => {
  const summary = markupWithClient(createElement(MealSummaryList, {
    meals, emptyMessage: "Nada registrado.",
  }));
  expect(summary).toContain("08:10");
  expect(summary).toContain("Pão (1 unidade)");
  expect(summary).not.toContain("Corrigir");
  expect(summary).toContain("Editar horário");

  const selected = [];
  const correction = MealCorrectionList({
    meals, onSelect: (item) => selected.push(item),
  });
  const correctionMarkup = markupWithClient(correction);
  expect(correctionMarkup).toContain("Corrigir Pão das 08:10");
  expect(correctionMarkup).toContain("Corrigir Queijo das 08:10");
  correctionAction(correction)?.();
  expect(selected).toEqual([{ id: "42", item: "Pão", quantidade: "1 unidade", horario: "08:10" }]);
  const editor = renderToStaticMarkup(createElement(MealEditor, {
    id: selected[0].id,
    initialItem: selected[0].item,
    initialQuantity: selected[0].quantidade,
    initialDate: "2026-10-21",
    initialTime: selected[0].horario,
    onDone: () => {},
  }));
  expect(editor).toContain("Corrigir item salvo");
  expect(editor).toContain('type="date"');
  expect(editor).toContain('type="time"');
  expect(editor).toContain('value="Pão"');
  expect(editor).toContain('value="1 unidade"');
  expect(editor).toContain("Salvar correção");
  expect(editor).toContain("Remover item duplicado");
});

test("a saved meal without an identifier cannot be corrected as another item", () => {
  const markup = markupWithClient(createElement(MealCorrectionList, {
    meals: [{ hora: "12:00", itens: [{ item: "Arroz", quantidade: "3 colheres" }] }],
    onSelect: () => { throw new Error("A correction action must not exist"); },
  }));
  expect(markup).toContain("Arroz (3 colheres)");
  expect(markup).not.toContain("Corrigir Arroz");
  expect(markup).not.toContain("Editar horário");
});