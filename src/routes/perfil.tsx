import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readConfig, writeConfig } from "@/lib/api-config";
import { testConnection } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/perfil")({
  head: () => ({
    meta: [
      { title: "Perfil & API — Consultor de Saúde" },
      { name: "description", content: "Configure conexão com a API e seu perfil clínico." },
    ],
  }),
  component: PerfilPage,
});

function PerfilPage() {
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const c = readConfig();
    setBaseUrl(c.baseUrl);
    setToken(c.token);
  }, []);

  function save() {
    writeConfig({ baseUrl: baseUrl.trim(), token: token.trim() });
    toast.success(baseUrl.trim() ? "Conexão configurada." : "Modo demo ativado (mock).");
  }

  async function test() {
    setTesting(true);
    try {
      writeConfig({ baseUrl: baseUrl.trim(), token: token.trim() });
      const ok = await testConnection();
      ok ? toast.success("API respondeu OK.") : toast.error("API não respondeu.");
    } finally {
      setTesting(false);
    }
  }

  const isMock = !baseUrl.trim();

  return (
    <AppShell title="Perfil & API">
      <div className="h-full overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Conexão com API</h2>
              <span
                className={`rounded-full border border-border px-2 py-0.5 text-xs ${
                  isMock ? "text-muted-foreground" : "text-primary"
                }`}
              >
                {isMock ? "Modo demo (mock)" : "Configurada"}
              </span>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="baseUrl">URL Base (FastAPI)</Label>
                <Input
                  id="baseUrl"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://sua-api.exemplo.com"
                  className="bg-background"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="token">Bearer Token / API Key</Label>
                <Input
                  id="token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="opcional"
                  className="bg-background"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={test} disabled={testing || isMock}>
                  {testing ? "Testando..." : "Testar conexão"}
                </Button>
                <Button className="flex-1" onClick={save}>
                  Salvar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Endpoints esperados: <code>POST /process-input</code>,{" "}
                <code>POST /save-records</code>, <code>GET /daily-summary</code>,{" "}
                <code>POST /generate-report</code>.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4">
            <h2 className="mb-1 text-sm font-semibold">Perfil clínico</h2>
            <p className="text-sm text-muted-foreground">
              Em breve: peso meta, restrições alimentares, lembretes e histórico semanal.
            </p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
