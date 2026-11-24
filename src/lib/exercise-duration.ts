const MAX_EXERCISE_SECONDS = 86_400;

export function parseExerciseDurationSeconds(value: string | null | undefined): number | null {
  const text = value?.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;

  let seconds: number;
  const minuteClock = text.match(/^(\d+):([0-5]\d)$/);
  const hourClock = text.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/);
  if (minuteClock) {
    seconds = Number(minuteClock[1]) * 60 + Number(minuteClock[2]);
  } else if (hourClock) {
    seconds = Number(hourClock[1]) * 3600 + Number(hourClock[2]) * 60 + Number(hourClock[3]);
  } else {
    const units = text.match(
      /^(?:(\d+)\s*(?:h|horas?|hours?)\s*)?(?:(\d+)\s*(?:min|minutes?|minutos?)\s*)?(?:(\d+)\s*(?:s|seg|segundos?|seconds?)\s*)?$/,
    );
    if (
      !units ||
      !units[0].trim() ||
      (units[1] === undefined && units[2] === undefined && units[3] === undefined)
    ) {
      return null;
    }
    if (units[1] !== undefined && Number(units[2] ?? 0) >= 60) return null;
    if ((units[1] !== undefined || units[2] !== undefined) && Number(units[3] ?? 0) >= 60) {
      return null;
    }
    seconds = Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  }

  return Number.isInteger(seconds) && seconds > 0 && seconds <= MAX_EXERCISE_SECONDS
    ? seconds
    : null;
}
