// Run against the existing production build; does not publish or change resources.
import { spawn } from "node:child_process";
import net from "node:net";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

async function freePort() {
  const server = net.createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

const runs = Number(process.argv[2] ?? "3");
if (!Number.isInteger(runs) || runs < 1 || runs > 20) {
  throw new Error("Use: node scripts/measure-startup.mjs [runs: 1–20]");
}
const runtime = process.env.STARTUP_BENCHMARK_RUNTIME || "bun";
for (let run = 1; run <= runs; run++) {
  const ports = [];
  while (ports.length < 3) {
    const port = await freePort();
    if (!ports.includes(port)) ports.push(port);
  }
  const [publicPort, frontendPort, backendPort] = ports;
  const started = performance.now();
  const phases = [];
  const observed = {};
  let pending = "";
  const child = spawn(runtime, ["scripts/production-server.mjs"], {
    env: { ...process.env, PORT: String(publicPort), FRONTEND_INTERNAL_PORT: String(frontendPort),
      BACKEND_INTERNAL_PORT: String(backendPort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const finished = new Promise((done) => child.once("close", done));
  let spawnError;
  child.on("error", (error) => { spawnError = error; });
  child.stdout.on("data", (data) => {
    pending += data;
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) {
      if (line.startsWith("[startup] ")) {
        try {
          const phase = JSON.parse(line.slice(10));
          phases.push(phase);
          observed[phase.phase] = Math.round((performance.now() - started) * 10) / 10;
        } catch { /* Other service output is not a timing record. */ }
      }
    }
  });
  // Drain service logs without persisting health records or request content.
  child.stderr.resume();
  try {
    while (!observed.application_ready) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Startup process exited before readiness.");
      if (performance.now() - started > 180_000) throw new Error("Startup exceeded 180 seconds.");
      await delay(20);
    }
    const url = `http://127.0.0.1:${publicPort}`;
    const pageStarted = performance.now();
    const page = await fetch(`${url}/login`, { signal: AbortSignal.timeout(5_000) });
    await page.text();
    const loginMs = Math.round((performance.now() - pageStarted) * 10) / 10;
    const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5_000) });
    if (page.status !== 200 || health.status !== 200 || (await health.json()).status !== "ok") {
      throw new Error("Production build failed the login/health response checks.");
    }
    console.log(JSON.stringify({ run, runtime, observed_ms: observed, login_response_ms: loginMs, phases }));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const stopTimer = setTimeout(() => child.kill("SIGKILL"), 6_000);
      stopTimer.unref();
      await finished;
      clearTimeout(stopTimer);
    }
  }
}
