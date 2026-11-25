import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { parseAnalysisMarkdown, type AnalysisInline } from "@/lib/analysis-markdown";

function Inlines({ inlines }: { inlines: AnalysisInline[] }) {
  return (
    <>
      {inlines.map((inline, index) =>
        inline.bold ? (
          <strong key={index} className="font-semibold">
            {inline.text}
          </strong>
        ) : (
          <span key={index}>{inline.text}</span>
        ),
      )}
    </>
  );
}

// Texto de análise da IA no estilo do Gemini: blocos com respiro, títulos encostados na
// margem e bullets vazados bem recuados.
export function AnalysisText({ text, className }: { text: string; className?: string }) {
  const groups = useMemo(() => parseAnalysisMarkdown(text), [text]);
  return (
    <div className={cn("space-y-5 break-words text-base leading-[1.6]", className)}>
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="space-y-2.5">
          {group.map((block, blockIndex) =>
            block.type === "list" ? (
              <ul
                key={blockIndex}
                className="list-[circle] space-y-2.5 pl-11 marker:text-muted-foreground"
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="pl-2.5">
                    <Inlines inlines={item} />
                  </li>
                ))}
              </ul>
            ) : (
              <p key={blockIndex}>
                <Inlines inlines={block.inlines} />
              </p>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
