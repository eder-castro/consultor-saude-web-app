const MAX_MINUTES = 24 * 60;

export function parseSleepClock(value: string): number | null {
  return parseSleepDuration(value);
}

export function parseSleepDuration(value: string): number | null {
  const text = value.trim().toLowerCase().replace(/\s+e\s+/g, " ");
  if (!text) return null;

  const clock = text.match(/^(\d{1,2}):([0-5]\d)$/);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    const total = hours * 60 + minutes;
    return total <= MAX_MINUTES ? total : null;
  }

  const hours = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:h(?:rs?)?|horas?)\s*(?:(\d+)\s*(?:m|min(?:utos?)?)?)?$/);
  const minutes = text.match(/^(\d+)\s*(?:m|min(?:utos?)?)?$/);
  let total: number;
  if (hours) {
    total = Number(hours[1].replace(",", ".")) * 60 + Number(hours[2] ?? 0);
    if (Number(hours[2] ?? 0) >= 60) return null;
  } else if (minutes) {
    total = Number(minutes[1]);
  } else {
    return null;
  }
  return Number.isInteger(total) && total >= 0 && total <= MAX_MINUTES ? total : null;
}

export function formatSleepDuration(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function sleepDurationForReview(value: string | null | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw || /^(?:n[aã]o informado|n[aã]o informada|n\/a|—|-)$|^null$/i.test(raw)) return "";
  const minutes = parseSleepDuration(raw);
  return minutes === null ? raw : formatSleepDuration(minutes);
}

export function sleepDurationForStorage(value: string): string | null {
  const minutes = parseSleepDuration(value);
  return minutes === null ? null : `${minutes} min`;
}

type SleepStageReview = {
  quantidade_estimada: string;
  sono_profundo_min?: string | null;
  sono_leve_min?: string | null;
  sono_rem_min?: string | null;
};

// Only compare complete, valid sleeping stages. Awake time is not part of sleep duration.
export function sleepStageMismatch(item: SleepStageReview): number | null {
  const total = parseSleepDuration(item.quantidade_estimada);
  const stages = [item.sono_profundo_min, item.sono_leve_min, item.sono_rem_min];
  if (total === null || stages.some((stage) => !stage?.trim())) return null;
  let stageTotal = 0;
  for (const stage of stages) {
    const minutes = parseSleepDuration(stage!);
    if (minutes === null) return null;
    stageTotal += minutes;
  }
  return stageTotal === total ? null : stageTotal;
}