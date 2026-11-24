import { readFileSync } from "node:fs";

// Inline the same assets as the app: cold-start feedback must not depend on
// React, JavaScript hydration, an asset request, or either child service.
const illustration = readFileSync(
  new URL("../src/components/chat/hamster-wheel.svg", import.meta.url), "utf8",
);
const animationStyles = readFileSync(
  new URL("../src/components/chat/HamsterWheel.css", import.meta.url), "utf8",
);

export const startupPageHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="5">
  <title>Iniciando — Meu Dia</title>
  <style>
    ${animationStyles}
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      min-height: 100svh;
      display: grid;
      place-items: center;
      padding: 32px 24px;
      background: #191919;
      color: #eee;
      font: 16px/1.5 system-ui, sans-serif;
      text-align: center;
    }
    main {
      width: 100%;
      max-width: 32rem;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    main .hamster-wheel {
      flex: none;
      width: 10rem;
      height: 9.32rem;
      margin-bottom: 28px;
      color: currentColor;
    }
    h1 {
      margin: 0;
      max-width: 25rem;
      font-size: clamp(1.65rem, 7vw, 2rem);
      font-weight: 600;
      line-height: 1.3;
      text-wrap: balance;
    }
    p { margin: 24px 0 0; max-width: 28rem; }
  </style>
</head>
<body>
  <main aria-labelledby="startup-title" aria-live="polite">
    <span class="hamster-wheel" aria-hidden="true">${illustration}</span>
    <h1 id="startup-title">Preparando seu diário de saúde</h1>
    <p>O serviço ainda está iniciando. Esta página atualizará automaticamente.</p>
  </main>
</body>
</html>`;
