export function sleepClockHours(value: unknown) {
  if (value == null || value === "") return "—";
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0) return "—";
  const minutes = Math.round(hours * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}h`;
}

export function weightDomain(values: (number | null)[]): [number, number] {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return [0, 5];
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const span = Math.max(5, max - min + 1);
  const lower = Math.max(0, Math.floor(((min + max) / 2 - span / 2) * 10) / 10);
  return [lower, Math.ceil(Math.max(lower + 5, (min + max) / 2 + span / 2) * 10) / 10];
}
