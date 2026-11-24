import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const DailyAnalysisSummarySchema = z.object({
  ok: z.literal(true),
  para_dia: date,
  periodo: z.object({ inicio: date, fim: date }),
  gerado_em: z.string(),
  origem: z.enum(["fechamento_diario", "primeiro_uso"]),
  resumo: z.object({
    dias: z.array(z.object({
      data: date,
      agua_ml: z.number().nonnegative().nullable(),
      refeicoes: z.number().int().nonnegative(),
      alimentos: z.array(z.object({
        item: z.string(),
        ocorrencias: z.number().int().positive(),
      })),
      alimentos_omitidos: z.number().int().nonnegative(),
      exercicio_min: z.number().nonnegative().nullable(),
      atividades: z.array(z.object({ tipo: z.string(), ocorrencias: z.number().int().positive() })),
      atividades_omitidas: z.number().int().nonnegative(),
      sono_min: z.number().nonnegative().nullable(),
      peso_kg: z.number().positive().nullable(),
      avisos: z.array(z.string()),
    })).length(7),
  }),
});
export type DailyAnalysisSummary = z.infer<typeof DailyAnalysisSummarySchema>;

export function saoPauloDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}