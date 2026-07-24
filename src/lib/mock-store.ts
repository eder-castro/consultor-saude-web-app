import type { DailySummary, EventoTipo, Item } from "./api-schemas";

type DayState = {
  agua_ml: number;
  refeicoes: { hora: string; itens: { item: string; quantidade: string }[] }[];
  exercicio: string | null;
  sono_horas: number | null;
  peso_kg: number | null;
};

const today = () => new Date().toISOString().slice(0, 10);

const state: DayState = {
  agua_ml: 0,
  refeicoes: [],
  exercicio: null,
  sono_horas: null,
  peso_kg: null,
};

function nowHora() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function parseMl(qty: string): number {
  const m = qty.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|litros?|copos?)/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(",", "."));
  const unit = m[2].toLowerCase();
  if (unit.startsWith("l")) return Math.round(n * 1000);
  if (unit.startsWith("copo")) return Math.round(n * 250);
  return Math.round(n);
}

function parseHoras(qty: string): number | null {
  const m = qty.match(/(\d+(?:[.,]\d+)?)\s*h/i);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

function parseKg(qty: string): number | null {
  const m = qty.match(/(\d+(?:[.,]\d+)?)\s*kg/i);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

export function recordItems(evento_tipo: EventoTipo, itens: Item[]) {
  if (evento_tipo === "alimentacao") {
    state.refeicoes.push({
      hora: nowHora(),
      itens: itens.map((i) => ({ item: i.item, quantidade: i.quantidade_estimada })),
    });
  } else if (evento_tipo === "hidratacao") {
    for (const i of itens) state.agua_ml += parseMl(i.quantidade_estimada);
  } else if (evento_tipo === "exercicio") {
    state.exercicio = itens.map((i) => `${i.item} (${i.quantidade_estimada})`).join(", ");
  } else if (evento_tipo === "sono") {
    const h = parseHoras(itens[0]?.quantidade_estimada ?? "");
    if (h !== null) state.sono_horas = h;
  } else if (evento_tipo === "peso") {
    const k = parseKg(itens[0]?.quantidade_estimada ?? "");
    if (k !== null) state.peso_kg = k;
  }
}

export function getMockSummary(): DailySummary {
  return {
    data: today(),
    agua_ml: state.agua_ml,
    agua_meta_ml: 2500,
    refeicoes: state.refeicoes,
    exercicio: state.exercicio,
    sono_horas: state.sono_horas,
    peso_kg: state.peso_kg,
    tendencia: state.peso_kg ? "estável nos últimos 7 dias" : null,
  };
}
