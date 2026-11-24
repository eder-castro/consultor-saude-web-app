import "./HamsterWheel.css";
import illustration from "./hamster-wheel.svg?raw";

export function HamsterWheel({
  compact = false,
  hamsterAway = false,
  wheelRef,
}: {
  compact?: boolean;
  hamsterAway?: boolean;
  wheelRef?: (node: HTMLSpanElement | null) => void;
}) {
  return (
    <span
      ref={wheelRef}
      className={[
        "hamster-wheel",
        compact ? "hamster-wheel--compact" : "",
        hamsterAway ? "hamster-wheel--hamster-away" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
      // Trusted, bundled SVG shared with the pre-application startup page.
      dangerouslySetInnerHTML={{ __html: illustration }}
    />
  );
}
