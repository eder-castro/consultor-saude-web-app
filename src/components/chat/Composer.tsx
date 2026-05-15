import { useRef, useState } from "react";
import { Camera, ImageIcon, Plus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              variant="outline"
              className="size-11 shrink-0 rounded-full"
              disabled={disabled}
              aria-label="Anexar foto"
            >
              <Plus className="size-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 p-1">
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => cameraRef.current?.click()}
            >
              <Camera className="size-4" />
              Câmera
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => galleryRef.current?.click()}
            >
              <ImageIcon className="size-4" />
              Galeria
            </Button>
          </PopoverContent>
        </Popover>

        <Textarea
          ref={textareaRef}
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
          rows={2}
          className="max-h-40 min-h-[3.75rem] flex-1 resize-none bg-background"
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
