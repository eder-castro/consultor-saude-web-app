# _arquivo

Arquivos tirados do projeto na faxina de 24/11/2026. **Nada aqui é usado** pelo build, pelos
testes ou pelo app. Eles ficaram guardados para consulta e podem ser apagados quando não
fizerem mais falta.

Para trazer um arquivo de volta: `git mv _arquivo/<caminho> <destino>`.

| Pasta | O que é | Por que saiu |
|---|---|---|
| `assets/attached_assets/` | Prints do Android e um prompt colado ("Persona e objetivo") anexados ao agente do Replit | Referência de conversa, nada no código usa |
| `assets/screenshots/` | Print do dashboard responsivo | Não é referenciado |
| `assets/previews/loading.html` | Protótipo da tela de carregamento | A tela real fica em `scripts/startup-page.mjs` |
| `src-sem-uso/components/ui/` | 36 componentes shadcn/ui gerados pelo template e nunca importados | Código morto (reinstalável com `npx shadcn add <nome>`) |
| `src-sem-uso/hooks/use-mobile.tsx` | Hook usado só pelo `sidebar.tsx` do shadcn | Código morto |

Os restos do Lovable (`.lovable/`, `wrangler.jsonc`, `package-lock.json`) foram apagados de vez;
continuam no histórico do git (tag `replit-final`).

Esta pasta é ignorada pelo ESLint, pelo Prettier, pelo watcher do Vite e pelo deploy do Replit.
