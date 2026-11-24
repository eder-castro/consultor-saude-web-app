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

export const ExercicioDetailsSchema = z.object({
  inicio: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  fim: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  duracao_segundos: z.number().int().min(1).max(86_400).nullable().optional(),
  intensidade: z.string().max(100).nullable().optional(),
  calorias_estimadas: z.number().finite().min(0).max(100_000).nullable().optional(),
  distancia_km: z.number().finite().positive().max(10_000).nullable().optional(),
  passos: z.number().int().min(0).max(10_000_000).nullable().optional(),
  pontos_cardio: z.number().finite().min(0).max(1_000_000).nullable().optional(),
  ritmo_min_km: z.string().max(120).nullable().optional(),
  ritmos_parciais: z.string().max(6000).nullable().optional(),
}).strict();
export type ExercicioDetails = z.infer<typeof ExercicioDetailsSchema>;

export const SleepLevelsSchema = z.object({
  profundo: z.enum(["baixo", "normal", "alto"]).nullable().optional(),
  leve: z.enum(["baixo", "normal", "alto"]).nullable().optional(),
  rem: z.enum(["baixo", "normal", "alto"]).nullable().optional(),
  acordado: z.enum(["baixo", "normal", "alto"]).nullable().optional(),
});

export const ItemSchema = z.object({
  id: z.string(),
  item: z.string(),
  quantidade_estimada: z.string(),
  confirmado: z.boolean(),
  total_diario: z.boolean().optional(),
  exercicio: ExercicioDetailsSchema.nullable().optional(),
  sono_profundo_min: z.string().nullable().optional(),
  sono_leve_min: z.string().nullable().optional(),
  sono_rem_min: z.string().nullable().optional(),
  acordado_min: z.string().nullable().optional(),
  sono_niveis: SleepLevelsSchema.nullable().optional(),
});
export type Item = z.infer<typeof ItemSchema>;

export const ValidationGroupSchema = z.object({
  evento_tipo: EventoTipo,
  data_imagem: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  horario: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
  itens: z.array(ItemSchema).min(1),
});
export type ValidationGroup = z.infer<typeof ValidationGroupSchema>;

export const ValidationPayloadSchema = z.object({
  grupos: z.array(ValidationGroupSchema).min(1),
  resumo: z.string().optional(),
  avisos_extracao: z.array(z.string()).optional(),
});
export type ValidationPayload = z.infer<typeof ValidationPayloadSchema>;

export const SavedRecordRefSchema = z.object({
  table: z.enum(["alimentacao", "hidratacao", "exercicios", "sono", "peso"]),
  import_key: z.string(),
});
export type SavedRecordRef = z.infer<typeof SavedRecordRefSchema>;

export const SaveResponseSchema = z.object({
  ok: z.literal(true),
  record_refs: z.array(SavedRecordRefSchema),
});
export const SavedAnalysisSchema = z.object({ analysis: z.string().min(1).max(1600) });

export const SavedAnalysesForDaySchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  analises: z.array(z.object({
    id: z.string(),
    created_at: z.string(),
    texto: z.string().min(1).max(1600),
  })),
});
export type SavedAnalysesForDay = z.infer<typeof SavedAnalysesForDaySchema>;

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

export const SavedSleepRecordSchema = z.object({
  id: z.string(),
  data: z.string(),
  inicio: z.string().nullable(),
  fim: z.string().nullable(),
  duracao_minutos: z.string().nullable(),
  sono_profundo_min: z.string().nullable(),
  sono_leve_min: z.string().nullable(),
  sono_rem_min: z.string().nullable(),
  acordado_min: z.string().nullable(),
});
export type SavedSleepRecord = z.infer<typeof SavedSleepRecordSchema>;

export const SavedSleepRecordsResponseSchema = z.object({
  ok: z.literal(true),
  registros: z.array(SavedSleepRecordSchema),
});
export const SavedSleepUpdateResponseSchema = z.object({
  ok: z.literal(true),
  registro: SavedSleepRecordSchema,
});

export const DailySummarySchema = z.object({
  data: z.string(),
  agua_ml: z.number(),
  agua_meta_ml: z.number(),
  refeicoes: z.array(
    z.object({
      hora: z.string(),
      itens: z.array(z.object({ id: z.string().optional(), item: z.string(), quantidade: z.string() })),
    }),
  ),
  exercicio: z.string().nullable(),
  sono_horas: z.number().nullable(),
  peso_kg: z.number().nullable(),
  tendencia: z.string().nullable(),
});

export const DailyMealsSchema = DailySummarySchema.pick({ data: true, refeicoes: true });
export type DailyMeals = z.infer<typeof DailyMealsSchema>;

export const DatedRecordsSchema = z.object({
  data: z.string(),
  registros: z.array(z.object({
    table: z.enum(["alimentacao", "hidratacao", "exercicios", "sono", "peso"]),
    id: z.string(),
    evento_tipo: z.string(),
    item: z.string(),
    quantidade: z.string().nullable(),
    horario: z.string().nullable(),
  })),
});
export type DatedRecord = z.infer<typeof DatedRecordsSchema>["registros"][number];

export const WaterHistorySchema = z.object({
  data: z.string(),
  total_declarado: z.object({
    import_key: z.string(),
    horario: z.string(),
    quantidade: z.string(),
    quantidade_ml: z.number(),
  }).nullable(),
  doses: z.array(z.object({
    horario: z.string(),
    item: z.string(),
    quantidade: z.string(),
  })),
});
export type WaterHistory = z.infer<typeof WaterHistorySchema>;

export const MealCorrectionProposalSchema = z.object({
  kind: z.literal("meal_correction"),
  source_text: z.string(),
  target_count: z.number().int().min(1).max(2),
});
export type MealCorrectionProposal = z.infer<typeof MealCorrectionProposalSchema>;

export const DayAnalysisSchema = z.object({
  kind: z.literal("day_analysis"),
  date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const [year, month, day] = value.split("-").map(Number);
      const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
    }, "Data inválida."),
  analysis: z.string().refine((value) => value.trim().length > 0, "A análise não pode estar vazia."),
});
export type DayAnalysis = z.infer<typeof DayAnalysisSchema>;

const CalendarDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    if (year < 1) return false;
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
  }, "Data inválida.");

export const PeriodAnalysisSchema = z.object({
  kind: z.literal("period_analysis"),
  start_date: CalendarDateSchema,
  end_date: CalendarDateSchema,
  analysis: z.string().min(1).max(6000)
    .refine((value) => value.trim().length > 0, "A análise não pode estar vazia."),
}).refine((value) => value.start_date <= value.end_date, {
  message: "A data inicial não pode ser posterior à data final.",
  path: ["end_date"],
});
export type PeriodAnalysis = z.infer<typeof PeriodAnalysisSchema>;
export type DailySummary = z.infer<typeof DailySummarySchema>;

export const WeeklyDaySchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  agua_ml: z.number(),
  refeicoes: z.number(),
  exercicio_min: z.number(),
  sono_horas: z.number().nullable(),
  sono_profundo_horas: z.number().nullable(),
  sono_leve_horas: z.number().nullable(),
  sono_rem_horas: z.number().nullable(),
  acordado_horas: z.number().nullable(),
  sono_niveis: z.object({
    profundo: z.enum(["baixo", "normal", "alto", "misto"]).nullable().optional(),
    leve: z.enum(["baixo", "normal", "alto", "misto"]).nullable().optional(),
    rem: z.enum(["baixo", "normal", "alto", "misto"]).nullable().optional(),
    acordado: z.enum(["baixo", "normal", "alto", "misto"]).nullable().optional(),
  }).nullable().optional(),
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

export const WeeklyMealsSchema = z.object({
  ok: z.literal(true),
  periodo: z.object({ inicio: z.string(), fim: z.string() }),
  dias: z.array(z.object({
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    refeicoes: z.number().int().nonnegative(),
  })).length(7),
  tendencia: z.string(),
});
export type WeeklyMeals = z.infer<typeof WeeklyMealsSchema>;

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
