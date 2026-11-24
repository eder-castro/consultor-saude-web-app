# Roadmap

Melhorias identificadas na revisão do código (nov/2026). O app já funciona em produção. Os itens
abaixo tratam de robustez, manutenção e evolução.

## 🔴 Alta prioridade

- [ ] **Cold start lento** (50–110 s antes do Uvicorn subir, ver `docs/startup-measurements.md`).
  Investigar com os novos marcos; avaliar deploy "Reserved VM" ou manter uma instância aquecida.
- [ ] **CI no GitHub Actions**: lint, build e `npm test` em cada push/PR. Hoje nada roda fora do Replit.
- [x] **Fluxo de sincronização**: o desenvolvimento passa a ser local (GitHub como fonte da
  verdade); o Replit só publica. Marco: tag `replit-final`.
- [ ] **Sair do Replit** (futuro): trocar o conector `@replit/connectors-sdk` por acesso direto ao
  Supabase (URL + service key), mover os Secrets e escolher a nova hospedagem (ex.: Fly.io,
  Render ou Railway para FastAPI + frontend).

## 🟡 Arquitetura e manutenção

- [ ] Quebrar `backend/main.py` (~2.200 linhas) em routers FastAPI (`auth`, `capture`, `meals`,
  `sleep`, `summaries`, `health_context`) e um módulo `gemini.py`.
- [ ] Quebrar `backend/supabase_health_records.mjs` (~2.300 linhas) por domínio.
- [ ] Reduzir o custo de um processo Node por operação: helper Node de longa duração (stdin/stdout
  ou HTTP local) ou acesso direto ao Supabase pelo Python com credencial de serviço, quando
  sair da dependência do conector.
- [ ] Permitir desenvolvimento local completo: modo alternativo com `SUPABASE_URL` +
  service key, ou Supabase local (`supabase start`).
- [ ] Remover o modo mock (`mock-store.ts`, `mockProcess`) se não for mais usado, ou mantê-lo
  explicitamente como "modo demo".
- [ ] Escolher um gerenciador de pacotes (Bun) e remover `package-lock.json`.
- [ ] Remover restos do template: `wrangler.jsonc`, `@cloudflare/vite-plugin`, componentes shadcn sem uso.
- [ ] Renomear o pacote (`tanstack_start_ts` → `consultor-saude`).
- [ ] Fixar versões em `backend/requirements.txt`.
- [ ] Adicionar `.env.example` com todas as variáveis (sem valores reais).
- [ ] Avaliar tirar o e-mail do dono do `.replit` (fica versionado) e passá-lo para um Secret.

## 🟢 Qualidade

- [ ] Script `typecheck` (`tsc --noEmit`) e incluí-lo no CI.
- [ ] Cobertura de testes de componentes React importantes (ValidationCard, Composer).
- [ ] Testes E2E (Playwright) do fluxo login → chat → confirmar → dashboard, em viewport Android.
- [ ] Observabilidade: logs estruturados sem dados sensíveis e monitoramento de erros.

## 🔵 Produto

- [ ] Metas configuráveis (água, peso, sono) no perfil.
- [ ] Lembretes (hidratação, registrar refeição) via PWA/notificações.
- [ ] PWA instalável e tolerância a falta de rede (fila de envios).
- [ ] Exportação dos dados (CSV/PDF) para levar a consultas.
- [ ] Privacidade/LGPD: termo de consentimento, exclusão de conta e dos dados.
- [ ] Acessibilidade: rótulos ARIA em botões de ícone, contraste, leitores de tela.
