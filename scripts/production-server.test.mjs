import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

async function freePort() {
  const server = net.createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function until(check, logs) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(30);
  }
  assert.fail(`Startup did not reach expected state:\n${logs()}`);
}

for (const delayedService of ["backend", "frontend"]) {
  test(`login stays blocked until the ${delayedService} actually responds`, async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "startup-gate-"));
    const [publicPort, frontendPort, backendPort] = await Promise.all([
      freePort(), freePort(), freePort(),
    ]);
    await mkdir(resolve(directory, ".output/server"), { recursive: true });
    await mkdir(resolve(directory, "backend"));
    await writeFile(resolve(directory, ".output/server/index.mjs"), `
      import http from "node:http";
      import { existsSync } from "node:fs";
      http.createServer((_req, res) => {
        res.writeHead(existsSync("frontend-ready") ? 200 : 503);
        res.end("frontend-login-ready");
      }).listen(Number(process.env.PORT), "127.0.0.1", () => console.log("frontend_bound"));
    `);
    await writeFile(resolve(directory, "backend/production.py"), `
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if Path("backend-ready").exists() else 503)
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')
    def log_message(self, *args):
        pass
server = HTTPServer(("127.0.0.1", int(os.environ["BACKEND_INTERNAL_PORT"])), Handler)
print("backend_bound", flush=True)
server.serve_forever()
    `);
    const readyService = delayedService === "backend" ? "frontend" : "backend";
    await writeFile(resolve(directory, `${readyService}-ready`), "");
    const child = spawn(process.execPath, [resolve("scripts/production-server.mjs")], {
      cwd: directory,
      env: { ...process.env, PORT: String(publicPort),
        FRONTEND_INTERNAL_PORT: String(frontendPort), BACKEND_INTERNAL_PORT: String(backendPort) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    child.stdout.on("data", (data) => { logs += data; });
    child.stderr.on("data", (data) => { logs += data; });
    const exited = new Promise((done) => child.once("exit", done));
    const url = `http://127.0.0.1:${publicPort}`;
    try {
      await until(() => logs.includes("backend_bound") && logs.includes("frontend_bound")
        && logs.includes(`${readyService}_http_ready`), () => logs);
      const page = await fetch(`${url}/login`);
      assert.equal(page.status, 200);
      assert.equal(page.headers.get("cache-control"), "no-store");
      const html = await page.text();
      assert.match(html, /Preparando seu diário de saúde/);
      assert.match(html, /http-equiv="refresh" content="5"/);
      assert.doesNotMatch(html, /<form|<script/);
      for (const [path, method] of [["/api/health", "GET"], ["/api/auth/login", "POST"], ["/login", "POST"]]) {
        const result = await fetch(`${url}${path}`, { method });
        assert.equal(result.status, 503);
        assert.equal(result.headers.get("retry-after"), "5");
        assert.match((await result.json()).detail, /iniciando/);
      }
      await writeFile(resolve(directory, `${delayedService}-ready`), "");
      await until(() => logs.includes("application_ready"), () => logs);
      assert.equal(await (await fetch(`${url}/login`)).text(), "frontend-login-ready");
      assert.deepEqual(await (await fetch(`${url}/api/health`)).json(), { status: "ok" });
      child.kill("SIGTERM");
      await exited;
      assert.equal(child.exitCode, 0);
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await exited;
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
}
