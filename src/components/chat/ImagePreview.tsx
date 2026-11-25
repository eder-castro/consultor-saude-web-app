import { useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export function ImagePreview({ src, index }: { src: string; index: number }) {
  const [zoom, setZoom] = useState(1);
  return (
    <Dialog onOpenChange={(open) => { if (open) setZoom(1); }}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Ampliar imagem enviada ${index + 1}`}
          className="block size-30 cursor-zoom-in overflow-hidden rounded-[20px] bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* Miniatura quadrada no estilo do Gemini; a foto inteira abre no visualizador. */}
          <img src={src} alt={`imagem enviada ${index + 1}`} className="size-full object-cover" />
        </button>
      </DialogTrigger>
      <DialogContent className="flex h-[100dvh] w-screen max-w-none flex-col gap-3 rounded-none border-0 bg-background p-3 pt-10 sm:h-[95dvh] sm:w-[95vw] sm:max-w-none sm:rounded-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Imagem enviada {index + 1}</DialogTitle>
          <DialogDescription>Confira os detalhes da foto. Use o zoom e arraste a área ampliada para ver o restante.</DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 items-center justify-center gap-2">
          <Button type="button" variant="outline" size="icon" aria-label="Diminuir zoom" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.5))}>
            <ZoomOut className="size-4" />
          </Button>
          <Button type="button" variant="ghost" onClick={() => setZoom(1)} aria-label="Restaurar tamanho da imagem">{Math.round(zoom * 100)}%</Button>
          <Button type="button" variant="outline" size="icon" aria-label="Aumentar zoom" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.5))}>
            <ZoomIn className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-lg bg-black/20" tabIndex={0} aria-label="Foto ampliada">
          <div className="flex min-h-full items-center justify-center" style={{ width: `${zoom * 100}%` }}>
            <img
              src={src}
              alt={`Imagem enviada ${index + 1} ampliada`}
              draggable={false}
              className={zoom === 1 ? "max-h-[65dvh] max-w-full object-contain" : "w-full max-w-none object-contain"}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
