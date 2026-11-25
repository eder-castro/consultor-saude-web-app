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

// Texto de análise da IA no estilo do GEM: blocos curtos, negrito e listas.
export function AnalysisText({ text, className }: { text: string; className?: string }) {
  const groups = useMemo(() => parseAnalysisMarkdown(text), [text]);
  return (
    <div className={cn("space-y-3 break-words text-sm leading-relaxed", className)}>
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="space-y-1">
          {group.map((block, blockIndex) =>
            block.type === "list" ? (
              <ul
                key={blockIndex}
                className="list-disc space-y-1 pl-5 marker:text-muted-foreground"
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
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
