import { z } from "zod";

const PREFIX = "health:resume:v1:";
const MAX_BYTES = 1_000_000;

export function sessionDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// This is only a disposable, per-tab cache, never proof of authentication.
// Callers must authenticate first and explicitly omit media and credentials.
export function readSessionState<T>(key: string, ownerId: string, schema: z.ZodType<T>): T | null {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    if (!raw || raw.length > MAX_BYTES) return null;
    const entry = JSON.parse(raw);
    if (entry.ownerId !== ownerId || entry.day !== sessionDay()) return null;
    const parsed = schema.safeParse(entry.data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // Private browsing, quota and malformed caches must not block the app.
  }
}

export function writeSessionState(key: string, ownerId: string, data: unknown) {
  try {
    const raw = JSON.stringify({ ownerId, day: sessionDay(), data });
    if (raw.length > MAX_BYTES) {
      window.sessionStorage.removeItem(PREFIX + key);
      return;
    }
    window.sessionStorage.setItem(PREFIX + key, raw);
  } catch {
    try { window.sessionStorage.removeItem(PREFIX + key); } catch { /* Storage unavailable. */ }
  }
}

export function clearSessionState() {
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch { /* Storage unavailable. */ }
}
