import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  formatSleepDuration,
  parseSleepClock,
  parseSleepDuration,
  sleepDurationForReview,
  sleepDurationForStorage,
  sleepStageMismatch,
} from "./sleep-duration";

describe("sleep duration review", () => {
  it("accepts the hr abbreviation extracted from sleep screenshots without changing stage totals", () => {
    const item = {
      quantidade_estimada: "6hr 27min",
      sono_profundo_min: "159 min",
      sono_leve_min: "191 min",
      sono_rem_min: "37 min",
      acordado_min: "05 min",
    };
    assert.equal(sleepDurationForReview(item.quantidade_estimada), "06:27");
    assert.equal(sleepDurationForStorage(item.quantidade_estimada), "387 min");
    assert.equal(sleepStageMismatch(item), null);
    assert.equal(parseSleepDuration("6 hrs 27 min"), 387);
    assert.equal(parseSleepDuration("25hr"), null);
  });
  it("formats extracted total and stages without changing minutes", () => {
    for (const [source, display, saved] of [
      ["90 min", "01:30", "90 min"],
      ["7h 10min", "07:10", "430 min"],
      ["1h30", "01:30", "90 min"],
      ["1,5 h", "01:30", "90 min"],
      ["420", "07:00", "420 min"],
      ["0 min", "00:00", "0 min"],
    ]) {
      assert.equal(sleepDurationForReview(source), display);
      assert.equal(sleepDurationForStorage(display), saved);
    }
    assert.equal(formatSleepDuration(1440), "24:00");
  });

  it("keeps missing values empty and flags unsupported or incomplete input", () => {
    assert.equal(sleepDurationForReview(null), "");
    assert.equal(sleepDurationForReview("não informado"), "");
    assert.equal(sleepDurationForStorage(""), null);
    assert.equal(sleepDurationForReview("aproximadamente sete horas"), "aproximadamente sete horas");
    for (const text of ["01:", "1:90", "25:00", "24:01", "7h 90min", "abc", "1,23 h"]) {
      assert.equal(parseSleepDuration(text), null);
    }
    assert.equal(sleepDurationForStorage("02:15"), "135 min");
    assert.equal(sleepDurationForStorage("7h"), "420 min");
    assert.equal(parseSleepClock("7:30"), 450);
    assert.equal(parseSleepClock("7h30"), 450);
    assert.equal(parseSleepClock("7h"), 420);
    assert.equal(parseSleepClock("07:30"), 450);
    assert.equal(sleepDurationForStorage("7:30"), "450 min");
    assert.equal(sleepDurationForStorage("7h30"), "450 min");
  });
});

describe("sleep stage consistency", () => {
  const complete = {
    quantidade_estimada: "07:00",
    sono_profundo_min: "01:00",
    sono_leve_min: "04:00",
    sono_rem_min: "02:00",
  };

  it("compares the three sleeping stages, excluding awake time", () => {
    const withAwake = { ...complete, acordado_min: "01:00" };
    assert.equal(sleepStageMismatch(withAwake), null);
    assert.equal(sleepStageMismatch({ ...complete, quantidade_estimada: "08:00" }), 420);
    assert.equal(sleepStageMismatch({ ...complete, sono_rem_min: "02:30" }), 450);
  });

  it("does not require absent stages or compare invalid or incomplete times", () => {
    assert.equal(sleepStageMismatch({ ...complete, sono_rem_min: null }), null);
    assert.equal(sleepStageMismatch({ ...complete, sono_leve_min: "" }), null);
    assert.equal(sleepStageMismatch({ ...complete, sono_leve_min: "4h" }), null);
    assert.equal(sleepStageMismatch({ ...complete, quantidade_estimada: "7h" }), null);
    assert.equal(sleepStageMismatch({
      quantidade_estimada: "00:30",
      sono_profundo_min: "00:00",
      sono_leve_min: "00:20",
      sono_rem_min: "00:10",
    }), null);
  });
});