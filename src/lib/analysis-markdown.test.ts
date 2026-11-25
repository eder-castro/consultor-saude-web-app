import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseAnalysisInlines, parseAnalysisMarkdown } from "./analysis-markdown";

describe("analysis markdown", () => {
  it("separa blocos, listas e negrito no formato do GEM", () => {
    const groups = parseAnalysisMarkdown(
      "💡 **Insight:** proteína boa no café.\n\n" +
        "✅ **Pontos positivos:**\n- Ovos e ricota\n- Fibras do mamão\n\n" +
        "👉 **Próximo passo:** beba água.",
    );
    assert.equal(groups.length, 3);
    assert.deepEqual(groups[0], [
      {
        type: "paragraph",
        inlines: [
          { text: "💡 ", bold: false },
          { text: "Insight:", bold: true },
          { text: " proteína boa no café.", bold: false },
        ],
      },
    ]);
    assert.equal(groups[1][0].type, "paragraph");
    assert.deepEqual(groups[1][1], {
      type: "list",
      items: [[{ text: "Ovos e ricota", bold: false }], [{ text: "Fibras do mamão", bold: false }]],
    });
  });

  it("mantém texto antigo sem markdown como parágrafos", () => {
    const groups = parseAnalysisMarkdown("Leitura do registro: ok.\r\n\r\nPróximo passo: dormir.");
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[1], [
      { type: "paragraph", inlines: [{ text: "Próximo passo: dormir.", bold: false }] },
    ]);
  });

  it("não interpreta HTML nem asteriscos soltos", () => {
    assert.deepEqual(parseAnalysisInlines("<b>x</b> 2 * 3 **"), [
      { text: "<b>x</b> 2 * 3 **", bold: false },
    ]);
  });

  it("converte títulos # em linha em negrito", () => {
    assert.deepEqual(parseAnalysisMarkdown("## Resumo"), [
      [{ type: "paragraph", inlines: [{ text: "Resumo", bold: true }] }],
    ]);
  });
});
