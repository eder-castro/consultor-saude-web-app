import { useEffect, useState } from "react";

const URL_KEY = "health.api.baseUrl";
export type ApiConfig = { baseUrl: string };

export function readConfig(): ApiConfig {
  if (typeof window === "undefined") return { baseUrl: "/api" };
  return {
    baseUrl: localStorage.getItem(URL_KEY) ?? "/api",
  };
}

export function writeConfig(cfg: ApiConfig) {
  localStorage.setItem(URL_KEY, cfg.baseUrl);
  window.dispatchEvent(new CustomEvent("health:config-changed"));
}

export function useApiConfig() {
  const [cfg, setCfg] = useState<ApiConfig>({ baseUrl: "/api" });
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
