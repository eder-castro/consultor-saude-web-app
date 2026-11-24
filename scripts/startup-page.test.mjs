import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { startupPageHtml } from "./startup-page.mjs";

test("startup animation uses the shared SVG and runs above the existing title", () => {
  const svg = readFileSync(new URL("../src/components/chat/hamster-wheel.svg", import.meta.url), "utf8");
  assert.ok(startupPageHtml.includes(svg));
  assert.ok(startupPageHtml.indexOf('class="hamster-wheel"') < startupPageHtml.indexOf("<h1"));
  assert.ok(startupPageHtml.includes("Preparando seu diário de saúde"));
  assert.ok(startupPageHtml.includes("Esta página atualizará automaticamente."));
});

test("cold-start page needs no external assets or JavaScript and keeps auto-refresh", () => {
  assert.match(startupPageHtml, /http-equiv="refresh" content="5"/);
  assert.match(startupPageHtml, /@keyframes hamster-wheel-turn/);
  assert.match(startupPageHtml, /prefers-reduced-motion: reduce/);
  assert.match(startupPageHtml, /aria-hidden="true"/);
  assert.doesNotMatch(startupPageHtml, /<script|<link|\bsrc=/);
});

test("production readiness still gates both services and uses the startup page", () => {
  const launcher = readFileSync(new URL("./production-server.mjs", import.meta.url), "utf8");
  assert.match(launcher, /if \(!backendReady \|\| !frontendReady\)/);
  assert.match(launcher, /response\.end\(startupPageHtml\)/);
  assert.match(launcher, /"Retry-After": "5"/);
});
