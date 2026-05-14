## Visão geral
App SPA mobile-first, dark mode (preto profundo + acento esmeralda), com chat de captura, fluxo de validação por checkboxes, dashboard diário e relatório. Integração com API Python via camada mock plugável (troca por URL real depois sem refatorar UI).

## Estrutura de rotas (TanStack Start)
```
/            → Chat + captura (tela principal)
/dashboard   → Métricas do dia (água, refeições, exercício, sono, peso)
/perfil      → Perfil clínico + config da API (URL base + token)
```
Footer fixo com 3 ícones navegando entre elas.

## Fluxo Chat → Validação (o ponto-chave)

A "transformação" não é troca de tela — é um **componente inline no feed do chat**. O chat é uma lista de mensagens com tipos discriminados:

```ts
type ChatMessage =
  | { id; role: 'user'; kind: 'text'; text }
  | { id; role: 'user'; kind: 'image'; imageUrl; caption? }
  | { id; role: 'assistant'; kind: 'loading' }
  | { id; role: 'assistant'; kind: 'validation'; payload: ValidationPayload; status: 'pending'|'saved'|'discarded' }
  | { id; role: 'assistant'; kind: 'text'; text }
```

Sequência:
1. Usuário envia texto OU foto+legenda → push de mensagem `user` no feed.
2. Push imediato de bolha `assistant/loading` (skeleton com 3 linhas pulsando).
3. `processInput()` (mock) resolve em ~1.2s → substitui a bolha de loading por uma `validation` contendo o JSON do contrato.
4. A bolha `validation` renderiza um **Card inline** dentro do próprio feed com:
   - Título do tipo de evento (ex: "Refeição detectada")
   - Lista de linhas: `[checkbox marcado] [Input nome] [Input quantidade] [botão lixeira]`
   - Botão "+ Adicionar item" (linha vazia editável)
   - Estado local do card (`useState<Item[]>`) — edições não afetam outros cards
   - Dois botões: **Confirmar registro** e **Descartar**
5. "Confirmar" → filtra `confirmado===true`, chama `saveRecords()`, marca a bolha como `saved` (vira read-only com check verde + resumo dos itens salvos). "Descartar" → marca `discarded`.
6. Cards anteriores ficam no histórico do feed em modo somente leitura — não podem ser re-editados (evita confusão sobre o que foi salvo).

Estado: cada bolha de validação carrega seu próprio estado local. Não precisa de Context global — o feed é a fonte da verdade. Só uso Context para config da API (URL + token).

## Camada de API (mock plugável)

Arquivo único `src/lib/api.ts` exporta:
```ts
processInput({ text?, imageBase64? }): Promise<ValidationPayload>
saveRecords({ evento_tipo, itens }): Promise<{ ok: true }>
getDailySummary(): Promise<DailySummary>
generateDailyReport(): Promise<{ ok: true }>
```

Internamente lê `localStorage` por enquanto:
- `health.api.baseUrl` (vazio por padrão → modo mock)
- `health.api.token`

Lógica:
- Se `baseUrl` vazio → retorna mock. `processInput` inspeciona o texto (regex simples para "água/ml", "dormi X horas", "pesei X kg") e devolve payload coerente; para imagem retorna refeição fake plausível (arroz, feijão, frango).
- Se `baseUrl` setado → `fetch(baseUrl + path, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } })`.
- Imagem é convertida para base64 no client antes de enviar.
- Toda resposta passa por validação Zod com o schema do contrato — se a API real divergir, erro claro no chat ao invés de UI quebrada.

Tela `/perfil` tem um bloco "Conexão com API" com 2 inputs (URL base, token) + botão "Testar conexão" (faz GET no `/health` ou similar). Quando vazios, mostra badge "Modo demo (mock ativo)".

## Dashboard (`/dashboard`)
Como você escolheu "só API Python", o dashboard chama `getDailySummary()` a cada foco da rota. Em modo mock, agrega o que foi confirmado na sessão atual (mantenho um buffer in-memory em `api.ts` para o mock). Componentes:
- Card de água com barra de progresso (meta 2500ml)
- Lista de refeições confirmadas hoje (agrupadas por horário)
- Cards minimalistas: Exercício, Sono, Peso
- Botão "Gerar relatório do dia" → chama `generateDailyReport()`, toast de confirmação

## Design system
Atualizar `src/styles.css`:
- `--background`: oklch(0.14 0 0) (preto carvão)
- `--card`: oklch(0.18 0 0)
- `--primary`: oklch(0.72 0.17 155) (esmeralda)
- `--muted-foreground`: oklch(0.6 0 0)
- Bordas `oklch(1 0 0 / 8%)`, raio 0.75rem
- Aplicar `.dark` no `<html>` por padrão (force dark)
- Tipografia: Inter via `<link>` no `__root.tsx` head

Componentes shadcn usados: Button, Input, Checkbox, Card, Progress, Skeleton, Toast (sonner).

## Arquivos a criar
- `src/routes/index.tsx` — chat
- `src/routes/dashboard.tsx`
- `src/routes/perfil.tsx`
- `src/components/chat/ChatFeed.tsx`
- `src/components/chat/MessageBubble.tsx`
- `src/components/chat/ValidationCard.tsx` ← componente-chave
- `src/components/chat/Composer.tsx` (input + botão câmera)
- `src/components/layout/AppShell.tsx` (header + footer nav)
- `src/lib/api.ts` (mock + real)
- `src/lib/api-schemas.ts` (Zod)
- `src/lib/api-config.ts` (hook de config localStorage)
- `src/lib/mock-store.ts` (buffer do dia para o mock)

## Não inclui (escopo posterior)
- Lovable Cloud / auth / Supabase
- Persistência local real (tudo via API quando ela existir)
- Notificações push, offline mode, PWA install

Quando a API FastAPI estiver pronta, basta abrir `/perfil`, colar URL+token, e o app passa a usar real sem nenhuma alteração de código.