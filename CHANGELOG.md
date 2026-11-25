# Changelog

Mudanças relevantes, agrupadas por período. Formato inspirado em
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Reconstruído a partir do histórico do git.

## [Não lançado]

### Adicionado
- Documentação: `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `CHANGELOG.md`, `docs/API.md`.

### Alterado
- O desenvolvimento passa a ser feito localmente com Claude Code; o Replit fica só para publicação.
- Faxina: 37 arquivos de código sem uso e assets movidos para `_arquivo/`; 32 dependências removidas.
- Configuração do Vite própria, sem `@lovable.dev/vite-tanstack-config` nem Cloudflare; o servidor
  de produção agora é gerado com o preset `bun` do Nitro.
- `bun.lock` independente dos espelhos internos do Replit.
- Análises da IA no estilo do GEM: blocos curtos com emoji (💡 Insight, ✅ Pontos positivos,
  ⚠️ Atenção, 👉 Próximo passo), bullets de uma frase e valores em negrito; o chat e a página
  de análises renderizam esse markdown simples (`AnalysisText`).
- Validação de sessão com cache de 60 s em memória (menos chamadas ao Supabase por requisição).

### Corrigido
- ESLint voltou a funcionar (override global de `brace-expansion` quebrava o `minimatch` 3).
- Foto de refeição em que a IA não estima a porção de algum alimento não descarta mais a
  análise inteira: o item vem como "não informado", desmarcado, com aviso no card para o
  usuário preencher a quantidade.
- Falha de conexão ao salvar o card mostra mensagem amigável em vez de "Failed to fetch".

### Segurança
- TanStack Start atualizado para 1.168.61 (corrige XSS crítico em respostas de server functions);
  `seroval` 1.6.11; 38 alertas de dependências corrigidos.
- Limite de tentativas no login e no cadastro: 5 falhas por e-mail e 20 por cliente a cada 15 min.
- Login com tempo constante quando o e-mail não existe (não revela quais contas existem).
- Scrypt mais forte (N=2^16); hashes antigos são recalculados no próximo login.
- Chave do Gemini enviada no cabeçalho `x-goog-api-key`, não mais na URL.
- Erros internos do Supabase e do helper não chegam mais ao navegador (só ao log).
- `/docs` e `/openapi.json` desligados por padrão (`ENABLE_API_DOCS=true` para ligar).
- Cabeçalhos de segurança em todas as respostas: CSP, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- URL da API fixa em `/api` (não pode mais ser trocada pelo `localStorage`).
- Versões Python fixadas em `backend/requirements.txt`.

## [replit-final] — 2026-11-24

Marco: último estado desenvolvido no Lovable e no Replit (Replit Agent). Tudo abaixo foi feito nessa fase.

## Outubro–novembro de 2026

### Adicionado
- Níveis de fases do sono preservados junto ao total consolidado.
- Confirmação de sono duplicado e correção de datas de registros.

### Alterado
- Investigação e otimizações do tempo de inicialização em produção (`docs/startup-measurements.md`).
- Sincronização das melhorias feitas no Replit com o GitHub.

## Setembro de 2026

### Adicionado
- Análise de fotos adiada (photo jobs) com retenção controlada.
- Correções atômicas de refeições, total diário de água e gravação de registros.
- Resumos diários de análise; detalhes estruturados de exercício.
- Provedor de tema (claro/escuro) e diálogo de detalhes semanais.
- Revisão de sessões antigas de sono com correção atômica e teste de concorrência em Postgres real.

### Alterado
- Layouts corrigidos para Android: áreas seguras e teclado virtual.
- Decodificação de imagens compatível com o Chrome do Android.
- Pacing e retry das chamadas ao conector Supabase.

## Agosto de 2026

### Adicionado
- Integração com Supabase via conector do Replit (helper Node chamado pelo Python).
- Autenticação no servidor (cadastro por convite, sessão por cookie) e isolamento de dados por usuário com RLS.
- Histórico do chat persistente.
- Contexto clínico e envio de exames.
- Testes de backend (Python e JS).

## Julho de 2026

### Adicionado
- Saudação dinâmica no topo do chat.

### Alterado
- Backend movido para `backend/`.

## Maio de 2026

### Adicionado
- Primeira versão a partir do template TanStack Start (Lovable): chat com validação inline,
  dashboard diário, perfil e camada de mock.
- Backend FastAPI inicial (stubs), envio de foto pela câmera/galeria e tema escuro.
