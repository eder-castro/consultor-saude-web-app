# Como contribuir

## Onde desenvolver

Desde a tag `replit-final`, **o desenvolvimento acontece neste repositório** (localmente, com
Claude Code). O GitHub é a fonte da verdade, e o Replit funciona só como ambiente de publicação:

```
editar aqui → commit → git push → Replit: Git "Pull" → testar → Republicar
```

- **Não edite código pelo Replit nem pelo Replit Agent.** Se precisar editar lá numa emergência,
  faça commit e push lá e dê `git pull` aqui antes de continuar.
- O app ainda depende do conector Supabase do Replit, então login e gravação de dados só
  funcionam lá. Localmente dá para trabalhar na UI, no backend Python e rodar os testes.
- Para ver o projeto exatamente como estava ao sair do Replit: `git checkout replit-final`.

## Fluxo

1. Atualize a `main` e crie uma branch: `feat/…`, `fix/…`, `docs/…`.
2. Faça commits pequenos com mensagens descritivas.
3. Antes do PR rode:
   - `npm run lint`
   - `npm run build`
   - `npm test` (exige [Bun](https://bun.sh))
4. No PR, explique **o quê** e **por quê**. Mudança de UI → print em viewport Android/mobile.
5. Mudou o banco? Inclua a migration em `supabase/migrations/AAAAMMDD_descricao.sql` com RLS.

## Mensagens de commit

[Conventional Commits](https://www.conventionalcommits.org/pt-br/) em português:

```
feat(chat): permite reenviar foto com falha
fix(dashboard): corrige soma de água em litros
test(backend): cobre fallback de modelo do Gemini
```

Evite "Changes", "Work in progress" e similares. Ao usar o agente do Replit, revise a mensagem gerada.

## Diretrizes

- **Mobile-first, Android primeiro** (ver `replit.md`).
- Frontend: TypeScript estrito; chamadas só via `src/lib/api.ts` com schema Zod.
- Backend: lógica de domínio em módulos próprios (`backend/*.py`) com testes; `main.py` deve
  conter só rotas e orquestração.
- Acesso a dados só por `backend/supabase_health_records.mjs`. Escritas concorrentes usam funções SQL atômicas.
- Nunca faça commit de segredos (`GEMINI_API_KEY`, `SESSION_SECRET`, senhas). Use os Secrets do Replit.
- Dados de saúde são sensíveis: não registre corpo de requisições nem respostas do banco nos logs.
- Não edite `src/routeTree.gen.ts` (é gerado).

## Testes

| Tipo | Onde | Como |
|---|---|---|
| Python | `backend/test_*.py` | `python -m unittest discover -s backend -p 'test_*.py'` |
| JS/TS | `*.test.mjs`, `*.test.ts` | `bun test <arquivos>` (ver script `test`) |
| Integração | `*.integration.test.mjs` | `RUN_POSTGRES_INTEGRATION_TESTS=1 bun test …` (Postgres real) |
