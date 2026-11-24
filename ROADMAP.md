# Roadmap

Melhorias identificadas na revisão do código (nov/2026). O app já funciona em produção. Os itens
abaixo tratam de robustez, manutenção e evolução.

## 🔴 Alta prioridade

- [ ] **Cold start lento** (50–110 s, ver `docs/startup-measurements.md`). No código, o app fica
  pronto em cerca de 0,6 s; a espera acontece **antes do Python iniciar**, na infraestrutura do
  autoscale do Replit, que desliga o container quando ninguém usa. Soluções: deploy
  "Reserved VM" (sempre ligado, pago) ou um ping periódico ao `/api/health` para manter a
  instância aquecida.
- [x] **Cache de sessão** (60 s, `SESSION_CACHE_TTL_SECONDS`): cada requisição autenticada
  deixou de gastar um processo Bun e duas consultas ao Supabase só para validar o cookie.
- [ ] **Fila única de acesso a dados** (`backend/storage_requests.py`): todas as operações de
  todos os usuários passam por um lock global, com um processo `bun` novo por operação e 125 ms
  de espera entre elas. Dentro de cada processo, as consultas também são espaçadas em 125 ms
  (`supabase_rate_limit.mjs`). Uma mensagem de texto no chat faz mais de 10 consultas antes de o
  Gemini começar. Caminho recomendado: **helper Bun persistente** (um processo só, que reaproveita
  a autenticação do conector e mantém o pacing compartilhado). Mais tarde, ao sair do Replit,
  usar acesso direto ao Supabase. Precisa ser testado no Replit, porque o conector não funciona
  fora de lá.
- [x] **Lockfile independente do Replit**: o `bun.lock` não fixa mais URLs de espelhos internos
  e usa o registro configurado em cada máquina.
- [x] **Removidas 32 dependências sem uso**, incluindo Lovable e Cloudflare.
- [x] **Config Vite própria** no lugar de `@lovable.dev/vite-tanstack-config`; o servidor de
  produção agora é gerado no formato nativo do Bun (antes era um Cloudflare Worker que só
  funcionava por acaso no Bun).
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
- [ ] **Formatar o código com Prettier**: ~2.550 avisos de formatação em 79 arquivos (o agente
  do Replit nunca rodou o formatador). Fazer num commit só de formatação.
- [ ] Resolver os 5 avisos reais do ESLint (`react-hooks/exhaustive-deps`, `react-refresh`).
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
