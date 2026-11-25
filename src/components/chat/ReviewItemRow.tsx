import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/api-schemas";
import { useLongPress } from "./useLongPress";

type Mode = "view" | "edit" | "confirm-remove";

type Props = {
  item: Item;
  mode: Mode;
  readonly: boolean;
  quantityPlaceholder?: string;
  onEdit: () => void;
  onDone: () => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
  onChange: (patch: Partial<Item>) => void;
};

// Linha de um item no card de registro: lista compacta "item — quantidade".
// Toque curto abre a edição só desse item; toque longo pede confirmação para remover.
export function ReviewItemRow({
  item,
  mode,
  readonly,
  quantityPlaceholder = "Quantidade",
  onEdit,
  onDone,
  onAskRemove,
  onCancelRemove,
  onRemove,
  onChange,
}: Props) {
  const press = useLongPress(onAskRemove, onEdit, readonly);
  const name = item.item.trim() || "Novo item";

  if (!readonly && mode === "edit") {
    return (
      <li className="space-y-2 py-3">
        <label className="block text-xs text-muted-foreground">
          Item
          <Input
            autoFocus
            value={item.item}
            onChange={(event) => onChange({ item: event.target.value })}
            placeholder="Ex.: arroz integral"
            className="mt-1 h-10 bg-background text-base text-foreground"
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Quantidade
          <Input
            value={item.quantidade_estimada}
            onChange={(event) => onChange({ quantidade_estimada: event.target.value })}
            placeholder={quantityPlaceholder}
            className="mt-1 h-10 bg-background text-base text-foreground"
          />
        </label>
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            className="h-10 text-destructive"
            onClick={onRemove}
          >
            Remover
          </Button>
          <Button type="button" variant="secondary" className="h-10 px-5" onClick={onDone}>
            OK
          </Button>
        </div>
      </li>
    );
  }

  if (!readonly && mode === "confirm-remove") {
    return (
      <li className="-mx-2 flex min-h-11 items-center justify-between gap-2 rounded-xl bg-destructive/10 px-2 py-1.5">
        <span className="min-w-0 break-words text-[15px]">
          Remover <strong className="font-semibold">{name}</strong>?
        </span>
        <span className="flex shrink-0 gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-10" onClick={onCancelRemove}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" size="sm" className="h-10" onClick={onRemove}>
            Remover
          </Button>
        </span>
      </li>
    );
  }

  const content = (
    <>
      <span className="min-w-0 break-words">{name}</span>
      <span className="shrink-0 text-right text-muted-foreground">
        {item.quantidade_estimada.trim() || "—"}
      </span>
    </>
  );

  return (
    <li className={cn("flex items-center", !item.confirmado && "opacity-60")}>
      {!readonly && (
        <button
          type="button"
          role="checkbox"
          aria-checked={item.confirmado}
          aria-label={`Incluir ${name}`}
          onClick={() => onChange({ confirmado: !item.confirmado })}
          className="-ml-2.5 grid size-11 shrink-0 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn(
              "grid size-5 place-items-center rounded-full border",
              item.confirmado
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/70",
            )}
          >
            {item.confirmado && <Check className="size-3.5" strokeWidth={3} />}
          </span>
        </button>
      )}
      {readonly ? (
        <div className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 py-2 text-[15px]">
          {content}
        </div>
      ) : (
        <button
          type="button"
          {...press}
          aria-label={`Corrigir ${name}`}
          className="flex min-h-11 min-w-0 flex-1 select-none items-center justify-between gap-3 py-2 text-left text-[15px] [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {content}
        </button>
      )}
    </li>
  );
}
