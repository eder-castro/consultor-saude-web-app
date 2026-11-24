import copy
import json
import unittest
from datetime import date, datetime
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from backend import main
from backend.day_analysis import TABLES
from backend.period_analysis import analyze_period, parse_period_request


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 10, 2, 12, tzinfo=tz)


def period_context(start="2026-09-18", end="2026-10-02"):
    rows = {table: [] for table in TABLES}
    rows["peso"] = [{"data": start, "valor_kg": 70.8}, {"data": end, "valor_kg": 70.6}]
    return {"periodo": {"inicio": start, "fim": end}, "registros": rows, "agua_registrada_por_dia": []}


def response(analysis):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps({"analysis": analysis})}]}}]}


class PeriodAnalysisTests(unittest.IsolatedAsyncioTestCase):
    def test_supported_natural_requests_resolve_inclusive_dates(self):
        today = date(2026, 10, 2)
        cases = [
            ("Análise minha semana", ("2026-09-28", "2026-10-02")),
            ("Analise a minha semana.", ("2026-09-28", "2026-10-02")),
            ("Pode fazer uma análise da semana atual?", ("2026-09-28", "2026-10-02")),
            ("Por favor, analise os últimos 15 dias.", ("2026-09-18", "2026-10-02")),
            ("Analise os últimos 1 dias", ("2026-10-02", "2026-10-02")),
            ("Analise o último mês", ("2026-09-03", "2026-10-02")),
            ("Quero uma análise dos últimos 30 dias", ("2026-09-03", "2026-10-02")),
            ("Analise a última semana", ("2026-09-26", "2026-10-02")),
            ("Análise desde o dia 01/09/2026 até o dia 15/09/2026", ("2026-09-01", "2026-09-15")),
            ("Analise de 01/09 até 30/09", ("2026-09-01", "2026-09-30")),
            ("Analise o período de 01/09/2026 a 30/09/2026", ("2026-09-01", "2026-09-30")),
            ("Analise entre 2025-12-29 e 2026-01-02", ("2025-12-29", "2026-01-02")),
            ("Analise desde o dia 1 até o dia 2", ("2026-10-01", "2026-10-02")),
            ("Resumo dos meus registros de 01/09 até 15/09", ("2026-09-01", "2026-09-15")),
        ]
        for text, expected in cases:
            with self.subTest(text=text):
                self.assertEqual(parse_period_request(text, today), expected)

    def test_rolling_month_is_30_days_across_years_and_leap_days(self):
        self.assertEqual(parse_period_request("analise o último mês", date(2026, 1, 5)),
                         ("2025-12-07", "2026-01-05"))
        self.assertEqual(parse_period_request("analise os últimos 15 dias", date(2024, 3, 1)),
                         ("2024-02-16", "2024-03-01"))

    def test_invalid_or_mixed_requests_do_not_fall_back_to_record_extraction(self):
        for text in [
            "Analise de 31/02/2026 até 10/03/2026", "Analise de 10/09 até 01/09",
            "Analise desde 01/10 até 31/10", "Analise os últimos 0 dias",
            "Analise os últimos 367 dias", "Analise desde o dia xx até o dia xx",
            "Analise minha semana e registre 300 ml de água",
            "Analise os últimos " + "9" * 5000 + " dias",
            "Analise os últimos 2 meses",
        ]:
            with self.subTest(text=text), self.assertRaises(HTTPException) as caught:
                parse_period_request(text, date(2026, 10, 2))
            self.assertEqual(caught.exception.status_code, 422)
        for text in [
            None, "", "Bebi 300 ml hoje", "Registre meu peso de ontem", "Analise meu dia",
            "Faça uma análise do meu dia até agora", "Como foi meu dia até agora?",
            "Analise meu dia até agora, por favor.", "Resumo do dia até o momento",
        ]:
            self.assertIsNone(parse_period_request(text, date(2026, 10, 2)))

    async def test_route_fetches_only_authenticated_owner_exact_period_without_extraction_or_save(self):
        helper = AsyncMock(return_value=period_context())
        extractor = AsyncMock()
        with patch.object(main, "datetime", FixedDateTime), \
                patch.object(main, "run_supabase_helper", helper), \
                patch.object(main, "analyze_with_gemini", extractor), \
                patch.object(main, "GEMINI_API_KEY", "test-only"), \
                patch.object(main, "call_gemini_sync", return_value=response("Comparação dos registros confirmados.")):
            result = await main.process_input(main.ProcessInputRequest(text="Analise os últimos 15 dias"),
                                              {"id": "authenticated-owner"})
        self.assertEqual(result["kind"], "period_analysis")
        self.assertEqual((result["start_date"], result["end_date"]), ("2026-09-18", "2026-10-02"))
        helper.assert_awaited_once_with(
            "period-analysis-context",
            payload={"owner_id": "authenticated-owner", "start_date": "2026-09-18", "end_date": "2026-10-02"},
            timeout_seconds=120,
        )
        extractor.assert_not_awaited()
        self.assertNotIn("grupos", result)

    async def test_empty_period_returns_clear_text_without_ai(self):
        context = period_context()
        context["registros"]["peso"] = []
        model = AsyncMock()
        result = await analyze_period(context, "2026-09-18", "2026-10-02",
                                      model_call=model, extract_text=main.extract_gemini_text, progress=lambda stage: None)
        self.assertIn("Não há registros", result["analysis"])
        self.assertIn("18/09/2026 a 02/10/2026", result["analysis"])
        model.assert_not_awaited()

    async def test_missing_tables_wrong_ranges_dates_and_missing_water_context_fail_closed(self):
        context = period_context()
        for mutation in [
            lambda c: c["registros"].pop("sono"),
            lambda c: c["periodo"].update(inicio="2026-09-17"),
            lambda c: c["registros"]["peso"][0].update(data="2026-09-17"),
            lambda c: c["registros"]["peso"][0].update(data="2026-09-31"),
            lambda c: c["registros"].update(peso="invalid"),
            lambda c: c["registros"]["hidratacao"].append({"data": "2026-10-02", "quantidade": "300 ml"}),
        ]:
            invalid = copy.deepcopy(context)
            mutation(invalid)
            model = AsyncMock()
            with self.assertRaises(HTTPException) as caught:
                await analyze_period(invalid, "2026-09-18", "2026-10-02", model_call=model,
                                     extract_text=main.extract_gemini_text, progress=lambda stage: None)
            self.assertEqual(caught.exception.status_code, 502)
            model.assert_not_awaited()

    async def test_prompt_preserves_all_records_and_excludes_unrelated_fixed_week_context(self):
        context = period_context()
        model = AsyncMock(return_value=response("Análise confirmada."))
        await analyze_period(context, "2026-09-18", "2026-10-02", model_call=model,
                             extract_text=main.extract_gemini_text, progress=lambda stage: None)
        prompt = model.await_args.args[0]["contents"][0]["parts"][0]["text"]
        self.assertIn(json.dumps(context, ensure_ascii=False), prompt)
        self.assertIn("dias sem dados são desconhecidos", prompt)
        self.assertIn("apenas os dias com registros comparáveis", prompt)
        self.assertIn("não os some novamente", prompt)
        self.assertIn("não extraia itens", prompt)
        self.assertIn("não acrescente", prompt.lower())

    async def test_invalid_model_output_and_oversized_context_never_return_guessed_results(self):
        for value in ["", " " * 2, None, 123, "x" * 6001]:
            with self.assertRaises(HTTPException) as caught:
                await analyze_period(period_context(), "2026-09-18", "2026-10-02",
                                     model_call=AsyncMock(return_value=response(value)),
                                     extract_text=main.extract_gemini_text, progress=lambda stage: None)
            self.assertEqual(caught.exception.status_code, 502)
        context = period_context()
        context["registros"]["peso"][0]["note"] = "x" * 200_001
        model = AsyncMock()
        with self.assertRaises(HTTPException) as caught:
            await analyze_period(context, "2026-09-18", "2026-10-02", model_call=model,
                                 extract_text=main.extract_gemini_text, progress=lambda stage: None)
        self.assertEqual(caught.exception.status_code, 422)
        model.assert_not_awaited()

    async def test_storage_failure_propagates_and_does_not_start_extraction(self):
        extractor = AsyncMock()
        with patch.object(main, "run_supabase_helper", AsyncMock(side_effect=HTTPException(503, "Storage unavailable"))), \
                patch.object(main, "analyze_with_gemini", extractor):
            with self.assertRaises(HTTPException):
                await main.process_input(main.ProcessInputRequest(text="Analise o último mês"), {"id": "owner"})
        extractor.assert_not_awaited()

    async def test_historical_interval_is_not_misrepresented_as_today(self):
        model = AsyncMock(return_value=response("Comparação do período histórico."))
        await analyze_period(period_context("2026-09-01", "2026-09-15"), "2026-09-01", "2026-09-15",
                             model_call=model, extract_text=main.extract_gemini_text,
                             progress=lambda stage: None, today=date(2026, 10, 2))
        prompt = model.await_args.args[0]["contents"][0]["parts"][0]["text"]
        self.assertIn("Este período é histórico", prompt)
        self.assertNotIn("O último dia do período é hoje", prompt)