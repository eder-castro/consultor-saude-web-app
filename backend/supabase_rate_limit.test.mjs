import { expect, test } from "bun:test";
import { createRequestPacer, retryDelayMs } from "./supabase_rate_limit.mjs";
import { claimPhoto, listSleepReviews } from "./supabase_health_records.mjs";

test("missing Retry-After uses a real exponential delay instead of Number(null) == 0", () => {
  expect(retryDelayMs({ get: () => null }, 0)).toBe(500);
  expect(retryDelayMs({ get: () => "" }, 1)).toBe(1000);
  expect(retryDelayMs({ get: () => "invalid" }, 0)).toBe(500);
  expect(retryDelayMs({ get: () => "0" }, 0)).toBe(500);
});

test("honors numeric and HTTP-date cooldowns without truncating them to three seconds", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  expect(retryDelayMs({ get: () => "60" }, 0, now)).toBe(60_000);
  expect(retryDelayMs({ get: () => "Fri, 02 Oct 2026 12:00:45 GMT" }, 0, now)).toBe(45_000);
});

test("parallel requests share pacing and cooldown, including cooldown extended during a wait", async () => {
  let time = 0;
  const starts = [];
  const waits = [];
  let pacer;
  pacer = createRequestPacer({
    now: () => time,
    wait: async (delay) => {
      waits.push(delay);
      if (waits.length === 1) pacer.defer(400);
      time += delay;
    },
  });
  await Promise.all([0, 1, 2].map(async () => {
    await pacer.wait();
    starts.push(time);
  }));
  expect(starts).toEqual([0, 400, 525]);
  expect(waits).toEqual([125, 275, 125]);
});

test("does not repeat an unsafe photo claim write after a throttled response", async () => {
  process.env.SESSION_SECRET ??= "unit-test-only";
  let calls = 0;
  await expect(claimPhoto({
    proxy: async () => {
      calls += 1;
      return { ok: false, status: 429, headers: { get: () => "0" }, text: async () => "busy" };
    },
  })).rejects.toMatchObject({ status: 429, retryAfterMs: 500 });
  expect(calls).toBe(1);
});

test("long provider cooldown is returned for the Python gate, not retried until helper timeout", async () => {
  process.env.SESSION_SECRET ??= "unit-test-only";
  let calls = 0;
  await expect(listSleepReviews({
    proxy: async () => {
      calls += 1;
      return { ok: false, status: 429, headers: { get: () => "60" }, text: async () => "busy" };
    },
  }, "8e165e4f-59bc-4b94-9508-4f596ee87584")).rejects.toMatchObject({
    status: 429, retryAfterMs: 60_000,
  });
  expect(calls).toBe(1);
});