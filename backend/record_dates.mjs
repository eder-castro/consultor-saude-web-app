import { supabaseRequest, SupabaseRecordsError, requireOwnerId } from "./supabase_health_records.mjs";

const tables = {
  alimentacao: "id,data,horario,item,quantidade,evento_tipo",
  hidratacao: "id,data,horario,item,quantidade",
  exercicios: "id,data,tipo,duracao_min",
  sono: "id,data,inicio,duracao_minutos",
  peso: "id,data,horario,valor_kg",
};

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function datedRecords(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  if (!validDate(payload.data)) throw new SupabaseRecordsError("invalid_date", "Confira a data dos registros.", 422);
  const registros = [];
  // Sequential, paginated reads respect the connector ceiling and never silently truncate a day.
  for (const [table, select] of Object.entries(tables)) {
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({
        select, data: `eq.${payload.data}`, owner_id: `eq.${ownerId}`,
        order: "id.asc", limit: "200", offset: String(page * 200),
      });
      const rows = await (await supabaseRequest(connectors, `/rest/v1/${table}?${params}`)).json();
      if (!Array.isArray(rows) || rows.some((row) => row.data !== payload.data)) {
        throw new SupabaseRecordsError("invalid_records", "Não foi possível carregar os registros com segurança.", 502);
      }
      for (const row of rows) {
        registros.push({
          table, id: String(row.id),
          evento_tipo: row.evento_tipo ?? ({ exercicios: "exercicio" }[table] ?? table),
          item: row.item ?? row.tipo ?? (table === "sono" ? "Sono total" : "Peso"),
          quantidade: row.quantidade ?? row.duracao_minutos ??
            (row.duracao_min == null ? (row.valor_kg == null ? null : `${row.valor_kg} kg`) : `${row.duracao_min} min`),
          horario: row.horario ?? row.inicio ?? null,
        });
      }
      if (rows.length < 200) break;
      if (page === 19) throw new SupabaseRecordsError("too_many_records", "Há registros demais neste dia para carregar sem omissões.", 422);
    }
  }
  return { data: payload.data, registros };
}

export async function changeRecordDates(connectors, payload) {
  const ownerId = requireOwnerId(payload.owner_id);
  const refs = payload.records;
  if (!validDate(payload.source_date) || !validDate(payload.target_date) ||
      payload.source_date === payload.target_date ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(payload.operation_id ?? "") ||
      !Array.isArray(refs) || !refs.length || refs.length > 100 ||
      refs.some((ref) => !ref || !Object.hasOwn(tables, ref.table) || !/^[1-9]\d{0,18}$/.test(ref.id)) ||
      new Set(refs.map((ref) => `${ref.table}:${ref.id}`)).size !== refs.length) {
    throw new SupabaseRecordsError("invalid_date_correction", "Confira os registros e as datas antes de confirmar.", 422);
  }
  const response = await supabaseRequest(connectors, "/rest/v1/rpc/change_health_record_dates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_owner_id: ownerId, p_operation_id: payload.operation_id,
      p_source_date: payload.source_date, p_target_date: payload.target_date,
      p_records: refs,
    }),
  });
  return response.json();
}
