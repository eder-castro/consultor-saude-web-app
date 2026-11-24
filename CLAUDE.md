# CLAUDE.md

Contexto para assistentes de IA trabalhando neste repositório.

## O projeto

"Consultor de Saúde" / "Meu Dia": app web mobile-first (pt-BR, **Android como prioridade**) em
que o usuário registra alimentação, hidratação, exercício, sono e peso por chat (texto ou fotos).
O Gemini interpreta a entrada, o usuário confirma num card de validação, e os dados vão para o
Supabase. Há dashboard, visão semanal, análises da IA e contexto clínico com exames.

É publicado no **Replit** (https://consultor-saude.replit.app). Até a tag `replit-final` o código
foi escrito no Lovable e pelo agente do Replit; as decisões técnicas dele estão em
`.agents/memory/*.md` e as diretrizes de UI em `replit.md`. Leia esses arquivos antes de mexer na
área correspondente.

**Fluxo atual:** desenvolvemos neste repositório e fazemos push para o GitHub; o Replit só dá pull
e publica. Há um plano de, no futuro, sair do Replit (ver ROADMAP). Antes de começar, rode
`git fetch` e confira se `origin/main` tem commits novos.

## Mapa

- `backend/main.py` (~2.200 linhas): app FastAPI, modelos Pydantic, autenticação, chamadas ao
  Gemini (via `urllib`, com cadeia de fallback de modelos) e todas as rotas.
- `backend/*.py`: lógica de domínio isolada e testável (análise de dia/período, sono por foto,
  porções, exercício, registros simples sem IA, progresso).
- `backend/supabase_health_records.mjs` (~2.300 linhas): **todo** acesso a dados. O Python o
  executa como subprocesso, passando JSON via stdin, e ele usa `@replit/connectors-sdk`.
  Tem pacing/retry (`supabase_rate_limit.mjs`) por causa do limite de requisições do conector.
- `supabase/migrations/`: esquema, RLS e funções atômicas (água, sono, correções). Nomes `AAAAMMDD_*.sql`.
- `src/routes/`: `login`, `index` (chat), `dashboard`, `analises`, `perfil`. `src/routeTree.gen.ts` é gerado.
- `src/lib/api.ts` + `api-schemas.ts`: cliente da API e contrato Zod. Base padrão `/api`.
- `src/providers/`: Auth, Chat (estado do feed), ComposerDraft, Theme.
- `scripts/production-server.mjs`: servidor de produção (estáticos + proxy + página de startup).

## Comandos

- Dev (Replit): workflows "Start application" (Vite :5000) e "Backend API" (Uvicorn :8000).
- `npm run build`, `npm run lint`, `npm run format`.
- `npm test`: `python -m unittest discover -s backend -p 'test_*.py'` + `bun test …`. **Exige Bun.**
- Só Python: `python -m unittest discover -s backend -p 'test_*.py'` (rodar da raiz; os imports são `backend.*`).

## Convenções

- UI, commits e docs em **português**. Campos do contrato em snake_case pt-BR (`evento_tipo`, `quantidade_estimada`).
- Mobile-first: sem rolagem horizontal; considerar viewport dinâmico, safe areas e teclado virtual.
- Toda chamada passa por `src/lib/api.ts` com resposta validada em Zod.
- Escritas concorrentes (água, sono, correções) usam funções SQL atômicas. Não substitua por
  read-modify-write no JS.
- Modelos do Gemini são configuráveis por variável de ambiente; não fixe nomes no código.
- Não guarde os bytes originais das fotos no histórico do chat.
- `vite.config.ts` é explícito (tailwind, tsconfig-paths, tanstackStart com entrada `src/server.ts`,
  nitro com preset `bun` só no build, react). Mantenha as exclusões do watcher.
- Commits no estilo Conventional Commits (`feat:`, `fix(chat):`, …).

## Arquivo morto

`_arquivo/` guarda o que saiu na faxina (componentes shadcn sem uso, prints).
Nada ali é usado. Não importe dessa pasta; se algo precisar voltar, use `git mv` (ver `_arquivo/README.md`).

## Segurança (decisões tomadas)

- Login/cadastro: limite em memória (`enforce_auth_rate_limit` em `main.py`), 5 falhas/e-mail e
  20/cliente em 15 min. Só respostas "senha errada" contam como falha.
- Scrypt N=2^16 nos dois lados (`hash_password` no Python e `hashPassword` no helper Node).
  Mudou os parâmetros? Mude nos dois lugares; hashes antigos são recalculados no login.
- Mensagens de erro do Supabase/helper nunca vão para o cliente; use mensagens próprias em
  `SupabaseRecordsError` quando o usuário precisa saber o motivo.
- CSP e outros cabeçalhos ficam em `scripts/production-server.mjs`. Nova origem externa
  (fonte, imagem, API)? Precisa entrar na CSP, senão o navegador bloqueia.
- A chave do Gemini vai no cabeçalho `x-goog-api-key`; nunca em URL ou log.

## Armadilhas

- Fora do Replit o conector Supabase não funciona: login e gravação falham localmente.
- Todas as operações de dados passam por um lock global (`storage_requests.py`) e cada uma cria
  um processo `bun`, o que adiciona latência. A validação de sessão tem cache de 60 s em memória
  (`_session_cache` em `main.py`); o logout invalida a entrada.
- Rodar os testes Python localmente: `.venv/bin/python -m unittest discover -s backend -p 'test_*.py'`. O cold start publicado
  já chegou a 50–110 s (`docs/startup-measurements.md`).
- `src/lib/mock-store.ts` e o modo mock ainda existem, mas a base padrão é `/api`, então o mock só
  é usado se a URL for apagada.
- Gerenciador de pacotes: **Bun** (`bun.lock`). O `post-merge.sh` do Replit roda `bun install --frozen-lockfile`,
  então sempre commite o `bun.lock` junto com o `package.json`.
- Não use o `overrides` do package.json para forçar uma versão em todo o projeto: o Bun aplica
  overrides de forma global. Foi isso que quebrou o ESLint (`brace-expansion` 5 no `minimatch` 3).
- `scripts/production-server.test.mjs` depende de DNS reverso rápido para `127.0.0.1`
  (o `HTTPServer` do Python chama `getfqdn`). Em máquinas com DNS lento, ele estoura o tempo.
- Fuso de referência: `America/Sao_Paulo`. Cuidado com datas "do dia".
