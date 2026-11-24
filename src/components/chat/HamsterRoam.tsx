import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import "./HamsterRoam.css";
import {
  claimHamsterRoam,
  hamsterRoamPose,
  HAMSTER_ROAM_DELAY_MS,
  HAMSTER_ROAM_PET_WIDTH_PX,
  type RoamBounds,
} from "./HamsterRoam.motion";
import illustration from "./hamster-wheel.svg?raw";

const runnerMarkup =
  illustration.match(/<g class="hamster-wheel__runner">[\s\S]*?<\/g>/)?.[0] ?? "";
const petMarkup = runnerMarkup
  ? `<svg class="hamster-roam__illustration" xmlns="http://www.w3.org/2000/svg" viewBox="64 90 72 48" role="presentation" focusable="false">${runnerMarkup}</svg>`
  : "";

export function HamsterRoam({
  onRoamChange,
  wheelRef,
}: {
  onRoamChange: (active: boolean) => void;
  wheelRef: RefObject<HTMLSpanElement | null>;
}) {
  const [active, setActive] = useState(false);
  const petRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let release: (() => void) | undefined;
    let elapsed = 0;
    let previousTime = 0;
    let delayTimer = 0;
    let cancelled = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const beginDelay = () => {
      if (cancelled || delayTimer || reducedMotion.matches || document.visibilityState === "hidden")
        return;
      previousTime = performance.now();
      delayTimer = window.setTimeout(
        () => {
          delayTimer = 0;
          elapsed = HAMSTER_ROAM_DELAY_MS;
          release = claimHamsterRoam(
            () => {
              if (!cancelled) {
                setActive(true);
                onRoamChange(true);
              }
            },
            () => {
              if (!cancelled) {
                setActive(false);
                onRoamChange(false);
              }
            },
          );
        },
        Math.max(0, HAMSTER_ROAM_DELAY_MS - elapsed),
      );
    };

    const pauseDelay = () => {
      if (delayTimer) {
        window.clearTimeout(delayTimer);
        delayTimer = 0;
        elapsed += Math.max(0, performance.now() - previousTime);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        pauseDelay();
        if (release) {
          elapsed = HAMSTER_ROAM_DELAY_MS;
          release();
          release = undefined;
        }
      } else {
        beginDelay();
      }
    };

    const onMotionChange = () => {
      if (reducedMotion.matches) {
        pauseDelay();
        release?.();
        release = undefined;
        setActive(false);
        onRoamChange(false);
      } else {
        beginDelay();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotion.addEventListener("change", onMotionChange);
    beginDelay();

    return () => {
      cancelled = true;
      pauseDelay();
      release?.();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotion.removeEventListener("change", onMotionChange);
    };
  }, [onRoamChange]);

  useEffect(() => {
    if (!active || !petRef.current || !layerRef.current) return;

    const pet = petRef.current;
    const layer = layerRef.current;
    const wheel = wheelRef.current;
    const wheelRect =
      wheel?.querySelector(".hamster-wheel__body")?.getBoundingClientRect() ??
      wheel?.getBoundingClientRect();
    const wheelColor = wheel
      ? getComputedStyle(wheel).color
      : getComputedStyle(document.body).color;
    pet.style.color = wheelColor;

    const visualViewport = window.visualViewport;
    const safe = (name: string) => {
      const value = Number.parseFloat(getComputedStyle(layer).getPropertyValue(name));
      return Number.isFinite(value) ? value : 0;
    };
    const start = {
      x: (wheelRect?.left ?? 0) + (wheelRect?.width ?? 62) / 2,
      y: (wheelRect?.top ?? 0) + (wheelRect?.height ?? 45) / 2,
    };
    let bounds: RoamBounds;
    const updateBounds = () => {
      const width = visualViewport?.width ?? window.innerWidth;
      const height = visualViewport?.height ?? window.innerHeight;
      const left = visualViewport?.offsetLeft ?? 0;
      const top = visualViewport?.offsetTop ?? 0;
      // Cache computed styles on viewport changes, not on every animation frame.
      const minX = left + safe("--hamster-safe-left") + HAMSTER_ROAM_PET_WIDTH_PX / 2 + 2;
      const minY = top + safe("--hamster-safe-top") + 34;
      bounds = {
        minX,
        minY,
        maxX: Math.max(
          minX,
          left + width - safe("--hamster-safe-right") - HAMSTER_ROAM_PET_WIDTH_PX / 2 - 2,
        ),
        maxY: Math.max(minY, top + height - safe("--hamster-safe-bottom") - 34),
      };
    };
    updateBounds();
    window.addEventListener("resize", updateBounds);
    visualViewport?.addEventListener("resize", updateBounds);
    visualViewport?.addEventListener("scroll", updateBounds);
    let frame = 0;
    let routeStart = performance.now();
    let pausedAt = 0;
    let paused = document.visibilityState === "hidden";

    const draw = (time: number) => {
      if (paused) return;
      const pose = hamsterRoamPose(time - routeStart, start, bounds);
      pet.style.transform = `translate3d(${pose.x}px, ${pose.y}px, 0) translate(-50%, -50%) rotate(${pose.rotation}deg) scale(${pose.scale}) scaleX(${pose.facing})`;
      frame = window.requestAnimationFrame(draw);
    };

    routeStart = performance.now();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        paused = true;
        pausedAt = performance.now();
        window.cancelAnimationFrame(frame);
      } else if (paused) {
        routeStart += performance.now() - pausedAt;
        paused = false;
        frame = window.requestAnimationFrame(draw);
      }
    };
    if (!paused) frame = window.requestAnimationFrame(draw);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("resize", updateBounds);
      visualViewport?.removeEventListener("resize", updateBounds);
      visualViewport?.removeEventListener("scroll", updateBounds);
    };
  }, [active, wheelRef]);

  if (!active || !petMarkup) return null;

  return createPortal(
    <div className="hamster-roam-layer" aria-hidden="true" ref={layerRef}>
      <div
        className="hamster-roam-pet"
        ref={petRef}
        dangerouslySetInnerHTML={{ __html: petMarkup }}
      />
    </div>,
    document.body,
  );
}
