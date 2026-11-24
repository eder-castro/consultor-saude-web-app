const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function retryDelayMs(headers, attempt, now = Date.now()) {
  const fallback = 500 * 2 ** attempt;
  const raw = headers?.get?.("retry-after");
  if (raw == null || String(raw).trim() === "") return fallback;
  const seconds = Number(raw);
  const hint = Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Math.max(0, Date.parse(raw) - now);
  return Number.isFinite(hint) ? Math.max(fallback, hint) : fallback;
}

export function createRequestPacer({ spacingMs = 125, now = Date.now, wait = sleep } = {}) {
  let nextStart = 0;
  let cooldownUntil = 0;
  let pending = Promise.resolve();
  return {
    wait() {
      const turn = pending.then(async () => {
        let delay;
        // Recheck after sleeping: another in-flight response may extend cooldown.
        while ((delay = Math.max(nextStart, cooldownUntil) - now()) > 0) {
          await wait(delay);
        }
        nextStart = now() + spacingMs;
      });
      pending = turn.catch(() => {});
      return turn;
    },
    defer(delayMs) {
      cooldownUntil = Math.max(cooldownUntil, now() + delayMs);
    },
  };
}