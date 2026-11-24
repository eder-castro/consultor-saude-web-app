import { strict as assert } from "node:assert";
import http from "node:http";
import { test } from "node:test";
import { serviceResponds } from "./service-readiness.mjs";

test("readiness requires a successful HTTP response and the API health contract", async () => {
  let statusCode = 503;
  let body = '{"status":"ok"}';
  const server = http.createServer((_request, response) => {
    response.writeHead(statusCode);
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    assert.equal(await serviceResponds(port, "/health", "ok"), false);
    statusCode = 200;
    body = '{"status":"starting"}';
    assert.equal(await serviceResponds(port, "/health", "ok"), false);
    body = "not json";
    assert.equal(await serviceResponds(port, "/health", "ok"), false);
    body = '{"status":"ok"}';
    assert.equal(await serviceResponds(port, "/health", "ok"), true);
    assert.equal(await serviceResponds(port, "/login"), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await serviceResponds(port, "/health", "ok"), false);
});

test("a service that accepts TCP but never answers cannot release readiness", async () => {
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    assert.equal(await serviceResponds(server.address().port, "/health", "ok", 30), false);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
