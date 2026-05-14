import { useEffect, useState } from "react";

const URL_KEY = "health.api.baseUrl";
const TOKEN_KEY = "health.api.token";

export type ApiConfig = { baseUrl: string; token: string };

export function readConfig(): ApiConfig {
  if (typeof window === "undefined") return { baseUrl: "", token: "" };
  return {
    baseUrl: localStorage.getItem(URL_KEY) ?? "",
    token: localStorage.getItem(TOKEN_KEY) ?? "",
  };
}

export function writeConfig(cfg: ApiConfig) {
  localStorage.setItem(URL_KEY, cfg.baseUrl);
  localStorage.setItem(TOKEN_KEY, cfg.token);
  window.dispatchEvent(new CustomEvent("health:config-changed"));
}

export function useApiConfig() {
  const [cfg, setCfg] = useState<ApiConfig>({ baseUrl: "", token: "" });
  useEffect(() => {
    setCfg(readConfig());
    const handler = () => setCfg(readConfig());
    window.addEventListener("health:config-changed", handler);
    return () => window.removeEventListener("health:config-changed", handler);
  }, []);
  return cfg;
}

export function isMockMode(cfg: ApiConfig = readConfig()) {
  return !cfg.baseUrl.trim();
}
