import { useCallback, useEffect, useRef } from "react";

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

// Toque longo para ações secundárias (remover um item do card). Devolve os handlers de
// ponteiro e `onClick`: o clique que o navegador dispara depois de um toque longo é
// ignorado, então o mesmo elemento pode ter um toque curto (editar) e um longo (remover).
// Arrastar o dedo além de alguns pixels cancela, para não atrapalhar a rolagem.
export function useLongPress(onLongPress: () => void, onClick: () => void, disabled = false) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown(event: React.PointerEvent) {
      if (disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(15);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove(event: React.PointerEvent) {
      if (!start.current) return;
      const dx = Math.abs(event.clientX - start.current.x);
      const dy = Math.abs(event.clientY - start.current.y);
      if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    // O Android abre o menu de copiar/selecionar no toque longo; aqui ele competiria
    // com o gesto.
    onContextMenu(event: React.MouseEvent) {
      if (!disabled) event.preventDefault();
    },
    onClick() {
      if (fired.current) {
        fired.current = false;
        return;
      }
      if (!disabled) onClick();
    },
  };
}
