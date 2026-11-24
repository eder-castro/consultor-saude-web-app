# Inicialização após inatividade — 2026-10-06

## Resultado e limite da conclusão

A demora longa publicada acontece principalmente **antes** de Uvicorn anunciar
o processo do servidor, não dentro da rotina de startup do FastAPI.
Os registros antigos não distinguem o carregamento do executável Python dos
imports. Portanto, **a causa desse intervalo ainda não está comprovada**.

Foi reduzida a espera extra da verificação de prontidão e antecipada a primeira
renderização do frontend em paralelo ao carregamento do Python. Novos marcos
permitem separar as etapas na próxima publicação. Não houve mudança de plano,
recursos, dependências instaladas, configuração de publicação ou defaults de
Uvicorn. Nenhuma republicação foi efetuada.

## Antes: instâncias publicadas

Fonte: registros de execução da publicação obtidos em 2026-10-06. Tempos abaixo
são diferenças entre timestamps de logs, não medições de CPU.

| Etapa | Instância 11:29 UTC | Instância 14:44 UTC |
|---|---:|---:|
| Proxy público iniciou | 11:29:02.262 | 14:44:08.637 |
| Proxy → frontend anunciou listener | 0,052 s | 0,052 s |
| Proxy → Uvicorn anunciou processo | 50,766 s | 106,349 s |
| Espera de startup → startup completo | 0,701 s | 0,704 s |
| Processo Uvicorn → listener API | 2,399 s | 3,199 s |
| Listener API → gate liberado | 0,700 s | 1,301 s |
| Proxy → gate liberado | **53,865 s** | **110,849 s** |

O anúncio do frontend indica listener aberto, não prova que a primeira página
SSR já foi carregada. O intervalo até o processo Uvicorn inclui lançamento de
Python, imports e preparação de protocolos; não é possível subdividi-lo
retroativamente com os logs antigos.

## Dependências examinadas e experimentos anteriores à otimização

- O entrypoint importa FastAPI, Pydantic, módulos locais e biblioteca padrão.
  Não carrega SDK de Gemini nem consulta Supabase durante os imports.
- O startup cria uma tarefa de fila de fotos; não espera a consulta remota.
  A fila continua funcionando e não foi removida para obter prontidão.
- Medições locais de `python -c 'pass'`: 313, 30 e 27 ms. A primeira execução
  teve caches menos aquecidos; não equivale à primeira execução numa instância
  de produção.
- `python -X importtime -c 'import backend.main'`: 2,191 s no primeiro perfil.
  O acumulado de FastAPI foi aproximadamente 1,384 s. O profiler adiciona custo;
  isso identifica imports relevantes, mas não estima os 106 s de produção.
- Seis amostras de `uvicorn.Config("backend.main:app").load()` com defaults e
  com `asyncio/h11/sem WebSocket` não mostraram ganho consistente: aproximadamente
  484–510 ms. Configuração alternativa descartada.
- Testado um arquivo ZIP de bytecode de 11 pacotes Python puros (~4,84 MB), mantendo
  extensões nativas fora do ZIP. Seis pares de medições:
  sem ZIP 524,0 / 506,3 / 505,8 / 455,0 / 520,8 / 506,4 ms;
  com ZIP 550,4 / 497,6 / 520,0 / 483,4 / 524,3 / 507,8 ms.
  Sem ganho consistente; empacotamento descartado e não incluído na publicação.

## Antes/depois: processo de produção no workspace

Mesma máquina, frontend de produção existente e lançamento por Bun, com portas
internas isoladas. Três processos novos por conjunto; caches do SO não foram
limpos. Esses dados **não são um benchmark de cold start da infraestrutura**.
O conjunto posterior foi executado após a compilação de produção, sem alterações
no código do frontend.

| Tempo desde lançar o processo supervisor | Antes, execuções 1 / 2 / 3 | Depois, execuções 1 / 2 / 3 |
|---|---:|---:|
| Proxy anunciou listener (ms) | 396,3 / 52,5 / 48,4 | 72,5 / 56,3 / 61,2 |
| Uvicorn anunciou processo (ms) | 1826,8 / 509,9 / 515,4 | —* |
| API anunciou listener (ms) | 1834,0 / 518,2 / 522,5 | 627,5 / 541,3 / 618,1 |
| Aplicação liberada (ms) | **2387,7 / 1048,8 / 1047,0** | **675,0 / 638,8 / 666,3** |
| Resposta `/login` após prontidão (ms) | não coletada | 47,3 / 13,7 / 25,4 |

*Depois, o marco próprio `api_initialization_started` foi observado em
619,7 / 533,4 / 606,6 ms. Ele é posterior à configuração de protocolos e não
deve ser tratado como um timestamp idêntico ao anúncio de processo de Uvicorn.

Mediana local até liberar o aplicativo: **1048,8 → 666,3 ms**, redução de
aproximadamente **36,5%**. O custo de importar Python não caiu comprovadamente.
O ganho é a retirada de parte da espera do gate; o custo da primeira resposta
SSR é antecipado e agora também verificado antes da liberação.

### Etapas posteriores detalhadas

Valores emitidos pelos próprios processos; tempos relativos ao início do
launcher, salvo `stage_ms`, que usa relógio monotônico Python.

| Etapa | Execução 1 | Execução 2 | Execução 3 |
|---|---:|---:|---:|
| Entrada Python desde início do launcher (ms) | 52,9 | 32,8 | 39,2 |
| Importação Uvicorn, duração (ms) | 151,8 | 111,5 | 105,4 |
| Importação aplicação, duração (ms) | 341,2 | 329,5 | 386,9 |
| Preparação de protocolos/event loop, duração (ms) | 21,2 | 20,6 | 28,5 |
| Startup da API até listener, duração (ms) | 8,1 | 7,8 | 11,6 |
| Frontend HTTP pronto desde início launcher (ms) | 313,2 | 292,5 | 297,8 |
| API HTTP pronta desde início launcher (ms) | 621,8 | 598,8 | 619,4 |
| Ambos prontos desde início launcher (ms) | 622,0 | 598,8 | 619,4 |

## Mudanças mantidas

- Python em modo sem buffering, com marcos de entrada, imports, preparação
  e inicialização da API. Nenhuma credencial ou conteúdo de registro é logado.
- Probes HTTP paralelos, sem sobreposição entre rodadas, com intervalo de 100 ms
  em vez de 1000 ms e deadline absoluto de 2 s por probe.
- API exige `/health` bem-sucedido com `{"status":"ok"}`; frontend exige resposta
  HTTP bem-sucedida de `/login`, antecipando a importação SSR enquanto Python
  carrega. Um socket aberto ou uma resposta 500 não bastam.
- Gate continua exigindo os dois serviços. API e métodos de escrita recebem
  503 com `Retry-After` durante startup; páginas recebem a animação inline sem
  JavaScript, com refresh automático de 5 s e suporte a movimento reduzido.
- Erro ao criar um processo encerra os serviços explicitamente; shutdown e
  configuração automática de Uvicorn continuam preservados.

## Verificações

- `bun run build`: passou (avisos de tamanho de bundle já presentes).
- `python -m unittest discover -s backend -p 'test_*.py'`: 125 testes passaram.
- `node --test scripts/*.test.mjs` e `bun test scripts/*.test.mjs`: 7 testes
  passaram em ambos, incluindo frontend pronto/API atrasada e cenário inverso,
  503 de escrita, ausência de formulário funcional durante startup, transição
  automática de prontidão, encaminhamento e encerramento dos processos.
- Probes testados com erro HTTP, JSON inválido, status de API diferente de `ok`,
  conexão recusada e listener TCP que nunca envia resposta.
- Três execuções reais do supervisor posterior retornaram 200 em `/login` e
  `/api/health`, depois encerraram normalmente.

## Reproduzir e confirmar em produção

```sh
bun run build
node scripts/measure-startup.mjs 3
# Opcional: comparar o runtime do supervisor sem alterar publicação
STARTUP_BENCHMARK_RUNTIME=node node scripts/measure-startup.mjs 3
```

O script usa portas temporárias, não publica, não altera recursos e imprime
somente tempos agregados e marcos de startup. Usa o backend real, incluindo
sua fila normal de fotos; não há operação de login ou gravação de saúde pelo
benchmark, mas a fila pode retomar trabalhos que já estavam pendentes.

Após republicação aprovada, comparar os registros `[startup]` de novas instâncias.
Se `interpreter_entered` demorar, o tempo está antes da entrada Python; se os
marcos de imports demorarem, o problema está no carregamento de módulos; se
`api_initialization_started → api_listening` demorar, investigar lifespan e
criação do listener. Confirmar o HTTP de ambos antes de atribuir o tempo restante
à verificação de prontidão.

**Não há ainda medição posterior de instâncias publicadas.** Os resultados locais
não autorizam afirmar que a espera de 110,849 s foi resolvida.
