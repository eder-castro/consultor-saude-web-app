import http from "node:http";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { startupPageHtml } from "./startup-page.mjs";
import { serviceResponds } from "./service-readiness.mjs";

const startedAt = performance.now();
const launchedAtMs = Date.now();
function milestone(phase) {
  console.log("[startup]", JSON.stringify({
    service: "launcher", phase, elapsed_ms: Math.round((performance.now() - startedAt) * 10) / 10,
  }));
}
milestone("launcher_entered");

const publicPort = Number(process.env.PORT || 5000);
const frontendPort = Number(process.env.FRONTEND_INTERNAL_PORT || 3000);
const backendPort = Number(process.env.BACKEND_INTERNAL_PORT || 8000);
const host = "0.0.0.0";
const publicRoot = resolve(".output/public");
const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const children = [
  spawn(
    "python",
    ["-u", "-m", "backend.production"],
    {
      stdio: "inherit",
      env: {
        ...process.env, BACKEND_INTERNAL_PORT: String(backendPort),
        STARTUP_LAUNCHED_AT_MS: String(launchedAtMs),
      },
    },
  ),
  spawn(process.execPath, [".output/server/index.mjs"], {
    stdio: "inherit",
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(frontendPort) },
  }),
];

let backendReady = false;
let frontendReady = false;
let readinessTimer;

async function checkReadiness() {
  // Warm the first SSR response in parallel with Python imports. Do not queue
  // overlapping probes, and do not consider an open socket sufficient.
  await Promise.all([
    backendReady || serviceResponds(backendPort, "/health", "ok").then((ready) => {
      if (ready) {
        backendReady = true;
        milestone("backend_http_ready");
      }
    }),
    frontendReady || serviceResponds(frontendPort, "/login").then((ready) => {
      if (ready) {
        frontendReady = true;
        milestone("frontend_http_ready");
      }
    }),
  ]);
  if (backendReady && frontendReady) {
    milestone("application_ready");
    console.log("Frontend e API prontos para receber solicitações.");
  } else if (!shuttingDown) {
    readinessTimer = setTimeout(checkReadiness, 100);
    readinessTimer.unref();
  }
}

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(readinessTimer);
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

for (const child of children) {
  child.on("spawn", () => milestone(child === children[0] ? "python_spawned" : "frontend_spawned"));
  child.on("error", (error) => {
    console.error(`Falha ao iniciar serviço de produção: ${error.message}`);
    shutdown("SIGTERM");
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `Serviço de produção encerrou inesperadamente (${signal ?? code ?? "desconhecido"}).`,
    );
    shutdown("SIGTERM");
  });
}

const server = http.createServer(async (request, response) => {
  const isApi = request.url === "/api" || request.url?.startsWith("/api/");

  if (!backendReady || !frontendReady) {
    if (isApi || (request.method !== "GET" && request.method !== "HEAD")) {
      response.writeHead(503, {
        "Cache-Control": "no-store",
        "Retry-After": "5",
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ detail: "O aplicativo está iniciando. Tente novamente em instantes." }));
    } else {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      });
      response.end(startupPageHtml);
    }
    return;
  }

  if (!isApi && (request.method === "GET" || request.method === "HEAD")) {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const staticPath = resolve(publicRoot, `.${pathname}`);
      const isInsidePublicRoot =
        staticPath === publicRoot || staticPath.startsWith(`${publicRoot}${sep}`);

      if (isInsidePublicRoot && (await stat(staticPath)).isFile()) {
        response.writeHead(200, {
          "Cache-Control": pathname.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600",
          "Content-Type":
            contentTypes[extname(staticPath).toLowerCase()] ?? "application/octet-stream",
        });
        if (request.method === "HEAD") response.end();
        else createReadStream(staticPath).pipe(response);
        return;
      }
    } catch (error) {
      if (error?.code !== "ENOENT" && error instanceof URIError === false) {
        console.error(`Falha ao localizar arquivo estático ${request.url}:`, error.message);
      }
    }
  }

  const targetPort = isApi ? backendPort : frontendPort;
  const targetPath = isApi ? request.url.slice(4) || "/" : request.url;
  const requestHeaders = Object.fromEntries(
    Object.entries(request.headers).filter(([name]) => !hopByHopHeaders.has(name.toLowerCase())),
  );

  const proxyRequest = http.request(
    {
      hostname: "127.0.0.1",
      port: targetPort,
      method: request.method,
      path: targetPath,
      headers: requestHeaders,
    },
    (proxyResponse) => {
      const responseHeaders = Object.fromEntries(
        Object.entries(proxyResponse.headers).filter(
          ([name]) => !hopByHopHeaders.has(name.toLowerCase()),
        ),
      );
      response.writeHead(proxyResponse.statusCode ?? 502, responseHeaders);
      proxyResponse.pipe(response);
    },
  );

  proxyRequest.on("error", (error) => {
    if (!response.headersSent) {
      response.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    }
    response.end(JSON.stringify({ detail: "Serviço temporariamente indisponível." }));
    console.error(`Falha ao encaminhar ${request.method} ${request.url}:`, error.message);
  });

  request.pipe(proxyRequest);
});

server.listen(publicPort, host, () => {
  milestone("proxy_listening");
  console.log(`Aplicação disponível em http://${host}:${publicPort}`);
  void checkReadiness();
});

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
