import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import "../../test/setup-dom.mjs";

const { cleanup, render, screen } = await import("@testing-library/react");
const { AnalysisLoading } = await import("./AnalysisLoading");
const { MessageTime } = await import("./MessageTime");
afterEach(cleanup);

test("chat analyses keep the original wheel and never opt into the roaming adventure", () => {
  const feed = readFileSync(new URL("./ChatFeed.tsx", import.meta.url), "utf8");
  expect(feed).not.toMatch(/\broaming\b/);
  render(createElement(AnalysisLoading, { label: "Analisando..." }));
  expect(document.querySelector(".hamster-wheel__runner")).toBeTruthy();
  expect(document.querySelector(".hamster-roam-layer")).toBeNull();
  expect(document.querySelector(".hamster-wheel--hamster-away")).toBeNull();
});

test("shorter legs move with the runner along the wheel's arc without scaling its body", () => {
  render(createElement(AnalysisLoading, { label: "Analisando..." }));
  const travel = document.querySelector(".hamster-wheel__travel");
  expect(travel.querySelector(".hamster-wheel__runner")).toBeTruthy();
  expect(travel.querySelector(".hamster-wheel__track-contact").getAttribute("transform"))
    .toBe("translate(0 4)");
  expect(travel.querySelector(".hamster-wheel__leg--back").getAttribute("d"))
    .toBe("M80 125q-3 5-8 5M83 126q-2 5-7 4");
  expect(travel.querySelector(".hamster-wheel__leg--front").getAttribute("d"))
    .toBe("M103 123q2 5 8 5M106 123q3 1 6 0");
  const css = readFileSync(new URL("./HamsterWheel.css", import.meta.url), "utf8");
  expect(css).toMatch(/\.hamster-wheel__travel\s*\{[^}]*transform-origin:\s*88px 78px;[^}]*animation:\s*hamster-track-travel/);
  expect(css).toMatch(/@keyframes hamster-track-travel\s*\{\s*0%, 100%\s*\{\s*transform: rotate\(-12deg\);/);
  expect(css).toMatch(/50%\s*\{\s*transform: rotate\(12deg\);/);
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  expect(css).not.toContain("scale(");
});

test("analysis loading is accessible and supports compact presentation", () => {
  render(createElement(AnalysisLoading, { label: "Analisando o registro salvo...", compact: true }));
  const status = screen.getByRole("status", { name: "Analisando o registro salvo..." });
  expect(status.className).toContain("analysis-loading--compact");
  expect(status.querySelector(".analysis-loading__skeleton")).toBeNull();
  expect(status.querySelector(".hamster-wheel").getAttribute("aria-hidden")).toBe("true");
  expect(status.querySelector(".hamster-wheel--compact")).toBeTruthy();
});

test("hamster is visible immediately and stays mounted when the actual stage changes", () => {
  const { rerender } = render(createElement(AnalysisLoading, {
    label: "Consultando seus registros...",
  }));
  const wheel = document.querySelector(".hamster-wheel");
  expect(wheel).toBeTruthy();
  rerender(createElement(AnalysisLoading, {
    label: "Aguardando o serviço de análise...",
  }));
  expect(document.querySelector(".hamster-wheel")).toBe(wheel);
  expect(screen.getByRole("status", { name: "Aguardando o serviço de análise..." })).toBeTruthy();
  expect(document.querySelector(".analysis-loading__skeleton")).toBeNull();
  rerender(createElement(AnalysisLoading, {
    label: "Tentando novamente...",
  }));
  expect(document.querySelector(".hamster-wheel")).toBeTruthy();
});

test("the smaller hamster is shown from the start of a new attempt without skeleton", () => {
  const { rerender } = render(createElement(AnalysisLoading, {
    label: "Aguardando...",
  }));
  expect(document.querySelector(".hamster-wheel")).toBeTruthy();
  expect(document.querySelector(".hamster-wheel__rim").getAttribute("stroke-dasharray"))
    .toBe("27 3");
  expect(document.querySelector(".hamster-wheel__body").getAttribute("fill-rule"))
    .toBe("evenodd");
  rerender(createElement(AnalysisLoading, {
    label: "Nova tentativa...",
  }));
  expect(document.querySelector(".hamster-wheel")).toBeTruthy();
  expect(document.querySelector(".analysis-loading__skeleton")).toBeNull();
});
test("message timestamps use Sao Paulo time and ignore missing or invalid times", () => {
  const { rerender } = render(createElement(MessageTime, {
    value: "2026-10-01T20:53:00Z", outgoing: true,
  }));
  const time = screen.getByText("17:53");
  expect(time.tagName).toBe("TIME");
  expect(time.getAttribute("datetime")).toBe("2026-10-01T20:53:00Z");
  expect(time.getAttribute("title")).toContain("São Paulo");
  expect(time.parentElement.className).toContain("justify-end");
  rerender(createElement(MessageTime, { value: "not-a-date" }));
  expect(document.querySelector("time")).toBeNull();
  rerender(createElement(MessageTime, {}));
  expect(document.querySelector("time")).toBeNull();
});