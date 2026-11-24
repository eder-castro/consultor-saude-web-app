import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api";

export function QueryRefreshNotice({ query }: {
  query: { isError: boolean; data: unknown; error: unknown; isFetching: boolean; refetch: () => unknown };
}) {
  if (!query.isError || query.data === undefined) return null;
  return (
    <div role="alert" className="rounded-xl border border-border bg-card p-3 text-sm">
      <p>Mostrando os últimos dados carregados. Não foi possível atualizá-los.</p>
      <p className="mt-1 text-xs text-muted-foreground">{getApiErrorMessage(query.error)}</p>
      <Button variant="outline" size="sm" className="mt-2" disabled={query.isFetching}
        onClick={() => void query.refetch()}>
        Tentar novamente
      </Button>
    </div>
  );
}
