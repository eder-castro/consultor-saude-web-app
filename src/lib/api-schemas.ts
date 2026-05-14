import { z } from "zod";

export const EventoTipo = z.enum([
  "alimentacao",
  "hidratacao",
  "exercicio",
  "sono",
  "peso",
  "outro",
]);
export type EventoTipo = z.infer<typeof EventoTipo>;

export const ItemSchema = z.object({
  id: z.string(),
  item: z.string(),
  quantidade_estimada: z.string(),
  confirmado: z.boolean(),
});
export type Item = z.infer<typeof ItemSchema>;

export const ValidationPayloadSchema = z.object({
  evento_tipo: EventoTipo,
  itens: z.array(ItemSchema).min(1),
  resumo: z.string().optional(),
});
export type ValidationPayload = z.infer<typeof ValidationPayloadSchema>;

export const SaveResponseSchema = z.object({ ok: z.literal(true) });

export const DailySummarySchema = z.object({
  data: z.string(),
  agua_ml: z.number(),
  agua_meta_ml: z.number(),
  refeicoes: z.array(
    z.object({
      hora: z.string(),
      itens: z.array(z.object({ item: z.string(), quantidade: z.string() })),
    }),
  ),
  exercicio: z.string().nullable(),
  sono_horas: z.number().nullable(),
  peso_kg: z.number().nullable(),
  tendencia: z.string().nullable(),
});
export type DailySummary = z.infer<typeof DailySummarySchema>;
