import {
  ANALYSIS_TABLES, SupabaseRecordsError, requireOwnerId, supabaseRequest, waterTotalForDay,
} from "./supabase_health_records.mjs";

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function reconciledWater(food, hydration) {
  const rows = [
    ...food.filter((row) => row.evento_tipo === "hidratacao"), ...hydration,
  ].sort((a, b) =>
    String(a.horario ?? "").localeCompare(String(b.horario ?? "")) ||
    Number(a.item === "Total diário de água") - Number(b.item === "Total diário de água"),
  );
  const lastTotal = rows.findLastIndex((row) => row.item === "Total diário de água");
  const relevant = lastTotal < 0 ? rows : rows.slice(lastTotal);
  // Unknown amounts are not zero. Ignore uncertain earlier drinks only when a
  // subsequent declared total has already reconciled them.
  const quantity = /^\s*\d+(?:[.,]\d+)?\s*(?:ml|l|litros?|copos?)?\s*$/i;
  if (relevant.some((row) => !quantity.test(String(row.quantidade ?? "")))) return null;
  return waterTotalForDay(food, hydration);
}

export async function periodAnalysisContext(connectors, payload) {
  const owner = requireOwnerId(payload.owner_id);
  const start = payload.start_date;
  const end = payload.end_date;
  if (!validDate(start) || !validDate(end) || start > end ||
      (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1 > 366) {
    throw new SupabaseRecordsError("invalid_period", "Informe um intervalo válido de até 366 dias.", 422);
  }
  // Never use the frozen seven-day snapshot for a different requested interval.
  const entries = await Promise.all(Object.entries(ANALYSIS_TABLES).map(async ([table, select]) => {
    const rows = [];
    const pageSize = 500;
    for (let offset = 0; offset < 10_000; offset += pageSize) {
      const params = new URLSearchParams({
        select, owner_id: `eq.${owner}`, order: "data.asc,id.asc",
        limit: String(pageSize), offset: String(offset),
      });
      params.append("data", `gte.${start}`);
      params.append("data", `lte.${end}`);
      const response = await supabaseRequest(connectors, `/rest/v1/${table}?${params}`);
      const page = await response.json();
      if (!Array.isArray(page) || page.length > pageSize || page.some(
        (row) => !row || !validDate(row.data) || row.data < start || row.data > end,
      )) {
        throw new SupabaseRecordsError("invalid_period_context", "Não foi possível carregar o período com segurança.", 502);
      }
      rows.push(...page.map(({ import_key, ...row }) => row));
      if (page.length < pageSize) return [table, rows];
    }
    throw new SupabaseRecordsError(
      "period_context_too_large", "Há registros demais para analisar sem omissões. Escolha um intervalo menor.", 422,
    );
  }));
  const records = Object.fromEntries(entries);
  const waterDays = [...new Set([
    ...records.alimentacao.filter((row) => row.evento_tipo === "hidratacao"),
    ...records.hidratacao,
  ].map((row) => row.data))].sort();
  return {
    periodo: { inicio: start, fim: end },
    registros: records,
    agua_registrada_por_dia: waterDays.map((data) => ({
      data,
      total_ml: reconciledWater(
        records.alimentacao.filter((row) => row.data === data),
        records.hidratacao.filter((row) => row.data === data),
      ),
    })),
  };
}