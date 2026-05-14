import { useRef, useState } from "react";
import { Camera, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export type ComposerSubmit =
  | { kind: "text"; text: string }
  | { kind: "image"; file: File; previewUrl: string; caption: string };

export function Composer({
  disabled,
  onSubmit,
}: {
  disabled?: boolean;
  onSubmit: (s: ComposerSubmit) => void;
}) {
  const [text, setText] = useState("");
  const [pendingFile, setPendingFile] = useState<{ file: File; url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File | undefined | null) {
    if (!f) return;
    setPendingFile({ file: f, url: URL.createObjectURL(f) });
  }

  function send() {
    if (disabled) return;
    if (pendingFile) {
      onSubmit({
        kind: "image",
        file: pendingFile.file,
        previewUrl: pendingFile.url,
        caption: text.trim(),
      });
      setPendingFile(null);
      setText("");
      return;
    }
    const t = text.trim();
    if (!t) return;
    onSubmit({ kind: "text", text: t });
    setText("");
  }

  return (
    <div className="border-t border-border bg-card/60 p-3 backdrop-blur">
      {pendingFile && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-border bg-background p-2">
          <img
            src={pendingFile.url}
            alt="prévia"
            className="size-14 rounded-lg object-cover"
          />
          <p className="flex-1 text-xs text-muted-foreground">
            Foto pronta para envio. Adicione uma legenda opcional.
          </p>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              URL.revokeObjectURL(pendingFile.url);
              setPendingFile(null);
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          size="icon"
          variant="outline"
          className="size-11 shrink-0 rounded-full"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          aria-label="Anexar foto"
        >
          <Camera className="size-5" />
        </Button>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={
            pendingFile
              ? "Legenda (opcional)..."
              : "Ex: Tomei 500ml de água, dormi 7h, comi..."
          }
          rows={1}
          className="max-h-32 min-h-11 flex-1 resize-none bg-background"
        />

        <Button
          size="icon"
          className="size-11 shrink-0 rounded-full"
          onClick={send}
          disabled={disabled || (!text.trim() && !pendingFile)}
          aria-label="Enviar"
        >
          <Send className="size-5" />
        </Button>
      </div>
    </div>
  );
}
