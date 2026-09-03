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
  sono_profundo_min: z.string().nullable().optional(),
  sono_leve_min: z.string().nullable().optional(),
  sono_rem_min: z.string().nullable().optional(),
  acordado_min: z.string().nullable().optional(),
});
export type Item = z.infer<typeof ItemSchema>;

export const ValidationGroupSchema = z.object({
  evento_tipo: EventoTipo,
  itens: z.array(ItemSchema).min(1),
});
export type ValidationGroup = z.infer<typeof ValidationGroupSchema>;

export const ValidationPayloadSchema = z.object({
  grupos: z.array(ValidationGroupSchema).min(1),
  resumo: z.string().optional(),
});
export type ValidationPayload = z.infer<typeof ValidationPayloadSchema>;

export const SaveResponseSchema = z.object({ ok: z.literal(true) });

export const SleepReviewRecordSchema = z.object({
  id: z.string(),
  etapa: z.string(),
  etapa_label: z.string(),
  valor_existente: z.string().nullable(),
  minutos_existentes: z.number(),
  duracao_minutos: z.string().nullable(),
});
export type SleepReviewRecord = z.infer<typeof SleepReviewRecordSchema>;

export const SleepReviewGroupSchema = z.object({
  id: z.string(),
  data: z.string(),
  inicio: z.string().nullable(),
  fim: z.string().nullable(),
  registros: z.array(SleepReviewRecordSchema).min(2),
});
export type SleepReviewGroup = z.infer<typeof SleepReviewGroupSchema>;

export const SleepReviewsResponseSchema = z.object({
  ok: z.literal(true),
  revisoes: z.array(SleepReviewGroupSchema),
});

export const SleepCorrectionResponseSchema = z.object({
  ok: z.literal(true),
  corrected: z.boolean(),
  replaced: z.number(),
  record_id: z.string(),
});

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

export const WeeklyDaySchema = z.object({
  data: z.string(),
  agua_ml: z.number(),
  refeicoes: z.number(),
  exercicio_min: z.number(),
  sono_horas: z.number().nullable(),
  sono_profundo_horas: z.number().nullable(),
  sono_leve_horas: z.number().nullable(),
  sono_rem_horas: z.number().nullable(),
  acordado_horas: z.number().nullable(),
  peso_kg: z.number().nullable(),
});

export const WeeklySummarySchema = z.object({
  ok: z.literal(true),
  periodo: z.object({ inicio: z.string(), fim: z.string() }),
  dias: z.array(WeeklyDaySchema).length(7),
  tendencias: z.object({
    agua: z.string(),
    refeicoes: z.string(),
    exercicio: z.string(),
    sono: z.string(),
    peso: z.string(),
  }),
});
export type WeeklySummary = z.infer<typeof WeeklySummarySchema>;

export const ExamMarkerSchema = z.object({
  nome: z.string(),
  valor: z.string().nullable(),
  unidade: z.string().nullable(),
  referencia: z.string().nullable(),
  observacao: z.string().nullable(),
});
export type ExamMarker = z.infer<typeof ExamMarkerSchema>;

export const ExamExtractedDataSchema = z.object({
  tipo_exame: z.string().nullable(),
  data_exame: z.string().nullable(),
  resumo: z.string(),
  marcadores: z.array(ExamMarkerSchema),
  achados: z.array(z.string()),
  incertezas: z.array(z.string()),
  precisa_revisao: z.boolean(),
});
export type ExamExtractedData = z.infer<typeof ExamExtractedDataSchema>;

export const ExamStatusSchema = z.enum(["pending", "confirmed", "discarded"]);
export type ExamStatus = z.infer<typeof ExamStatusSchema>;

export const ExamSchema = z.object({
  id: z.string(),
  file_name: z.string(),
  mime_type: z.string(),
  exam_type: z.string().nullable(),
  exam_date: z.string().nullable(),
  summary: z.string(),
  extracted_data: ExamExtractedDataSchema,
  uncertainties: z.array(z.string()),
  status: ExamStatusSchema,
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
});
export type Exam = z.infer<typeof ExamSchema>;

export const HealthContextSchema = z.object({
  ok: z.literal(true),
  profile: z
    .object({
      owner_id: z.string(),
      clinical_profile: z.string(),
      gem_instructions: z.string(),
      updated_at: z.string(),
    })
    .nullable(),
  confirmed_exams: z.array(
    z.object({
      id: z.string(),
      exam_type: z.string(),
      exam_date: z.string().nullable(),
      summary: z.string(),
      extracted_data: ExamExtractedDataSchema,
      uncertainties: z.array(z.string()),
      status: z.literal("confirmed"),
      reviewed_at: z.string().nullable(),
    }),
  ),
  recent: z.object({
    weight: z.array(z.unknown()),
    sleep: z.array(z.unknown()),
    exercise: z.array(z.unknown()),
  }),
  local_now: z.object({ data: z.string(), horario: z.string() }),
  exams: z.array(ExamSchema),
});
export type HealthContext = z.infer<typeof HealthContextSchema>;

export const ProcessHealthExamResponseSchema = z.object({ ok: z.literal(true), exam: ExamSchema });
export const ReviewHealthExamResponseSchema = z.object({ ok: z.literal(true), exam: ExamSchema });
