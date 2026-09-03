import { useRef, useState } from "react";
import { Camera, ImageIcon, Plus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ComposerSubmit =
  | { kind: "text"; text: string }
  | { kind: "image"; files: File[]; previewUrls: string[]; caption: string };

const MAX_IMAGES = 6;

export function Composer({
  disabled,
  onSubmit,
}: {
  disabled?: boolean;
  onSubmit: (s: ComposerSubmit) => void;
}) {
  const [text, setText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<{ file: File; url: string }[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function pickFiles(files: FileList | null) {
    setMenuOpen(false);
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    setPendingFiles((current) => {
      const available = Math.max(0, MAX_IMAGES - current.length);
      const selected = selectedFiles
        .filter((file) => file.type.startsWith("image/"))
        .slice(0, available)
        .map((file) => ({ file, url: URL.createObjectURL(file) }));
      return [...current, ...selected];
    });
  }

  function send() {
    if (disabled) return;
    if (pendingFiles.length) {
      onSubmit({
        kind: "image",
        files: pendingFiles.map(({ file }) => file),
        previewUrls: pendingFiles.map(({ url }) => url),
        caption: text.trim(),
      });
      setPendingFiles([]);
      setText("");
      return;
    }
    const t = text.trim();
    if (!t) return;
    onSubmit({ kind: "text", text: t });
    setText("");
  }

  return (
    <div className="border-t border-border/60 bg-background/95 px-3 pb-4 pt-3 backdrop-blur sm:px-6 sm:pb-6">
      <div className="mx-auto w-full max-w-4xl">
        {pendingFiles.length > 0 && (
          <div className="mb-3 rounded-2xl border border-border/70 bg-[#1e1f20] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {pendingFiles.length}{" "}
                {pendingFiles.length === 1 ? "imagem pronta" : "imagens prontas"} para análise
                conjunta
              </p>
              <span className="text-xs text-muted-foreground">
                {pendingFiles.length}/{MAX_IMAGES}
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {pendingFiles.map((pending, index) => (
                <div key={pending.url} className="relative shrink-0">
                  <img
                    src={pending.url}
                    alt={`prévia ${index + 1}`}
                    className="size-20 rounded-xl object-cover"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="absolute -right-1.5 -top-1.5 size-6 rounded-full"
                    aria-label={`Remover imagem ${index + 1}`}
                    onClick={() => {
                      URL.revokeObjectURL(pending.url);
                      setPendingFiles((current) =>
                        current.filter((item) => item.url !== pending.url),
                      );
                    }}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 rounded-3xl border border-border/70 bg-[#1e1f20] p-2 shadow-lg shadow-black/10">
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            suppressHydrationWarning
            onChange={(e) => {
              pickFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            suppressHydrationWarning
            onChange={(e) => {
              pickFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="size-11 shrink-0 rounded-full border-border/70 bg-transparent"
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
            suppressHydrationWarning
            onChange={(e) => setText(e.target.value)}
            placeholder={
              pendingFiles.length
                ? "Legenda para as imagens (opcional)..."
                : "Ex: Tomei 500ml de água, dormi 7h, comi..."
            }
            rows={1}
            className="h-14 max-h-32 min-h-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-3 py-3 text-base leading-6 shadow-none focus-visible:ring-0"
          />

          <Button
            size="icon"
            className="size-11 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={send}
            disabled={disabled || (!text.trim() && pendingFiles.length === 0)}
            aria-label="Enviar"
          >
            <Send className="size-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
