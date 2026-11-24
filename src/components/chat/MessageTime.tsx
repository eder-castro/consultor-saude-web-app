export function MessageTime({ value, outgoing = false }: { value?: string; outgoing?: boolean }) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const date = new Date(value);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
  const fullDate = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short",
  }).format(date);
  return (
    <div className={`flex px-1 ${outgoing ? "justify-end" : "justify-start"}`}>
      <time dateTime={value} title={`${fullDate} · horário de São Paulo`}
        aria-label={`Mensagem às ${time}, horário de São Paulo`}
        className="text-[11px] tabular-nums leading-5 text-muted-foreground">
        {time}
      </time>
    </div>
  );
}