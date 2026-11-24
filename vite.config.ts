import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Entrada SSR própria (src/server.ts), com a página de erro customizada.
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    // Servidor de produção para Bun: gera .output/server/index.mjs, que o
    // scripts/production-server.mjs inicia com HOST/PORT internos.
    command === "build" && nitro({ preset: "bun" }),
    viteReact(),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
    watch: {
      // Evita recargas em cascata quando ferramentas mexem nesses diretórios
      // (ver .agents/memory/development-watch-boundaries.md).
      ignored: [
        "**/.agents/**",
        "**/_arquivo/**",
        "**/.cache/**",
        "**/.claude/**",
        "**/.git/**",
        "**/.local/**",
        "**/.pythonlibs/**",
        "**/.tanstack/tmp/**",
        "**/node_modules/**",
      ],
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
    },
  },
}));
