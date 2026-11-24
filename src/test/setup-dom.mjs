import { JSDOM } from "jsdom";

// Bun reuses modules between test files. Testing Library binds `screen` to the
// document present at import time, so both component suites must share it.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://example.test/dashboard",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

window.matchMedia ??= (media) => ({
  media, matches: false, onchange: null,
  addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {}, dispatchEvent() { return true; },
});