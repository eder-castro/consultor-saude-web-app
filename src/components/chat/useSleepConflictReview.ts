import { useEffect, useState } from "react";
import { getSleepDayStatus } from "@/lib/api";
import type { ValidationGroup } from "@/lib/api-schemas";

type DayStatus = Awaited<ReturnType<typeof getSleepDayStatus>>;
export function useSleepConflictReview(groups: ValidationGroup[], enabled: boolean) {
  const dates = [...new Set(groups.filter(group => group.evento_tipo === "sono" &&
    group.itens.some(item => item.confirmado && item.item.trim()))
    .map(group => group.data ?? ""))].sort();
  const key = enabled ? dates.join(",") : "";
  const valid = dates.every(date => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ key: string; version: number; statuses: DayStatus[]; error: string }>({
    key: "", version: 0, statuses: [], error: "",
  });
  const [approvals, setApprovals] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    setApprovals({});
    if (!key || !valid) return () => { cancelled = true; };
    Promise.all(key.split(",").map(getSleepDayStatus)).then(statuses => {
      if (!cancelled) setState({ key, version, statuses, error: "" });
    }).catch(error => {
      if (!cancelled) setState({ key, version, statuses: [],
        error: error instanceof Error ? error.message : "Não foi possível conferir o sono salvo." });
    });
    return () => { cancelled = true; };
  }, [key, valid, version]);
  const current = state.key === key && state.version === version;
  const loading = Boolean(key && valid && !current);
  const conflicts = current ? state.statuses.filter(day => day.count > 0) : [];
  const error = current ? state.error : "";
  return {
    loading, error, conflicts,
    blocked: Boolean(key && (!valid || loading || error || conflicts.some(day => approvals[day.data] !== day.token))),
    replacements: conflicts.filter(day => approvals[day.data] === day.token)
      .map(day => ({ data: day.data, expected_token: day.token })),
    approved: (day: DayStatus) => approvals[day.data] === day.token,
    approve: (day: DayStatus, checked: boolean) => setApprovals(current => ({
      ...current, [day.data]: checked ? day.token : "",
    })),
    refresh: () => setVersion(current => current + 1),
  };
}
