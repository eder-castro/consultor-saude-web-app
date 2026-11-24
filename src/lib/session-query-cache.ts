import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { DailySummarySchema, HealthContextSchema, SleepReviewsResponseSchema } from "./api-schemas";
import { DailyAnalysisSummarySchema } from "./daily-analysis-summary";
import { readSessionState, writeSessionState } from "./session-state";

// Explicit allowlist: never serialize mutation inputs, files or photo retries.
const schemas: Record<string, z.ZodTypeAny> = {
  "daily-summary": DailySummarySchema,
  "health-context": HealthContextSchema,
  "sleep-reviews": SleepReviewsResponseSchema.shape.revisoes,
  "daily-analysis-summary": DailyAnalysisSummarySchema,
};
const SnapshotSchema = z.array(z.object({
  key: z.array(z.unknown()),
  updatedAt: z.number().positive(),
  data: z.unknown(),
})).max(20);

export function restoreSessionQueries(client: QueryClient, ownerId: string) {
  const entries = readSessionState("queries", ownerId, SnapshotSchema) ?? [];
  for (const entry of entries) {
    const schema = schemas[String(entry.key[0])];
    const parsed = schema?.safeParse(entry.data);
    if (!parsed?.success || entry.updatedAt > Date.now()) continue;
    if (entry.key[0] === "daily-analysis-summary" && entry.key[1] !== ownerId) continue;
    // Restored snapshots are immediately stale, so other devices' changes
    // refresh in the background while the previous data stays visible.
    client.setQueryData(entry.key, parsed.data, { updatedAt: 1 });
  }
}

export function persistSessionQueries(client: QueryClient, ownerId: string) {
  let active = true;
  const save = () => {
    if (!active) return;
    const entries = client.getQueryCache().getAll().flatMap((query) => {
      const schema = schemas[String(query.queryKey[0])];
      const parsed = schema?.safeParse(query.state.data);
      return parsed?.success ? [{
        key: query.queryKey, updatedAt: query.state.dataUpdatedAt, data: parsed.data,
      }] : [];
    });
    writeSessionState("queries", ownerId, entries);
  };
  const unsubscribe = client.getQueryCache().subscribe(save);
  window.addEventListener("pagehide", save);
  return () => {
    active = false;
    unsubscribe();
    window.removeEventListener("pagehide", save);
  };
}
