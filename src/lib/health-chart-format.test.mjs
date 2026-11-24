import { expect, test } from "bun:test";
import { sleepClockHours, weightDomain } from "./health-chart-format";

test("chart durations always have padded hours and minutes, including zero", () => {
  expect(sleepClockHours(0)).toBe("00:00h");
  expect(sleepClockHours(5 / 60)).toBe("00:05h");
  expect(sleepClockHours(7.5)).toBe("07:30h");
  expect(sleepClockHours(10)).toBe("10:00h");
  expect(sleepClockHours(null)).toBe("—");
});

test("weight axis spans at least 5 kg for empty, single, narrow and broad data", () => {
  for (const values of [[], [80], [80, 80.1], [50, 100], [0.1]]) {
    const [min, max] = weightDomain(values);
    expect(max - min).toBeGreaterThanOrEqual(5);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
    }
  }
});
