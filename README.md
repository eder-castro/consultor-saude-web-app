# Consultor de Saúde ("Meu Dia")

App web **mobile-first** (Android como prioridade) para registrar e acompanhar hábitos de saúde
conversando com um chat. Você escreve ou fotografa o que comeu, bebeu, treinou, dormiu ou pesou;
o **Google Gemini** interpreta a mensagem, o app mostra um **card de validação** editável e, depois
que você confirma, os registros vão para o **Supabase** e alimentam dashboard, histórico e análises.

Produção: https://consultor-saude.replit.app (acesso só para contas convidadas).

## Funcionalidades

- **Login privado** (`/login`) — cadastro apenas para e-mails convidados; sessão por cookie HTTP-only.
- **Chat de captura** (`/`)
  - Texto livre ou até 6 fotos (câmera/galeria), com preparo da imagem no navegador.
  - Respostas em streaming com progresso da análise.
  - Card de validação: marcar/desmarcar, editar, adicionar ou remover itens; confirmar ou descartar.
  - Fluxos especiais: porções de refeição por foto, prints de app de sono (fases do sono),
    exercícios com ritmo/distância, meta de hidratação, revisão de sono duplicado.
  - Análise do dia ou de um período sob pedido ("como foi minha semana?").
  - Histórico do chat persistido entre visitas (sem guardar os bytes originais das fotos).
- **Dashboard** (`/dashboard`) — água, refeições, exercício, sono e peso do dia; visão semanal;
  gráfico de peso; correção de refeições, horários, datas e total de água.
- **Análises** (`/analises`) — análises salvas anteriormente.
- **Perfil** (`/perfil`) — conta, contexto clínico e envio de exames (imagem/PDF) com extração
  e revisão assistidas por IA.
- Tema claro/escuro.

## Arquitetura

```
Navegador (React / TanStack Start)
        │  fetch("/api/...")  (cookie de sessão)
        ▼
Vite dev server :5000  ── proxy /api ──►  FastAPI :8000 (backend/main.py)
  (produção: scripts/production-server.mjs                │
   serve .output/public e faz o proxy)                    ├─► Google Gemini (HTTP, com fallback de modelos)
                                                           └─► subprocesso Node: backend/supabase_health_records.mjs
                                                                  └─► Supabase via @replit/connectors-sdk
```

- O Python não fala com o Supabase direto: cada operação chama um helper Node que usa o
  **conector Supabase do Replit** (o SDK Python do conector não estava disponível).
- O esquema do banco está em `supabase/migrations/`, com tabelas de saúde (`alimentacao`,
  `hidratacao`, `exercicios`, `sono`, `peso`, …) e tabelas do app (`health_users`,
  `health_sessions`, `health_chat_messages`, `health_exams`, `health_photo_jobs`, …), protegidas por RLS.
- Fuso horário de referência: `America/Sao_Paulo`.

## Stack

| Camada    | Tecnologias |
|-----------|-------------|
| Frontend  | React 19, TypeScript, TanStack Start/Router/Query, Vite 7, Tailwind CSS 4, shadcn/ui, Zod, Recharts |
| Backend   | Python 3.11, FastAPI, Pydantic, Uvicorn (Gemini chamado via `urllib`, sem SDK) |
| Dados     | Supabase (Postgres + RLS), acessado pelo `@replit/connectors-sdk` em Node |
| Testes    | `unittest` (Python), `bun test` (JS/TS), integração com Postgres real |
| Infra     | Replit (deploy autoscale), Bun |
| Origem    | Template TanStack Start do Lovable, evoluído no Replit (tag `replit-final`) e agora desenvolvido localmente |

## Rodando

### No Replit (caminho suportado)

O botão **Run** sobe dois workflows em paralelo:

- frontend: `node node_modules/vite/bin/vite.js dev` (porta 5000);
- backend: `python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload`.

Deploy: `bun run build` e depois `bun run start` (`scripts/production-server.mjs`).
Após um merge, `scripts/post-merge.sh` reinstala as dependências e refaz o build.

### Localmente (parcial)

```bash
npm install
```

```bash
npm run dev
```

```bash
pip install -r backend/requirements.txt && python -m uvicorn backend.main:app --port 8000 --reload
```

> ⚠️ Fora do Replit, o conector Supabase não autentica, então login e gravação de registros
> falham. Localmente dá para trabalhar na UI e rodar os testes unitários. Veja o [ROADMAP](ROADMAP.md).

### Variáveis de ambiente / Secrets

| Variável | Uso |
|---|---|
| `GEMINI_API_KEY` | Chave da API do Gemini (obrigatória para a IA) |
| `GEMINI_MODEL`, `GEMINI_POWER_MODEL`, `GEMINI_FALLBACK_MODEL(S)`, `GEMINI_ANALYSIS_MODEL` | Modelos usados e cadeia de fallback |
| `GEMINI_TIMEOUT_SECONDS` | Timeout das chamadas ao Gemini (padrão 90) |
| `SESSION_SECRET` | Segredo usado pelo helper Node (criptografia/assinatura de sessão) |
| `INVITED_EMAILS` | Lista de e-mails autorizados a se cadastrar (separados por vírgula) |
| `PRIMARY_OWNER_EMAIL`, `PRIMARY_OWNER_INITIAL_PASSWORD` | Conta dona principal (bootstrap) |
| `SESSION_CACHE_TTL_SECONDS` | Tempo do cache de sessão em memória (padrão 60) |
| `ENABLE_API_DOCS` | `true` liga `/docs` e `/openapi.json` (só para desenvolvimento) |
| `CORS_ORIGINS` | Origens permitidas (padrão: localhost:5000 + domínio de dev do Replit) |
| `COOKIE_SECURE` | Força o cookie `Secure` |
| `PORT`, `FRONTEND_INTERNAL_PORT`, `BACKEND_INTERNAL_PORT` | Portas do servidor de produção |

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Frontend em modo dev (porta 5000, proxy `/api` → 8000) |
| `npm run build` | Build de produção (`.output/`) |
| `npm run start` | Servidor de produção (exige Bun) |
| `npm test` | Testes Python + `bun test` (exige Bun) |
| `npm run test:integration:sleep` | Teste de concorrência com Postgres real |
| `npm run lint` / `npm run format` | ESLint / Prettier |

## Estrutura

```
backend/            FastAPI (main.py), módulos de domínio (*.py), helper Supabase (*.mjs) e testes
src/routes/         login, index (chat), dashboard, analises, perfil, __root
src/components/     chat/, dashboard/, auth/, layout/, ui/ (shadcn)
src/providers/      Auth, Chat, ComposerDraft, Theme
src/lib/            cliente da API (api.ts), schemas Zod, helpers de sono/imagem/sessão
supabase/migrations SQL do esquema, RLS e funções atômicas
scripts/            servidor de produção, readiness, medição de startup, utilitários
docs/               API.md, medições de inicialização
.agents/memory/     decisões técnicas registradas pelo agente do Replit
replit.md           diretrizes do projeto (mobile-first, Android)
```

## Documentação

- [docs/API.md](docs/API.md) — endpoints do backend
- [docs/startup-measurements.md](docs/startup-measurements.md) — investigação do cold start
- [CONTRIBUTING.md](CONTRIBUTING.md) · [ROADMAP.md](ROADMAP.md) · [CHANGELOG.md](CHANGELOG.md) · [CLAUDE.md](CLAUDE.md)

## Aviso

Este app **não substitui orientação médica ou nutricional**. As estimativas da IA são aproximadas
e devem ser revisadas pelo usuário. O app trata dados de saúde, que são sensíveis (LGPD).
