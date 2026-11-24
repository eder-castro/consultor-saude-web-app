import "./AnalysisLoading.css";
import { useCallback, useRef, useState } from "react";
import { HamsterWheel } from "./HamsterWheel";
import { HamsterRoam } from "./HamsterRoam";

export interface AnalysisLoadingProps {
  label: string;
  compact?: boolean;
  className?: string;
  roaming?: boolean;
}

export function AnalysisLoading({
  label,
  compact = false,
  className,
  roaming = false,
}: AnalysisLoadingProps) {
  const [hamsterRoaming, setHamsterRoaming] = useState(false);
  const wheelRef = useRef<HTMLSpanElement>(null);
  const setWheelRef = useCallback((node: HTMLSpanElement | null) => {
    wheelRef.current = node;
  }, []);
  const classes = ["analysis-loading", compact ? "analysis-loading--compact" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="status" aria-label={label}>
      <HamsterWheel
        compact={compact}
        hamsterAway={roaming && hamsterRoaming}
        wheelRef={setWheelRef}
      />
      <span className="analysis-loading__label">{label}</span>
      {roaming && <HamsterRoam onRoamChange={setHamsterRoaming} wheelRef={wheelRef} />}
    </div>
  );
}
