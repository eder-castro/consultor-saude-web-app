import { beforeEach, expect, test } from "bun:test";
import "../test/setup-dom.mjs";
import { z } from "zod";
import { QueryClient } from "@tanstack/react-query";
import { clearSessionState, readSessionState, writeSessionState } from "./session-state";
import { mergeRefreshedHistory } from "./chat-session-cache";
import { persistSessionQueries, restoreSessionQueries } from "./session-query-cache";

beforeEach(() => window.sessionStorage.clear());

test("session snapshots are owner/day scoped, validated and disposable", () => {
  writeSessionState("test", "owner", "draft");
  expect(readSessionState("test", "owner", z.string())).toBe("draft");
  expect(readSessionState("test", "other", z.string())).toBeNull();
  expect(readSessionState("test", "owner", z.number())).toBeNull();
  const entry = JSON.parse(window.sessionStorage.getItem("health:resume:v1:test"));
  window.sessionStorage.setItem("health:resume:v1:test", JSON.stringify({ ...entry, day: "2000-01-01" }));
  expect(readSessionState("test", "owner", z.string())).toBeNull();
  window.sessionStorage.setItem("health:resume:v1:test", "{broken");
  expect(readSessionState("test", "owner", z.string())).toBeNull();
  window.sessionStorage.setItem("unrelated", "keep");
  clearSessionState();
  expect(window.sessionStorage.getItem("health:resume:v1:test")).toBeNull();
  expect(window.sessionStorage.getItem("unrelated")).toBe("keep");
});

test("slow history refresh uses remote changes but never overwrites local edits", () => {
  const baseline = [{ id: "one", role: "user", kind: "text", text: "initial" }];
  const remote = [{ ...baseline[0], text: "remote" }];
  expect(mergeRefreshedHistory(remote, baseline, baseline)[0].text).toBe("remote");
  const edited = [{ ...baseline[0], text: "local edit" }];
  expect(mergeRefreshedHistory(remote, edited, baseline)[0].text).toBe("local edit");
  const newMessage = { ...baseline[0], id: "two" };
  expect(mergeRefreshedHistory(remote, [...baseline, newMessage], baseline)).toHaveLength(2);
});

test("only allowlisted query results restore, after explicit owner verification", () => {
  const client = new QueryClient();
  const stop = persistSessionQueries(client, "owner");
  client.setQueryData(["sleep-reviews"], []);
  client.setQueryData(["photo-input"], { imageBase64: "private-bytes" });
  stop();
  const snapshot = window.sessionStorage.getItem("health:resume:v1:queries");
  expect(snapshot).not.toContain("private-bytes");
  const other = new QueryClient();
  restoreSessionQueries(other, "other");
  expect(other.getQueryData(["sleep-reviews"])).toBeUndefined();
  restoreSessionQueries(other, "owner");
  expect(other.getQueryData(["sleep-reviews"])).toEqual([]);
  expect(other.getQueryState(["sleep-reviews"]).dataUpdatedAt).toBe(1);
  client.clear();
  other.clear();
});

test("stopping persistence before logout prevents teardown events recreating private storage", async () => {
  const client = new QueryClient();
  const stop = persistSessionQueries(client, "owner");
  client.setQueryData(["sleep-reviews"], []);
  expect(window.sessionStorage.getItem("health:resume:v1:queries")).not.toBeNull();
  stop();
  client.clear();
  clearSessionState();
  client.setQueryData(["sleep-reviews"], []);
  window.dispatchEvent(new Event("pagehide"));
  await Promise.resolve();
  expect(Object.keys(window.sessionStorage).filter((key) => key.startsWith("health:resume:"))).toEqual([]);
  client.clear();
});
