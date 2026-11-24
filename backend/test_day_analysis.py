import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from backend import main
from backend.day_analysis import TABLES, analyze_day, is_day_analysis_request


def context_with_records():
    records = {table: [] for table in TABLES}
    records["peso"] = [{"data": "2026-10-02", "valor_kg": 70.8}]
    return {
        "para_dia": "2026-10-02",
        "periodo": {"inicio": "2026-09-25", "fim": "2026-10-01"},
        "resumo": {"dias": [
            {"data": f"2026-09-{day:02d}"} for day in range(25, 31)
        ] + [{"data": "2026-10-01", "peso_kg": 70.6}]},
        "registros_do_dia": {"data": "2026-10-02", "registros": records},
    }


def model_response(text):
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


class DailyAnalysisTests(unittest.IsolatedAsyncioTestCase):
    def test_detects_daily_questions_but_not_new_or_mixed_records(self):
        for text in [
            "Analise meu dia", "Análise do dia.", "Como foi o meu dia hoje?",
            "Por favor, faça uma análise do meu dia.", "Pode me dar um resumo do dia?",
            "Quero analisar meus registros de hoje", "Resuma o dia de hoje",
            "Faça uma análise do meu dia até agora",
            "Analise meu dia até agora, por favor.",
            "Resumo do dia até o momento", "Como foi meu dia até agora?",
        ]:
            with self.subTest(text=text):
                self.assertTrue(is_day_analysis_request(text))
        for text in [
            None, "", "Peso 70,8", "Bebi 300 ml hoje", "Meu dia teve uma caminhada de 30 min",
            "Analise meu dia e registre 300 ml de água", "Analise meu dia de ontem",
            "A análise do dia estava errada", "Corrija meu sono",
            "Faça uma análise do meu dia até agora e registre 300 ml de água",
        ]:
            with self.subTest(text=text):
                self.assertFalse(is_day_analysis_request(text))

    async def test_route_uses_only_authenticated_owner_and_never_extracts_or_saves(self):
        helper = AsyncMock(return_value=context_with_records())
        analyzer = AsyncMock()
        with (
            patch.object(main, "run_supabase_helper", new=helper),
            patch.object(main, "analyze_with_gemini", new=analyzer),
            patch.object(main, "GEMINI_API_KEY", "test-only"),
            patch.object(main, "call_gemini_sync", return_value=model_response(
                '{"analysis":"Hoje você registrou 70,8 kg."}'
            )),
        ):
            result = await main.process_input(
                main.ProcessInputRequest(text="Analise meu dia"), {"id": "authenticated-owner"},
            )
        self.assertEqual(result, {
            "kind": "day_analysis", "date": "2026-10-02",
            "analysis": "Hoje você registrou 70,8 kg.",
        })
        helper.assert_awaited_once_with(
            "day-analysis-context", payload={"owner_id": "authenticated-owner"}, timeout_seconds=60,
        )
        analyzer.assert_not_awaited()

    async def test_empty_day_reports_no_confirmed_records_without_calling_ai(self):
        context = context_with_records()
        context["registros_do_dia"]["registros"]["peso"] = []
        model = AsyncMock()
        result = await analyze_day(
            context, model_call=model, extract_text=main.extract_gemini_text, progress=lambda stage: None,
        )
        self.assertEqual(result["kind"], "day_analysis")
        self.assertIn("não há registros", result["analysis"])
        self.assertIn("02/10/2026", result["analysis"])
        model.assert_not_awaited()

    async def test_exact_screenshot_request_streams_daily_analysis_without_period_lookup_or_extraction(self):
        helper = AsyncMock(return_value=context_with_records())
        extractor = AsyncMock()
        with patch.object(main, "run_supabase_helper", helper), \
                patch.object(main, "analyze_with_gemini", extractor), \
                patch.object(main, "GEMINI_API_KEY", "test-only"), \
                patch.object(main, "call_gemini_sync", return_value=model_response('{"analysis":"Análise dos registros confirmados de hoje."}')):
            stream = await main.process_input_stream(
                main.ProcessInputRequest(text="Faça uma análise do meu dia até agora"),
                {"id": "authenticated-owner"},
            )
            events = [json.loads(chunk.removeprefix("data: ").strip()) async for chunk in stream.body_iterator]
        self.assertFalse(any(event["type"] == "error" for event in events))
        self.assertEqual(events[-1]["type"], "result")
        self.assertEqual(events[-1]["data"]["kind"], "day_analysis")
        self.assertNotIn("grupos", events[-1]["data"])
        helper.assert_awaited_once_with(
            "day-analysis-context", payload={"owner_id": "authenticated-owner"}, timeout_seconds=60,
        )
        extractor.assert_not_awaited()

    async def test_prompt_contains_all_current_records_and_keeps_history_separate(self):
        context = context_with_records()
        context["registros_do_dia"]["registros"]["sono"] = [
            {"data": "2026-10-02", "duracao_minutos": 420, "acordado_min": 5},
        ]
        model = AsyncMock(return_value=model_response('{"analysis":"Dados confirmados."}'))
        stages = []
        await analyze_day(
            context, model_call=model, extract_text=main.extract_gemini_text, progress=stages.append,
        )
        prompt = model.await_args.args[0]["contents"][0]["parts"][0]["text"]
        self.assertIn(json.dumps(context, ensure_ascii=False), prompt)
        self.assertIn("não o some aos registros de hoje", prompt)
        self.assertIn("não some o total às doses anteriores", prompt)
        self.assertIn("não um novo evento", prompt)
        self.assertIn("não presuma que ele está completo", prompt)
        self.assertIn("não extraia itens", prompt)
        self.assertEqual(stages, ["analyzing_saved_record", "checking_result"])

    async def test_missing_tables_wrong_day_or_incomplete_history_fail_instead_of_guessing(self):
        for mutation in (
            lambda context: context["registros_do_dia"]["registros"].pop("sono"),
            lambda context: context["registros_do_dia"].update(data="2026-10-01"),
            lambda context: context["registros_do_dia"]["registros"]["peso"][0].update(data="2026-10-01"),
            lambda context: context["resumo"]["dias"].pop(),
        ):
            context = context_with_records()
            mutation(context)
            model = AsyncMock()
            with self.assertRaises(HTTPException) as caught:
                await analyze_day(
                    context, model_call=model, extract_text=main.extract_gemini_text, progress=lambda stage: None,
                )
            self.assertEqual(caught.exception.status_code, 502)
            model.assert_not_awaited()

    async def test_invalid_model_responses_and_oversized_context_fail_explicitly(self):
        for text in ('{}', '{"analysis":""}', '{"analysis":123}', 'invalid', json.dumps({"analysis": "x" * 3001})):
            with self.subTest(text=text[:30]):
                with self.assertRaises(HTTPException) as caught:
                    await analyze_day(
                        context_with_records(), model_call=AsyncMock(return_value=model_response(text)),
                        extract_text=main.extract_gemini_text, progress=lambda stage: None,
                    )
                self.assertEqual(caught.exception.status_code, 502)
        context = context_with_records()
        context["registros_do_dia"]["registros"]["peso"][0]["notes"] = "x" * 40_001
        model = AsyncMock()
        with self.assertRaises(HTTPException) as caught:
            await analyze_day(context, model_call=model, extract_text=main.extract_gemini_text, progress=lambda stage: None)
        self.assertEqual(caught.exception.status_code, 422)
        model.assert_not_awaited()

    async def test_stream_returns_daily_text_envelope_not_validation_groups(self):
        with patch.object(main, "run_supabase_helper", new=AsyncMock(return_value=context_with_records())), \
                patch.object(main, "GEMINI_API_KEY", "test-only"), \
                patch.object(main, "call_gemini_sync", return_value=model_response('{"analysis":"Resumo confirmado."}')):
            response = await main.process_input_stream(
                main.ProcessInputRequest(text="Analise meu dia"), {"id": "authenticated-owner"},
            )
            events = [chunk async for chunk in response.body_iterator]
        final_event = json.loads(events[-1].removeprefix("data: ").strip())
        self.assertEqual(final_event["type"], "result")
        self.assertEqual(final_event["data"]["kind"], "day_analysis")
        self.assertNotIn("grupos", final_event["data"])

    async def test_images_keep_record_extraction_even_with_daily_caption(self):
        extractor = AsyncMock(return_value={"grupos": []})
        with patch.object(main, "run_supabase_helper", new=AsyncMock(return_value={})), \
                patch.object(main, "analyze_with_gemini", new=extractor):
            await main.process_input(
                main.ProcessInputRequest(text="Analise meu dia", image_base64="aW1hZ2U="),
                {"id": "authenticated-owner"},
            )
        extractor.assert_awaited_once()