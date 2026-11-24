import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement, useState } from "react";
import "../../test/setup-dom.mjs";

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { ExerciseReview } = await import("./ExerciseReview");
const { parseExerciseDurationSeconds } = await import("@/lib/exercise-duration");
let changes;

function EditableExerciseHarness() {
  const [value, setValue] = useState();
  return createElement(ExerciseReview, {
    value,
    disabled: false,
    testIdPrefix: "walk",
    onChange: (next) => {
      changes.push(next);
      setValue(next);
    },
  });
}

function ClearableExerciseHarness() {
  const [value, setValue] = useState({ duracao_segundos: 2_296 });
  return createElement(ExerciseReview, {
    value,
    disabled: false,
    testIdPrefix: "clearable",
    onChange: (next) => {
      changes.push(next);
      setValue(next);
    },
  });
}

beforeEach(() => {
  changes = [];
});

afterEach(() => {
  cleanup();
});

test("exercise review edits structured fields and leaves missing source data blank", () => {
  render(createElement(EditableExerciseHarness));

  expect(screen.getByTestId("walk-exercise-details")).toBeTruthy();
  for (const testId of [
    "walk-inicio",
    "walk-fim",
    "walk-duration",
    "walk-intensity",
    "walk-calorias_estimadas",
    "walk-distancia_km",
    "walk-passos",
    "walk-pontos_cardio",
    "walk-pace",
  ]) {
    expect(screen.getByTestId(testId).value).toBe("");
  }

  fireEvent.change(screen.getByTestId("walk-inicio"), { target: { value: "14:34" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Ritmos por trecho / detalhes da fonte" }),
    { target: { value: "1 km: 11:44; 2 km: 10:32" } });
  fireEvent.change(screen.getByTestId("walk-fim"), { target: { value: "15:12" } });
  fireEvent.change(screen.getByTestId("walk-duration"), { target: { value: "38:16" } });
  fireEvent.change(screen.getByTestId("walk-distancia_km"), { target: { value: "3.29" } });
  fireEvent.change(screen.getByTestId("walk-pace"), { target: { value: "11:35/km" } });

  expect(changes.at(-1)).toMatchObject({
    inicio: "14:34",
    fim: "15:12",
    duracao_segundos: 2_296,
    distancia_km: 3.29,
    ritmo_min_km: "11:35/km",
  });
  expect(changes.at(-1).passos).toBeUndefined();
  expect(changes.at(-1).pontos_cardio).toBeUndefined();
  expect(changes.at(-1).calorias_estimadas).toBeUndefined();
});

test("saved read-only exercise stays visible with exact known details and gaps", () => {
  render(
    createElement(ExerciseReview, {
      value: {
        inicio: "14:34",
        fim: "15:12",
        duracao_segundos: 2_296,
        intensidade: "Moderada",
        calorias_estimadas: 238,
        distancia_km: 3.29,
        passos: 4_387,
        pontos_cardio: 37,
        ritmo_min_km: "11:35/km",
        ritmos_parciais: "1 km: 11:44; 2 km: 10:32",
      },
      disabled: true,
      testIdPrefix: "saved-walk",
      onChange: () => {},
    }),
  );

  expect(screen.getByTestId("saved-walk-inicio-value").textContent).toBe("14:34");
  expect(screen.getByTestId("saved-walk-fim-value").textContent).toBe("15:12");
  expect(screen.getByTestId("saved-walk-duration-value").textContent).toBe("38:16");
  expect(screen.getByTestId("saved-walk-distancia_km-value").textContent).toBe("3,29");
  expect(screen.getByTestId("saved-walk-passos-value").textContent).toBe("4.387");
  expect(screen.getByTestId("saved-walk-pontos_cardio-value").textContent).toBe("37");
  expect(screen.getByTestId("saved-walk-pace-value").textContent).toBe("11:35/km");
  expect(screen.queryByTestId("saved-walk-duration")).toBeNull();
});

test("clearing a known duration remains an explicit blank instead of restoring its old value", () => {
  render(createElement(ClearableExerciseHarness));
  const duration = screen.getByTestId("clearable-duration");
  expect(duration.value).toBe("38:16");

  fireEvent.change(duration, { target: { value: "" } });

  expect(changes.at(-1).duracao_segundos).toBeNull();
  expect(screen.getByTestId("clearable-duration").value).toBe("");
});

test("legacy duration parser accepts exact time units but ignores quantities that are not durations", () => {
  expect(parseExerciseDurationSeconds("38 min")).toBe(2_280);
  expect(parseExerciseDurationSeconds("38:16")).toBe(2_296);
  expect(parseExerciseDurationSeconds("2h09min")).toBe(7_740);
  expect(parseExerciseDurationSeconds("38 min 16 seconds")).toBe(2_296);
  expect(parseExerciseDurationSeconds("3 m")).toBeNull();
  expect(parseExerciseDurationSeconds("3.29 km")).toBeNull();
  expect(parseExerciseDurationSeconds("não informado")).toBeNull();
  expect(parseExerciseDurationSeconds("2h 60min")).toBeNull();
});
