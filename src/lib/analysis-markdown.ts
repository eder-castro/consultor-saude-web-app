// Markdown mínimo das análises da IA: grupos separados por linha em branco, linhas
// iniciadas por "- " ou "• " viram listas e **texto** vira negrito. O resultado é uma
// estrutura de dados renderizada como elementos React (nunca HTML cru), então o texto
// vindo do modelo não consegue injetar marcação na página.
export type AnalysisInline = { text: string; bold: boolean };
export type AnalysisBlock =
  | { type: "paragraph"; inlines: AnalysisInline[] }
  | { type: "list"; items: AnalysisInline[][] };
export type AnalysisGroup = AnalysisBlock[];

const LIST_ITEM = /^\s*(?:[-•*]|\d+[.)])\s+/;
const HEADING = /^\s*#{1,6}\s+/;

export function parseAnalysisInlines(line: string): AnalysisInline[] {
  const inlines: AnalysisInline[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) inlines.push({ text: line.slice(last, start), bold: false });
    inlines.push({ text: match[1], bold: true });
    last = start + match[0].length;
  }
  if (last < line.length) inlines.push({ text: line.slice(last), bold: false });
  return inlines;
}

export function parseAnalysisMarkdown(text: string): AnalysisGroup[] {
  const groups: AnalysisGroup[] = [];
  let group: AnalysisGroup = [];

  const closeGroup = () => {
    if (group.length > 0) groups.push(group);
    group = [];
  };

  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeGroup();
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const item = parseAnalysisInlines(line.replace(LIST_ITEM, ""));
      const previous = group.at(-1);
      if (previous?.type === "list") previous.items.push(item);
      else group.push({ type: "list", items: [item] });
      continue;
    }
    if (HEADING.test(line)) {
      // O prompt pede para não usar títulos "#"; se vierem, viram uma linha em negrito.
      group.push({ type: "paragraph", inlines: [{ text: line.replace(HEADING, ""), bold: true }] });
      continue;
    }
    group.push({ type: "paragraph", inlines: parseAnalysisInlines(line.trim()) });
  }
  closeGroup();
  return groups;
}
