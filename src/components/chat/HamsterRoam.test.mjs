import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import "../../test/setup-dom.mjs";

const { act, cleanup, render, screen } = await import("@testing-library/react");
const { AnalysisLoading } = await import("./AnalysisLoading");
const {
  claimHamsterRoam, hamsterRoamPose, HAMSTER_ROAM_DELAY_MS,
} = await import("./HamsterRoam.motion");

let timers, frames, mediaListeners, reduced, timerId, frameId;
let original, visibility;

beforeEach(() => {
  timers = new Map();
  frames = new Map();
  mediaListeners = new Set();
  reduced = false;
  timerId = 0;
  frameId = 0;
  visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  original = {
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame, matchMedia: window.matchMedia,
  };
  window.setTimeout = (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  window.requestAnimationFrame = (callback) => {
    const id = ++frameId;
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  window.matchMedia = () => ({
    get matches() { return reduced; },
    addEventListener: (_type, listener) => mediaListeners.add(listener),
    removeEventListener: (_type, listener) => mediaListeners.delete(listener),
  });
});

afterEach(() => {
  cleanup();
  Object.assign(window, original);
  if (visibility) Object.defineProperty(document, "visibilityState", visibility);
  else delete document.visibilityState;
});

const loading = (label = "Aguardando o serviço...", props = {}) =>
  createElement(AnalysisLoading, { label, roaming: true, ...props });

function expireDelay() {
  const [id, timer] = [...timers][0];
  timers.delete(id);
  act(() => timer.callback());
}

test("wheel runs immediately; only prolonged loading releases the same hamster", () => {
  const view = render(loading());
  const wheel = document.querySelector(".hamster-wheel");
  const body = wheel.querySelector(".hamster-wheel__body").getAttribute("d");
  expect(document.querySelector(".hamster-roam-layer")).toBeNull();
  expect([...timers.values()][0].delay).toBe(HAMSTER_ROAM_DELAY_MS);
  const delayId = [...timers.keys()][0];
  view.rerender(loading("Conferindo o resultado..."));
  expect([...timers.keys()]).toEqual([delayId]);
  expect(document.querySelector(".hamster-wheel")).toBe(wheel);

  expireDelay();
  expect(wheel.className).toContain("hamster-wheel--hamster-away");
  const layer = document.querySelector(".hamster-roam-layer");
  expect(layer.parentElement).toBe(document.body);
  expect(layer.getAttribute("aria-hidden")).toBe("true");
  expect(layer.querySelector(".hamster-wheel__body").getAttribute("d")).toBe(body);
  expect(screen.getByRole("status").contains(layer)).toBe(false);
  const [id, draw] = [...frames][0];
  frames.delete(id);
  act(() => draw(performance.now() + 2500));
  expect(layer.querySelector(".hamster-roam-pet").style.transform).toContain("translate3d(");
  view.unmount();
  expect(document.querySelector(".hamster-roam-layer")).toBeNull();
  expect(frames.size).toBe(0);
  expect(timers.size).toBe(0);
  expect(mediaListeners.size).toBe(0);
});

test("a quick response cancels the escape timer", () => {
  const view = render(loading());
  expect(timers.size).toBe(1);
  view.unmount();
  expect(timers.size).toBe(0);
  expect(document.querySelector(".hamster-roam-layer")).toBeNull();
});

test("reduced motion prevents roaming and stops an already active adventure", () => {
  reduced = true;
  render(loading());
  expect(timers.size).toBe(0);
  expect(document.querySelector(".hamster-wheel--hamster-away")).toBeNull();
  act(() => {
    reduced = false;
    mediaListeners.forEach((listener) => listener());
  });
  expireDelay();
  expect(document.querySelector(".hamster-roam-layer")).toBeTruthy();
  act(() => {
    reduced = true;
    mediaListeners.forEach((listener) => listener());
  });
  expect(document.querySelector(".hamster-roam-layer")).toBeNull();
  expect(document.querySelector(".hamster-wheel--hamster-away")).toBeNull();
  expect(frames.size).toBe(0);
});

test("hidden tabs release the pet and resume without a second full delay", () => {
  render(loading());
  expireDelay();
  act(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(document.querySelector(".hamster-roam-layer")).toBeNull();
  expect(frames.size).toBe(0);
  act(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect([...timers.values()][0].delay).toBe(0);
  expireDelay();
  expect(document.querySelectorAll(".hamster-roam-layer")).toHaveLength(1);
});

test("only one pet roams; the next pending analysis takes ownership on completion", () => {
  const first = render(loading("Primeira análise"));
  const second = render(loading("Segunda análise"));
  expireDelay();
  expireDelay();
  expect(document.querySelectorAll(".hamster-roam-layer")).toHaveLength(1);
  expect(document.querySelectorAll(".hamster-wheel--hamster-away")).toHaveLength(1);
  first.unmount();
  expect(document.querySelectorAll(".hamster-roam-layer")).toHaveLength(1);
  expect(second.container.querySelector(".hamster-wheel--hamster-away")).toBeTruthy();
  second.unmount();
  expect(document.querySelector(".hamster-roam-layer")).toBeNull();
});

test("history and background loading do not opt into roaming", () => {
  render(loading("Carregando histórico...", { roaming: false }));
  expect(timers.size).toBe(0);
});

test("ownership cancellation removes queued requests instead of starting ghosts", () => {
  const calls = [];
  const first = claimHamsterRoam(() => calls.push("start-first"), () => calls.push("stop-first"));
  const second = claimHamsterRoam(() => calls.push("start-second"), () => calls.push("stop-second"));
  second();
  first();
  expect(calls).toEqual(["start-first", "stop-first"]);
});

test("path walks both walls, goes into depth and returns without teleporting on repeated laps", () => {
  const bounds = { minX: 33, maxX: 357, minY: 34, maxY: 810 };
  const start = { x: 110, y: 550 };
  expect(hamsterRoamPose(0, start, bounds).x).toBe(start.x);
  expect(hamsterRoamPose(1900, start, bounds).x).toBe(bounds.maxX);
  expect(hamsterRoamPose(5700, start, bounds).x).toBe(bounds.minX);
  expect(hamsterRoamPose(9500, start, bounds).scale).toBe(0.42);
  expect(hamsterRoamPose(11400, start, bounds).scale).toBe(1.05);
  for (let time = 0; time <= 50_000; time += 100) {
    const pose = hamsterRoamPose(time, start, bounds);
    expect(pose.x >= bounds.minX && pose.x <= bounds.maxX).toBe(true);
    expect(pose.y >= bounds.minY && pose.y <= bounds.maxY).toBe(true);
  }
  for (const time of [13300, 15200, 26600, 28500]) {
    const before = hamsterRoamPose(time - 1, start, bounds);
    const after = hamsterRoamPose(time, start, bounds);
    expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeLessThan(1);
  }
});
