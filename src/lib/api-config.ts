// A API fica sempre no mesmo domínio do app, em /api (proxy do Vite em desenvolvimento e
// scripts/production-server.mjs em produção). Antes a URL podia ser trocada pelo
// localStorage (resto do modo demo); fixar evita que dados do usuário sejam enviados a
// outro servidor caso alguém consiga gravar no localStorage do navegador.
export type ApiConfig = { baseUrl: string };

const API_CONFIG: ApiConfig = Object.freeze({ baseUrl: "/api" });

export function readConfig(): ApiConfig {
  return API_CONFIG;
}

export function useApiConfig(): ApiConfig {
  return API_CONFIG;
}

export function isMockMode(_cfg: ApiConfig = readConfig()) {
  return false;
}
