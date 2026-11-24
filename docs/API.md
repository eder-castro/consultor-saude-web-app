# API do backend

FastAPI em `backend/main.py`. No navegador, todas as rotas são chamadas com o prefixo `/api`:
o proxy do Vite (dev) ou `scripts/production-server.mjs` (produção) remove o prefixo e
encaminha para a porta 8000. Com o backend rodando, a documentação interativa fica em
`http://localhost:8000/docs`.

- **Autenticação**: cookie HTTP-only `health_session` (30 dias), criado em `/auth/login`.
  Quase todas as rotas exigem sessão válida.
- **Contrato no frontend**: `src/lib/api.ts` (chamadas) e `src/lib/api-schemas.ts` (Zod).
  Toda resposta é validada; se o backend divergir, o erro aparece na UI.
- **Limites**: texto até 12.000 caracteres; imagens até 8 MB (JPEG/PNG/WebP/GIF), até 6 por
  mensagem; exames podem ser imagem ou PDF.
- Tipos de evento: `alimentacao | hidratacao | exercicio | sono | peso | outro`.

## Endpoints

### Autenticação
| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/register` | Cadastro (só e-mails em `INVITED_EMAILS`) |
| POST | `/auth/login` | Login; define o cookie de sessão |
| GET | `/auth/me` | Usuário da sessão atual |
| POST | `/auth/logout` | Encerra a sessão |

### Captura e análise
| Método | Rota | Descrição |
|---|---|---|
| POST | `/process-input` | Interpreta texto/fotos e devolve itens para validação |
| POST | `/process-input/stream` | O mesmo, com progresso em streaming |
| GET | `/photo-jobs` | Análises de foto adiadas/pendentes |
| POST | `/photo-jobs/review` · `/photo-jobs/cancel` | Revisa ou cancela análise adiada |
| POST | `/save-records` | Grava os itens confirmados |
| POST | `/analyze-saved-records` (+ `/stream`) | Análise da IA sobre registros salvos |
| GET | `/daily-analysis-summary` | Resumo de análise do dia |
| GET | `/saved-analyses` | Análises anteriores |
| GET / PUT | `/chat-history` | Lê e grava o histórico do chat |

### Refeições, datas e água
| Método | Rota | Descrição |
|---|---|---|
| GET | `/meals-for-day` | Refeições de um dia |
| PATCH / DELETE | `/meals/{record_id}` | Edita ou remove uma refeição |
| PATCH | `/meal-times` | Ajusta horários |
| POST | `/meal-corrections/apply` · `/meal-corrections/status` | Correção atômica de refeições |
| GET | `/dated-records` · PATCH `/record-dates` | Corrige a data de registros |
| GET | `/water-history` · POST `/water-total/correct` | Histórico e correção do total de água |

### Sono e peso
| Método | Rota | Descrição |
|---|---|---|
| GET | `/sleep-day-status` | Situação do sono no dia (conflitos/duplicatas) |
| GET | `/sleep-reviews` · POST `/sleep-reviews/consolidate` | Revisão de sessões antigas |
| GET | `/sleep-records` · PATCH `/sleep-records/{record_id}` | Lista e edita sono |
| GET | `/weight-history` | Histórico de peso |

### Resumos
| Método | Rota | Descrição |
|---|---|---|
| GET | `/daily-summary` | Resumo do dia para o dashboard |
| GET | `/weekly-summary` · `/weekly-meals` | Visão semanal |

### Contexto clínico
| Método | Rota | Descrição |
|---|---|---|
| GET | `/health-context` | Contexto clínico do usuário |
| POST | `/health-context/exams/process` | Envia exame (imagem/PDF) para extração |
| POST | `/health-context/exams/review` | Confirma ou ajusta os dados extraídos |

### Infra
| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Verificação de vida (usada pelo readiness) |

## Ao adicionar ou alterar um endpoint

1. Modelo Pydantic + rota em `backend/main.py` (ou em um módulo de domínio).
2. Operação de dados em `backend/supabase_health_records.mjs` e, se preciso, uma migration em
   `supabase/migrations/` (com RLS).
3. Schema Zod em `src/lib/api-schemas.ts` e função em `src/lib/api.ts`.
4. Testes em `backend/test_*.py` e/ou `*.test.mjs`.
5. Atualize esta tabela.
