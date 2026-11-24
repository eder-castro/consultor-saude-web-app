import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import type { ExercicioDetails } from "@/lib/api-schemas";

type Props = {
  value?: ExercicioDetails | null;
  disabled: boolean;
  testIdPrefix: string;
  onChange: (value: ExercicioDetails) => void;
  onValidityChange?: (valid: boolean) => void;
};

const numberFields = [
  { field: "calorias_estimadas", label: "Calorias (kcal)", step: "1" },
  { field: "distancia_km", label: "Distância (km)", step: "0.01" },
  { field: "passos", label: "Passos", step: "1" },
  { field: "pontos_cardio", label: "Pontos cardio", step: "1" },
] as const;

function formatDuration(seconds?: number | null) {
  if (seconds == null) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function parseDuration(value: string) {
  const parts = value.split(":");
  if (parts.length === 2 && /^\d{1,3}$/.test(parts[0]) && /^[0-5]\d$/.test(parts[1])) {
    return Number(parts[0]) * 60 + Number(parts[1]);
  }
  if (
    parts.length === 3 &&
    /^\d{1,2}$/.test(parts[0]) &&
    /^[0-5]\d$/.test(parts[1]) &&
    /^[0-5]\d$/.test(parts[2])
  ) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }
  return null;
}

function displayNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

export function ExerciseReview({
  value,
  disabled,
  testIdPrefix,
  onChange,
  onValidityChange,
}: Props) {
  const [durationDraft, setDurationDraft] = useState(() => formatDuration(value?.duracao_segundos));
  const [durationError, setDurationError] = useState(false);

  useEffect(() => {
    setDurationDraft(formatDuration(value?.duracao_segundos));
    setDurationError(false);
  }, [value?.duracao_segundos]);

  function update<K extends keyof ExercicioDetails>(field: K, next: ExercicioDetails[K]) {
    onChange({ ...value, [field]: next });
  }

  function updateDuration(draft: string) {
    setDurationDraft(draft);
    setDurationError(false);
    if (!draft.trim()) {
      onValidityChange?.(true);
      update("duracao_segundos", null);
      return;
    }
    const seconds = parseDuration(draft);
    if (seconds === null || seconds < 1 || seconds > 86_400) {
      setDurationError(true);
      onValidityChange?.(false);
      return;
    }
    onValidityChange?.(true);
    update("duracao_segundos", seconds);
  }

  return (
    <section
      className="ml-8 space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3 sm:ml-9"
      aria-label="Detalhes do exercício"
      data-testid={`${testIdPrefix}-exercise-details`}
    >
      <p className="text-sm font-medium">Detalhes do exercício</p>
      <p className="text-xs text-muted-foreground">
        Preencha apenas dados mostrados na fonte. Informações ausentes ficam vazias.
      </p>
      <label className="grid gap-1 text-sm text-muted-foreground">
        Ritmos por trecho / detalhes da fonte
        <textarea
          aria-label="Ritmos por trecho / detalhes da fonte"
          value={value?.ritmos_parciais ?? ""}
          disabled={disabled}
          maxLength={6000}
          onChange={event => update("ritmos_parciais", event.target.value.trim() ? event.target.value : null)}
          className="min-h-20 min-w-0 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["inicio", "Horário de início"],
            ["fim", "Horário de término"],
          ] as const
        ).map(([field, label]) => (
          <label
            key={field}
            className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 text-sm"
          >
            <span className="text-muted-foreground">{label}</span>
            {disabled ? (
              <span
                data-testid={`${testIdPrefix}-${field}-value`}
                className="text-right tabular-nums"
              >
                {value?.[field] ?? "—"}
              </span>
            ) : (
              <Input
                type="time"
                value={value?.[field] ?? ""}
                onChange={(event) => update(field, event.target.value || null)}
                className="h-10 min-w-0 bg-background text-base"
                aria-label={label}
                data-testid={`${testIdPrefix}-${field}`}
              />
            )}
          </label>
        ))}

        <label className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Duração (min:seg ou h:min:seg)</span>
          {disabled ? (
            <span
              data-testid={`${testIdPrefix}-duration-value`}
              className="text-right tabular-nums"
            >
              {formatDuration(value?.duracao_segundos) || "—"}
            </span>
          ) : (
            <Input
              type="text"
              inputMode="numeric"
              value={durationDraft}
              onChange={(event) => updateDuration(event.target.value)}
              placeholder="38:16"
              aria-label="Duração (minutos e segundos)"
              aria-invalid={durationError}
              data-testid={`${testIdPrefix}-duration`}
              className="h-10 min-w-0 bg-background text-base"
            />
          )}
        </label>
        {durationError && !disabled && (
          <p role="alert" className="text-xs text-destructive sm:col-span-2">
            Informe a duração como min:seg (ex.: 38:16) ou h:min:seg.
          </p>
        )}

        <label className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Intensidade</span>
          {disabled ? (
            <span data-testid={`${testIdPrefix}-intensity-value`} className="text-right">
              {value?.intensidade || "—"}
            </span>
          ) : (
            <Input
              type="text"
              value={value?.intensidade ?? ""}
              onChange={(event) => update("intensidade", event.target.value || null)}
              placeholder="Conforme a fonte"
              aria-label="Intensidade"
              data-testid={`${testIdPrefix}-intensity`}
              className="h-10 min-w-0 bg-background text-base"
            />
          )}
        </label>

        {numberFields.map(({ field, label, step }) => (
          <label
            key={field}
            className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 text-sm"
          >
            <span className="text-muted-foreground">{label}</span>
            {disabled ? (
              <span
                data-testid={`${testIdPrefix}-${field}-value`}
                className="text-right tabular-nums"
              >
                {value?.[field] == null ? "—" : displayNumber(value[field])}
              </span>
            ) : (
              <Input
                type="number"
                min="0"
                step={step}
                value={value?.[field] ?? ""}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  update(field, raw === "" ? null : Number(raw));
                }}
                placeholder="Não informado"
                aria-label={label}
                data-testid={`${testIdPrefix}-${field}`}
                className="h-10 min-w-0 bg-background text-base"
              />
            )}
          </label>
        ))}

        <label className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 text-sm sm:col-span-2">
          <span className="text-muted-foreground">Ritmo (min/km)</span>
          {disabled ? (
            <span data-testid={`${testIdPrefix}-pace-value`} className="text-right">
              {value?.ritmo_min_km || "—"}
            </span>
          ) : (
            <Input
              type="text"
              value={value?.ritmo_min_km ?? ""}
              onChange={(event) => update("ritmo_min_km", event.target.value || null)}
              placeholder="Conforme a fonte"
              aria-label="Ritmo (min por km)"
              data-testid={`${testIdPrefix}-pace`}
              className="h-10 min-w-0 bg-background text-base"
            />
          )}
        </label>
      </div>
    </section>
  );
}
