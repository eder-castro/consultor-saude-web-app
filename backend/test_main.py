import asyncio
import base64
import io
import json
import os
import unittest
import urllib.error
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException, Response
from pydantic import ValidationError

import backend.main as main
from backend.simple_records import hydration_goal_record, meal_draft_when_ai_unavailable, simple_text_records


def gemini_response(payload: object) -> dict[str, object]:
    return {
        "candidates": [
            {
                "content": {
                    "parts": [{"text": json.dumps(payload)}],
                },
            }
        ]
    }


def http_error(status: int, body: bytes = b'{"error":{"message":"simulated"}}') -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        "https://generativelanguage.googleapis.com",
        status,
        "simulated Gemini error",
        {},
        io.BytesIO(body),
    )


class InputValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_meal_day_route_uses_authenticated_owner_and_exact_date(self) -> None:
        helper = AsyncMock(return_value={"data": "2026-09-25", "refeicoes": []})
        with patch.object(main, "run_supabase_helper", new=helper):
            result = await main.meals_for_day({"id": "account-a"}, date(2026, 9, 25))
        self.assertEqual(result, {"data": "2026-09-25", "refeicoes": []})
        helper.assert_awaited_once_with(
            "meals-for-day", payload={"owner_id": "account-a"}, argument="2026-09-25"
        )

    async def test_meal_week_route_uses_authenticated_owner_and_exact_period_end(self) -> None:
        helper = AsyncMock(return_value={"periodo": {"inicio": "2026-09-22", "fim": "2026-09-28"}, "dias": []})
        with patch.object(main, "run_supabase_helper", new=helper):
            result = await main.weekly_meals({"id": "account-a"}, date(2026, 9, 28))
        self.assertEqual(result["periodo"]["fim"], "2026-09-28")
        helper.assert_awaited_once_with(
            "weekly-meals", payload={"owner_id": "account-a", "end_date": "2026-09-28"}
        )

    async def test_saved_analyses_route_uses_session_owner_and_selected_date(self) -> None:
        helper = AsyncMock(return_value={"data": "2026-09-25", "analises": []})
        with patch.object(main, "run_supabase_helper", new=helper):
            result = await main.saved_analyses({"id": "account-a"}, date(2026, 9, 25))
        self.assertEqual(result["analises"], [])
        helper.assert_awaited_once_with(
            "saved-analyses", payload={"owner_id": "account-a"}, argument="2026-09-25"
        )

    def test_hydration_goal_is_daily_total_only_when_clearly_achieved(self) -> None:
        from datetime import datetime
        from zoneinfo import ZoneInfo

        now = datetime(2026, 9, 28, 14, 30, tzinfo=ZoneInfo("America/Sao_Paulo"))
        goal = simple_text_records("Meta hídrica batida!", now)["grupos"][0]
        self.assertEqual(goal["data"], "2026-09-28")
        self.assertEqual(goal["itens"][0]["quantidade_estimada"], "2500 ml")
        self.assertTrue(goal["itens"][0]["total_diario"])
        yesterday = simple_text_records("Ontem bati minha meta de água", now)["grupos"][0]
        self.assertEqual(yesterday["data"], "2026-09-27")
        self.assertEqual(
            simple_text_records("Já bati a meta hídrica", now)["grupos"][0]["itens"][0]["quantidade_estimada"],
            "2500 ml",
        )
        self.assertEqual(
            simple_text_records("Minha meta hídrica foi batida", now)["grupos"][0]["itens"][0]["quantidade_estimada"],
            "2500 ml",
        )
        explicit = simple_text_records("Meta hídrica batida em 27/09/2026, total de 2 L", now)["grupos"][0]
        self.assertEqual(explicit["data"], "2026-09-27")
        self.assertEqual(explicit["itens"][0]["quantidade_estimada"], "2000 ml")
        larger = hydration_goal_record("Bati a meta de água; bebi 3 L hoje", now)
        self.assertEqual(larger["itens"][0]["quantidade_estimada"], "3000 ml")
        portion = hydration_goal_record("Bebi 500 ml e bati a meta de água", now)
        self.assertEqual(portion["itens"][0]["quantidade_estimada"], "2500 ml")
        totalized = hydration_goal_record("Bati a meta de água, totalizei 2 L", now)
        self.assertEqual(totalized["itens"][0]["quantidade_estimada"], "2000 ml")
        for text in (
            "Ainda não bati a meta hídrica", "Quase bati a meta hídrica",
            "Se eu bater a meta hídrica", "Faltam 300 ml para bater a meta de água",
            "Meta hídrica batida, bebi 2 L e depois 500 ml",
        ):
            with self.subTest(text=text):
                self.assertIsNone(hydration_goal_record(text, now))
                self.assertIsNone(simple_text_records(text, now))

    async def test_mixed_message_keeps_meal_but_replaces_guessed_water_with_declared_total(self) -> None:
        with (
            patch.object(main, "run_supabase_helper", new_callable=AsyncMock, return_value={}),
            patch.object(main, "analyze_with_gemini", new_callable=AsyncMock, return_value={
                "grupos": [
                    {"evento_tipo": "alimentacao", "itens": [{"item": "arroz"}]},
                    {"evento_tipo": "hidratacao", "itens": [{"item": "água", "quantidade_estimada": "2 L"}]},
                ],
            }),
        ):
            result = await main.process_input(
                main.ProcessInputRequest(text="Comi arroz e meta hídrica batida"),
                {"id": "owner-a"},
            )
        self.assertEqual([g["evento_tipo"] for g in result["grupos"]], ["alimentacao", "hidratacao"])
        self.assertTrue(result["grupos"][1]["itens"][0]["total_diario"])
        self.assertEqual(result["grupos"][1]["itens"][0]["quantidade_estimada"], "2500 ml")

    async def test_unmet_goal_cannot_be_saved_as_2500_even_if_ai_guesses_it(self) -> None:
        with (
            patch.object(main, "run_supabase_helper", new_callable=AsyncMock, return_value={}),
            patch.object(main, "analyze_with_gemini", new_callable=AsyncMock, return_value={
                "grupos": [{"evento_tipo": "hidratacao", "itens": [
                    {"item": "água", "quantidade_estimada": "2500 ml"}
                ]}],
            }),
        ):
            for text in (
                "Ainda não bati a meta hídrica",
                "Faltam 300 ml, ainda não bati a meta hídrica",
                "Bebi 500 ml, mas ainda não bati a meta hídrica",
            ):
                with self.subTest(text=text):
                    with self.assertRaisesRegex(HTTPException, "ainda não foi informada"):
                        await main.process_input(main.ProcessInputRequest(text=text), {"id": "owner-a"})

    async def test_unmet_goal_still_allows_explicitly_consumed_water(self) -> None:
        with (
            patch.object(main, "run_supabase_helper", new_callable=AsyncMock, return_value={}),
            patch.object(main, "analyze_with_gemini", new_callable=AsyncMock, return_value={
                "grupos": [{"evento_tipo": "hidratacao", "itens": [
                    {"item": "água", "quantidade_estimada": "500 ml"},
                    {"item": "meta", "quantidade_estimada": "2500 ml"},
                ]}],
            }),
        ):
            result = await main.process_input(
                main.ProcessInputRequest(text="Bebi 500 ml, mas ainda não bati a meta hídrica"),
                {"id": "owner-a"},
            )
        self.assertEqual(
            [item["quantidade_estimada"] for item in result["grupos"][0]["itens"]],
            ["500 ml"],
        )

    async def test_saved_analysis_uses_owned_persisted_rows_not_client_item_text(self) -> None:
        ref = {"table": "alimentacao", "import_key": "app:ca22a124-32df-4117-83a2-3dbe0011569f"}
        context = {
            "para_dia": "2026-09-30",
            "periodo": {"inicio": "2026-09-23", "fim": "2026-09-29"},
            "confirmados": [{"tipo": "alimentacao", "registros": [
                {"data": "2026-09-28", "item": "arroz editado", "quantidade": "1 porção"},
            ]}],
            "resumo": {"dias": [
                {"data": "2026-09-29", "sono_min": 420, "refeicoes": 2},
            ]},
        }
        with (
            patch.object(main, "run_supabase_helper", new_callable=AsyncMock, return_value=context) as helper,
            patch.object(main, "call_gemini_sync", return_value=gemini_response({
                "analysis": "Foi registrado arroz, 1 porção. Não há base para concluir tendência."
            })) as gemini,
            patch.object(main, "GEMINI_API_KEY", "test-only-key"),
        ):
            result = await main.analyze_saved_records(
                main.AnalyzeSavedRecordsRequest(record_refs=[ref]), {"id": "owner-a"}
            )
        self.assertIn("arroz", result["analysis"])
        helper.assert_awaited_once_with(
            "analysis-context",
            payload={"owner_id": "owner-a", "record_refs": [ref]},
            timeout_seconds=60,
        )
        prompt = gemini.call_args.args[0]["contents"][0]["parts"][0]["text"]
        self.assertIn("arroz editado", prompt)
        self.assertIn("2026-09-23", prompt)
        self.assertIn("Não invente ingredientes", prompt)
        self.assertIn("Não faça uma nova análise da semana", prompt)
        self.assertIn("relações entre tipos", prompt)
        self.assertIn("APENAS do novo envio", prompt)

    async def test_daily_analysis_summary_is_owned_and_does_not_call_gemini(self) -> None:
        snapshot = {"ok": True, "para_dia": "2026-09-30", "resumo": {"dias": []}}
        with (
            patch.object(main, "run_supabase_helper", new_callable=AsyncMock, return_value=snapshot) as helper,
            patch.object(main, "call_gemini_sync") as gemini,
        ):
            result = await main.daily_analysis_summary({"id": "owner-a"})
        self.assertEqual(result, snapshot)
        helper.assert_awaited_once_with(
            "daily-analysis-summary", payload={"owner_id": "owner-a"}, timeout_seconds=60,
        )
        gemini.assert_not_called()

    async def test_first_entry_today_uses_prior_history_without_requiring_a_trend(self) -> None:
        examples = [
            ("peso", {"valor_kg": 70.8}, {"peso_kg": 70.6}),
            ("sono", {"duracao_minutos": 420}, {"sono_min": 390}),
            ("alimentacao", {"item": "Pão integral", "quantidade": "1 fatia"},
             {"alimentos": [{"item": "Pão integral", "ocorrencias": 1}]}),
        ]
        for table, current, historical in examples:
            with self.subTest(table=table):
                row = {"data": "2026-10-02", **current}
                context = {
                    "para_dia": "2026-10-02",
                    "periodo": {"inicio": "2026-09-25", "fim": "2026-10-01"},
                    "confirmados": [{"tipo": table, "registros": [row]}],
                    "registros_do_dia": {"data": "2026-10-02", "registros": {table: [row]}},
                    "resumo": {"dias": [
                        {"data": f"2026-09-{day:02d}"} for day in range(25, 31)
                    ] + [{"data": "2026-10-01", **historical}]},
                }
                with (
                    patch.object(main, "GEMINI_API_KEY", "test-only-key"),
                    patch.object(main, "call_gemini_sync", return_value=gemini_response({
                        "analysis": "Comentário sobre o registro confirmado."
                    })) as gemini,
                ):
                    await main.generate_saved_record_analysis(context)
                prompt = gemini.call_args.args[0]["contents"][0]["parts"][0]["text"]
                self.assertIn("primeiro registro do dia NÃO impede uma comparação", prompt)
                self.assertIn("mesmo que só exista um registro anterior", prompt)
                self.assertIn("Uma diferença entre dois registros não prova tendência", prompt)
                self.assertIn("não uma refeição isolada com o total de um dia inteiro", prompt)
                self.assertIn(json.dumps(context, ensure_ascii=False), prompt)
                self.assertNotIn("quando houver poucos registros, diga", prompt)

    async def test_no_comparable_history_requests_useful_facts_not_a_repeated_disclaimer(self) -> None:
        context = {
            "para_dia": "2026-10-02",
            "confirmados": [{"tipo": "hidratacao", "registros": [
                {"data": "2026-10-02", "quantidade": "300 ml"},
            ]}],
            "resumo": {"dias": []},
            "registros_do_dia": {"data": "2026-10-02", "registros": {}},
        }
        with (
            patch.object(main, "GEMINI_API_KEY", "test-only-key"),
            patch.object(main, "call_gemini_sync", return_value=gemini_response({
                "analysis": "Você registrou 300 ml de água."
            })) as gemini,
        ):
            await main.generate_saved_record_analysis(context)
        prompt = gemini.call_args.args[0]["contents"][0]["parts"][0]["text"]
        self.assertIn("Quando não houver referência comparável", prompt)
        self.assertIn("sem forçar comparação", prompt)
        self.assertIn("Só explique uma limitação de dados quando ela for necessária", prompt)
        self.assertIn("não presuma o que aconteceu nos dias sem registros", prompt)

    async def test_water_comment_can_link_context_without_reanalyzing_unrelated_weekly_records(self) -> None:
        context = {
            "para_dia": "2026-09-30",
            "periodo": {"inicio": "2026-09-23", "fim": "2026-09-29"},
            "confirmados": [{"tipo": "hidratacao", "registros": [
                {"data": "2026-09-30", "horario": "17:00", "quantidade": "300 ml"},
            ]}],
            "resumo": {"dias": [
                {"data": "2026-09-29", "peso_kg": 80, "sono_min": 420,
                 "alimentos": [{"item": "carne salgada", "ocorrencias": 1}]},
            ]},
            "registros_do_dia": {"data": "2026-09-30", "registros": {
                "alimentacao": [{"data": "2026-09-30", "horario": "12:00", "item": "Almoço de hoje"}],
                "hidratacao": [{"data": "2026-09-30", "horario": "17:00", "quantidade": "300 ml"}],
            }},
        }
        with (
            patch.object(main, "GEMINI_API_KEY", "test-only-key"),
            patch.object(main, "call_gemini_sync", return_value=gemini_response({
                "analysis": "Você registrou 300 ml de água. Mantenha a hidratação habitual ao longo do dia."
            })) as gemini,
        ):
            analysis = await main.generate_saved_record_analysis(context)
        self.assertIn("300 ml", analysis)
        prompt = gemini.call_args.args[0]["contents"][0]["parts"][0]["text"]
        self.assertIn("responda em duas ou três frases", prompt)
        self.assertIn("Não comente peso, sono, café da manhã, almoço", prompt)
        self.assertIn("Uma ligação pertinente com outro registro", prompt)
        self.assertIn("no máximo uma frase", prompt)
        self.assertIn("não presuma excesso de sódio apenas por haver carne", prompt)
        self.assertIn("não afirme que beber água anula o sódio ingerido", prompt)
        self.assertIn("'o almoço de hoje'", prompt)
        self.assertIn('"peso_kg": 80', prompt)
        self.assertIn('"carne salgada"', prompt)
        self.assertIn('"Almoço de hoje"', prompt)
        self.assertIn("consultados novamente a cada análise", prompt)
        self.assertIn("não os conte nem some duas vezes", prompt)
        self.assertIn("Só se refira ao almoço de hoje quando houver dados", prompt)

    async def test_saved_analysis_rejects_truncated_context_instead_of_inventing_trends(self) -> None:
        with (
            patch.object(main, "GEMINI_API_KEY", "test-only-key"),
            patch.object(main, "call_gemini_sync") as gemini,
        ):
            with self.assertRaises(HTTPException) as error:
                await main.generate_saved_record_analysis({"records": "a" * 40_001})
        self.assertEqual(error.exception.status_code, 422)
        gemini.assert_not_called()

    async def test_extraction_context_preserves_whole_daily_summary_and_does_not_replay_recent_rows(self) -> None:
        summary = {"para_dia": "2026-09-30", "resumo": {"dias": [{"data": "2026-09-29"}]}}
        result = json.loads(main.context_for_prompt({
            "daily_summary": summary,
            "recent": {"food": [{"item": "Não é um novo envio"}]},
            "today_records": {"data": "2026-09-30", "registros": {
                "alimentacao": [{"item": "Almoço confirmado hoje"}],
            }},
        }))
        self.assertEqual(result["resumo_diario_de_referencia"], summary)
        self.assertNotIn("registros_recentes", result)
        self.assertEqual(
            result["registros_confirmados_do_dia"]["registros"]["alimentacao"][0]["item"],
            "Almoço confirmado hoje",
        )
        with self.assertRaises(HTTPException) as error:
            main.context_for_prompt({
                "daily_summary": summary,
                "profile": {"clinical_profile": "a" * 40_001},
            })
        self.assertEqual(error.exception.status_code, 422)

    async def test_followup_to_saved_meal_never_creates_another_entry(self) -> None:
        context = {
            "local_now": {"data": "2026-09-26", "horario": "10:33"},
            "recent": {"food": [{"data": "2026-09-26", "item": "Vitamina"}]},
        }
        with (
            patch.object(main, "run_supabase_helper", new_callable=AsyncMock, return_value=context),
            patch.object(main, "analyze_with_gemini", new_callable=AsyncMock) as analyzer,
        ):
            for text in (
                "Vitamina tinha goiaba maçã banana e leite",
                "Só pra constar, a descrição da vitamina era uma atualização do café da manhã!",
                "Era um pão francês com creme de ricota. Um pedacinho de bolo. Suco com couve.",
            ):
                with self.subTest(text=text):
                    result = await main.process_input(
                        main.ProcessInputRequest(text=text), {"id": "owner-a"}
                    )
                    self.assertEqual(result["kind"], "meal_correction")
                    self.assertEqual(result["source_text"], text)
                    self.assertEqual(result["target_count"], 1)
            merge = await main.process_input(
                main.ProcessInputRequest(
                    text="Os 2 últimos registros eram da mesma refeição. Corrija o que foi registrado.",
                    previous_user_message="Era um pão francês com creme de ricota. Um pedacinho de bolo.",
                ),
                {"id": "owner-a"},
            )
            self.assertEqual(merge["kind"], "meal_correction")
            self.assertEqual(merge["target_count"], 2)
            self.assertEqual(merge["source_text"], "Era um pão francês com creme de ricota. Um pedacinho de bolo.")
        analyzer.assert_not_awaited()
        self.assertTrue(main.looks_like_meal_correction("Vitamina tinha goiaba", {"recent": {"food": []}}))
        self.assertFalse(main.looks_like_meal_correction(
            "Corrija meu sono", context, "Era um pão francês com creme de ricota",
        ))

    async def test_explicit_meal_correction_without_meal_today_never_creates_a_new_one(self) -> None:
        context = {"local_now": {"data": "2026-09-28"}, "recent": {"food": []}}
        with (
            patch.object(main, "run_supabase_helper", new_callable=AsyncMock, return_value=context),
            patch.object(main, "analyze_with_gemini", new_callable=AsyncMock) as analyzer,
        ):
            result = await main.process_input(
                main.ProcessInputRequest(
                    text="Os 2 últimos registros eram da mesma refeição. Corrija o que foi registrado.",
                    previous_user_message="Era um pão francês com creme de ricota.",
                ),
                {"id": "owner-a"},
            )
        self.assertEqual(result["kind"], "meal_correction")
        self.assertEqual(result["target_count"], 2)
        analyzer.assert_not_awaited()

    async def test_meal_changes_are_scoped_to_authenticated_owner(self) -> None:
        helper = AsyncMock(return_value={"ok": True})
        with patch.object(main, "run_supabase_helper", new=helper):
            await main.correct_meal(
                "42", main.MealCorrectionRequest(item="Vitamina de frutas", quantidade="1 copo"),
                {"id": "owner-a"},
            )
            self.assertEqual(helper.await_args.args[0], "change-meal")
            self.assertEqual(helper.await_args.kwargs["payload"]["owner_id"], "owner-a")
            self.assertEqual(helper.await_args.kwargs["payload"]["record_id"], "42")
            await main.remove_meal("43", {"id": "owner-a"})
            self.assertEqual(helper.await_args.args[0], "delete-meal")
            self.assertEqual(helper.await_args.kwargs["payload"]["record_id"], "43")
            snapshot = {
                "id": "42", "data": "2026-09-27", "horario": "11:01",
                "item": "Pão", "quantidade": "não informada",
            }
            await main.apply_meal_correction(
                main.ReplaceMealRequest(
                    correction_id="proposal-42",
                    record_ids=["42"], keep_record_id="42",
                    item="Pão francês com creme de ricota",
                    quantidade="conforme descrição",
                    expected_rows=[snapshot],
                ),
                {"id": "owner-a"},
            )
            self.assertEqual(helper.await_args.args[0], "replace-meal")
            self.assertEqual(helper.await_args.kwargs["payload"]["owner_id"], "owner-a")
            self.assertEqual(helper.await_args.kwargs["payload"]["expected_rows"], [snapshot])
            self.assertEqual(helper.await_args.kwargs["payload"]["correction_id"], "proposal-42")
            await main.meal_correction_status(
                main.MealCorrectionStatusesRequest(correction_ids=["proposal-42"]),
                {"id": "owner-a"},
            )
            self.assertEqual(helper.await_args.args[0], "meal-correction-statuses")
            self.assertEqual(helper.await_args.kwargs["payload"]["owner_id"], "owner-a")

    async def test_simple_previous_day_text_skips_gemini_and_context(self) -> None:
        with patch.object(main, "run_supabase_helper", new_callable=AsyncMock) as helper:
            result = await main.process_input(
                main.ProcessInputRequest(text="Peso ontem foi 93,9 Peso anteontem foi 94"),
                {"id": "owner"},
            )
        helper.assert_not_awaited()
        self.assertEqual(len(result["grupos"]), 2)
        self.assertNotEqual(result["grupos"][0]["data"], result["grupos"][1]["data"])
        self.assertEqual(result["grupos"][0]["itens"][0]["quantidade_estimada"], "93,9 kg")

    def test_simple_water_uses_sao_paulo_calendar(self) -> None:
        from datetime import datetime
        from zoneinfo import ZoneInfo

        now = datetime(2026, 9, 24, 11, 31, tzinfo=ZoneInfo("America/Sao_Paulo"))
        result = simple_text_records("Hidratação de.ontem chegou a 2,5l", now)
        self.assertIsNotNone(result)
        self.assertEqual(result["grupos"][0]["data"], "2026-09-23")
        self.assertEqual(result["grupos"][0]["itens"][0]["quantidade_estimada"], "2500 ml")
        self.assertEqual(
            simple_text_records("Bebi 500ml de água ontem", now)["grupos"][0]["data"],
            "2026-09-23",
        )
        self.assertEqual(
            simple_text_records("dormi 7h", now)["grupos"][0]["itens"][0]["quantidade_estimada"],
            "420 min",
        )

    def test_complex_meal_and_mixed_messages_still_require_analysis(self) -> None:
        self.assertIsNone(simple_text_records("Ontem jantei pão integral com queijo"))
        self.assertIsNone(simple_text_records("Peso ontem foi 93,9 e comi arroz"))
        self.assertIsNone(simple_text_records("Hidratação ontem 2,5l e corri 10km"))

    async def test_meal_description_is_reviewable_when_gemini_is_unavailable(self) -> None:
        with (
            patch.object(main, "run_supabase_helper", new_callable=AsyncMock) as helper,
            patch.object(
                main, "analyze_with_gemini",
                new_callable=AsyncMock,
                side_effect=HTTPException(503, "O Gemini está sobrecarregado."),
            ),
        ):
            result = await main.process_input(
                main.ProcessInputRequest(
                    text="Ontem jantei 2 fatias de pão integral e 4 fatias de queijo minas"
                ),
                {"id": "owner"},
            )
        helper.assert_awaited_once()
        self.assertEqual(result["grupos"][0]["evento_tipo"], "alimentacao")
        self.assertTrue(result["grupos"][0]["itens"][0]["item"].startswith("2 fatias"))
        self.assertIn("Análise automática indisponível", result["resumo"])

    async def test_photo_exhausts_gemini_models_and_is_queued_without_inventing_result(self) -> None:
        quota = b'{"error":{"message":"quota exceeded"}}'
        def unavailable(request, **kwargs):
            if "primary-model:" in request.full_url:
                raise http_error(503)
            raise http_error(429, quota)
        with (
            patch.object(main, "GEMINI_API_KEY", "test-key"),
            patch.object(main, "GEMINI_MODEL", "primary-model"),
            patch.object(main, "GEMINI_FALLBACK_MODEL", "secondary-model"),
            patch.object(main, "GEMINI_FALLBACK_MODELS", ("third-model", "fourth-model")),
            patch.object(main, "GEMINI_POWER_MODEL", ""),
            patch.object(main.urllib.request, "urlopen", side_effect=unavailable) as urlopen,
            patch.object(main, "run_supabase_helper", new_callable=AsyncMock) as helper,
        ):
            helper.side_effect = [
                {"local_now": {"data": "2026-09-25", "horario": "12:00"}},
                {"job_id": "queued-1", "status": "pending"},
            ]
            result = await main.process_input(
                main.ProcessInputRequest(
                    text="Almoço",
                    images=[main.ProcessImage(image_base64="aGVsbG8=", mime_type="image/png")],
                ),
                {"id": "owner"},
            )

        self.assertEqual(urlopen.call_count, 4)
        self.assertEqual(result, {"pending_job_id": "queued-1", "status": "pending"})
        self.assertEqual(helper.await_count, 2)
        self.assertEqual(helper.await_args_list[0].args, ("context",))
        self.assertEqual(helper.await_args_list[1].args, ("enqueue-photo",))
        self.assertEqual(helper.await_args_list[1].kwargs["payload"]["input"]["text"], "Almoço")

    async def test_photo_returns_structured_results_when_gemini_fallback_succeeds(self) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = json.dumps(
            gemini_response({
                "grupos": [{
                    "evento_tipo": "alimentacao",
                    "itens": [{"item": "Arroz", "quantidade_estimada": "aprox. 100 g", "confirmado": False}],
                }],
                "resumo": "Arroz visível na foto.",
            })
        ).encode()
        with (
            patch.object(main, "GEMINI_API_KEY", "test-key"),
            patch.object(main, "GEMINI_MODEL", "primary-model"),
            patch.object(main, "GEMINI_FALLBACK_MODEL", "secondary-model"),
            patch.object(main, "GEMINI_POWER_MODEL", ""),
            patch.object(main.urllib.request, "urlopen", side_effect=[http_error(503), response]) as urlopen,
            patch.object(main, "run_supabase_helper", new_callable=AsyncMock) as helper,
        ):
            helper.return_value = {"local_now": {"data": "2026-09-25", "horario": "12:00"}}
            result = await main.process_input(
                main.ProcessInputRequest(
                    images=[main.ProcessImage(image_base64="aGVsbG8=", mime_type="image/png")]
                ),
                {"id": "owner"},
            )

        self.assertEqual(urlopen.call_count, 2)
        self.assertEqual(result["grupos"][0]["evento_tipo"], "alimentacao")
        self.assertEqual(result["grupos"][0]["itens"][0]["quantidade_estimada"], "aprox. 100 g")
        self.assertFalse(result["grupos"][0]["itens"][0]["confirmado"])
        self.assertIn("Descrição visual preliminar", result["resumo"])

    async def test_deferred_photo_retry_waits_for_review_on_success(self) -> None:
        job = {
            "id": "00000000-0000-4000-8000-000000000001",
            "owner_id": "owner",
            "attempts": 2,
            "input": {"images": [{"image_base64": "aGVsbG8=", "mime_type": "image/png"}]},
        }
        structured = {
            "grupos": [{"evento_tipo": "alimentacao", "itens": [
                {"item": "Arroz", "quantidade_estimada": "aprox. 100 g", "confirmado": False}
            ]}]
        }
        with (
            patch.object(main, "run_supabase_helper", new_callable=AsyncMock) as helper,
            patch.object(main, "analyze_with_gemini", new_callable=AsyncMock) as analyzer,
        ):
            helper.side_effect = [{"job": job}, {"local_now": {}}, {"ok": True}]
            analyzer.return_value = structured
            self.assertTrue(await main.process_pending_photo_job())
        analyzer.assert_awaited_once()
        self.assertEqual(helper.await_args_list[-1].args, ("finish-photo",))
        self.assertEqual(helper.await_args_list[-1].kwargs["payload"]["status"], "ready")
        self.assertEqual(helper.await_args_list[-1].kwargs["payload"]["result"], structured)
        self.assertNotIn("save", [call.args[0] for call in helper.await_args_list])

    async def test_photo_poll_wakes_retry_worker_after_successful_storage_access(self) -> None:
        with (
            patch.object(main, "run_supabase_helper", new_callable=AsyncMock) as helper,
            patch.object(main, "wake_photo_worker") as wake,
        ):
            helper.return_value = {"ok": True, "jobs": [{"status": "pending"}]}
            result = await main.photo_jobs({"id": "owner-a"})
            wake.assert_called_once()
            self.assertEqual(result["jobs"][0]["status"], "pending")
            helper.assert_awaited_once_with("list-photos", payload={"owner_id": "owner-a"})
            wake.reset_mock()
            helper.return_value = {"ok": True, "jobs": [{"status": "ready"}]}
            await main.photo_jobs({"id": "owner-a"})
            wake.assert_not_called()

    async def test_photo_worker_recovers_from_claim_failure_without_failing_a_photo(self) -> None:
        with (
            patch.object(main, "process_pending_photo_job", new_callable=AsyncMock) as process,
            patch.object(main, "wait_for_photo_work", new_callable=AsyncMock) as wait,
        ):
            process.side_effect = [HTTPException(502, "Connector identity unavailable"), False]
            wait.side_effect = [None, asyncio.CancelledError()]
            with self.assertRaises(asyncio.CancelledError):
                await main.photo_job_worker()
        self.assertEqual(process.await_count, 2)
        self.assertEqual([call.args for call in wait.await_args_list], [(60,), (60,)])

    async def test_photo_worker_wakeup_does_not_wait_for_poll_interval(self) -> None:
        with patch.object(main.app.state, "photo_worker_wakeup", asyncio.Event(), create=True):
            main.wake_photo_worker()
            await asyncio.wait_for(main.wait_for_photo_work(60), timeout=1)
            self.assertFalse(main.app.state.photo_worker_wakeup.is_set())

    async def test_deferred_photo_retries_only_transient_errors(self) -> None:
        job = {
            "id": "00000000-0000-4000-8000-000000000001",
            "owner_id": "owner",
            "attempts": 1,
            "input": {"images": [{"image_base64": "aGVsbG8=", "mime_type": "image/png"}]},
        }
        for exception, expected in [
            (HTTPException(429, "Cota atingida"), "pending"),
            (HTTPException(503, "Credencial inválida"), "failed"),
            (HTTPException(502, "Resposta inválida"), "failed"),
        ]:
            with self.subTest(expected=expected):
                with (
                    patch.object(main, "run_supabase_helper", new_callable=AsyncMock) as helper,
                    patch.object(main, "analyze_with_gemini", new_callable=AsyncMock) as analyzer,
                ):
                    helper.side_effect = [{"job": job}, {"local_now": {}}, {"ok": True}]
                    analyzer.side_effect = exception
                    self.assertTrue(await main.process_pending_photo_job())
                    self.assertEqual(helper.await_args_list[-1].kwargs["payload"]["status"], expected)
                    self.assertIsNone(helper.await_args_list[-1].kwargs["payload"]["result"])

    def test_meal_draft_rejects_non_meal_or_long_description(self) -> None:
        self.assertIsNone(meal_draft_when_ai_unavailable("Ontem eu fiz caminhada"))
        self.assertIsNone(meal_draft_when_ai_unavailable("Ontem jantei " + "pão " * 60))

    async def test_rejects_empty_input_without_calling_gemini(self) -> None:
        with self.assertRaisesRegex(HTTPException, "Envie um texto"):
            await main.analyze_with_gemini(main.ProcessInputRequest())

    async def test_rejects_missing_api_key_without_calling_gemini(self) -> None:
        with patch.object(main, "GEMINI_API_KEY", ""):
            with self.assertRaisesRegex(HTTPException, "ainda não está configurada"):
                await main.analyze_with_gemini(main.ProcessInputRequest(text="almoço"))

    async def test_rejects_unsupported_image_type(self) -> None:
        with patch.object(main, "GEMINI_API_KEY", "test-key"):
            with self.assertRaisesRegex(HTTPException, "Tipo de imagem não suportado"):
                await main.analyze_with_gemini(
                    main.ProcessInputRequest(
                        image_base64="aGVsbG8=",
                        mime_type="application/pdf",
                    )
                )

    async def test_rejects_invalid_image_base64(self) -> None:
        with patch.object(main, "GEMINI_API_KEY", "test-key"):
            with self.assertRaisesRegex(HTTPException, "Base64 válido"):
                await main.analyze_with_gemini(
                    main.ProcessInputRequest(
                        image_base64="not-valid-base64",
                        mime_type="image/png",
                    )
                )

    async def test_rejects_image_over_eight_megabytes(self) -> None:
        encoded = base64.b64encode(b"x" * (main.MAX_IMAGE_BYTES + 1)).decode()
        with patch.object(main, "GEMINI_API_KEY", "test-key"):
            with self.assertRaisesRegex(HTTPException, "limite de 8 MB"):
                await main.analyze_with_gemini(
                    main.ProcessInputRequest(
                        image_base64=encoded,
                        mime_type="image/png",
                    )
                )

    def test_rejects_text_over_configured_limit(self) -> None:
        with self.assertRaises(ValidationError):
            main.ProcessInputRequest(text="x" * (main.MAX_TEXT_LENGTH + 1))


class AuthenticationTests(unittest.IsolatedAsyncioTestCase):
    def test_password_hash_is_salted_and_verifiable(self) -> None:
        first = main.hash_password("senha-segura")
        second = main.hash_password("senha-segura")

        self.assertNotEqual(first, second)
        self.assertTrue(main.verify_password("senha-segura", first))
        self.assertFalse(main.verify_password("senha-incorreta", first))
        self.assertFalse(main.verify_password("senha-segura", "hash-invalido"))

    def test_invited_emails_accepts_commas_semicolons_and_lines(self) -> None:
        with patch.dict(
            os.environ,
            {"INVITED_EMAILS": " UM@EXEMPLO.COM,\ndois@exemplo.com; tres@exemplo.com "},
        ):
            self.assertEqual(
                main.invited_emails(),
                {"um@exemplo.com", "dois@exemplo.com", "tres@exemplo.com"},
            )

    async def test_rejects_registration_outside_invite_list(self) -> None:
        with patch.dict(os.environ, {"INVITED_EMAILS": "permitido@exemplo.com"}):
            with self.assertRaises(HTTPException) as captured:
                await main.register_user(
                    main.CredentialsRequest(
                        email="bloqueado@exemplo.com",
                        password="senha-segura",
                    ),
                    Response(),
                )

        self.assertEqual(captured.exception.status_code, 403)

    async def test_rejects_expired_or_revoked_session_without_exposing_token(self) -> None:
        helper = AsyncMock(return_value={"ok": True, "user": None})
        request = MagicMock()

        with patch.object(main, "run_supabase_helper", new=helper):
            with self.assertRaises(HTTPException) as captured:
                await main.current_user(request, "session-token-for-test")

        self.assertEqual(captured.exception.status_code, 401)
        payload = helper.await_args.kwargs["payload"]
        self.assertEqual(payload["token_hash"], main.hash_session_token("session-token-for-test"))
        self.assertNotIn("session-token-for-test", json.dumps(payload))

    async def test_valid_session_is_cached_so_repeat_requests_skip_storage(self) -> None:
        main._session_cache.clear()
        user = {"id": "user-1", "email": "pessoa@exemplo.com"}
        helper = AsyncMock(return_value={"ok": True, "user": user})

        with patch.object(main, "run_supabase_helper", new=helper):
            first = await main.current_user(MagicMock(), "token-cache")
            second = await main.current_user(MagicMock(), "token-cache")

        self.assertEqual(first, user)
        self.assertEqual(second, user)
        self.assertEqual(helper.await_count, 1)
        main._session_cache.clear()

    async def test_invalid_session_is_not_cached(self) -> None:
        main._session_cache.clear()
        helper = AsyncMock(return_value={"ok": True, "user": None})

        with patch.object(main, "run_supabase_helper", new=helper):
            for _ in range(2):
                with self.assertRaises(HTTPException):
                    await main.current_user(MagicMock(), "token-invalido")

        self.assertEqual(helper.await_count, 2)
        self.assertEqual(main._session_cache, {})

    async def test_expired_cache_entry_checks_storage_again(self) -> None:
        main._session_cache.clear()
        user = {"id": "user-1", "email": "pessoa@exemplo.com"}
        helper = AsyncMock(return_value={"ok": True, "user": user})

        with patch.object(main, "run_supabase_helper", new=helper):
            await main.current_user(MagicMock(), "token-expira")
            token_hash = main.hash_session_token("token-expira")
            main._session_cache[token_hash] = (main.time.monotonic() - 1, user)
            await main.current_user(MagicMock(), "token-expira")

        self.assertEqual(helper.await_count, 2)
        main._session_cache.clear()

    async def test_logout_drops_cached_session_before_revoking(self) -> None:
        main._session_cache.clear()
        user = {"id": "user-1", "email": "pessoa@exemplo.com"}
        helper = AsyncMock(return_value={"ok": True, "user": user})

        with patch.object(main, "run_supabase_helper", new=helper):
            await main.current_user(MagicMock(), "token-logout")
            await main.auth_logout(Response(), "token-logout")
            helper.return_value = {"ok": True, "user": None}
            with self.assertRaises(HTTPException) as captured:
                await main.current_user(MagicMock(), "token-logout")

        self.assertEqual(captured.exception.status_code, 401)
        self.assertEqual(
            [call.args[0] for call in helper.await_args_list],
            ["session-user", "revoke-session", "session-user"],
        )

    @staticmethod
    def _login_request(address: str = "203.0.113.7") -> MagicMock:
        request = MagicMock()
        request.headers = {"x-forwarded-for": f"{address}, 10.0.0.1"}
        return request

    async def test_login_is_blocked_after_repeated_failures_for_same_email(self) -> None:
        main._auth_failures.clear()
        helper = AsyncMock(return_value={"ok": True, "authenticated": False})
        body = main.CredentialsRequest(email="Dono@Exemplo.com", password="senha-errada")

        with patch.object(main, "run_supabase_helper", new=helper):
            for attempt in range(main.AUTH_MAX_FAILURES_PER_EMAIL):
                with self.assertRaises(HTTPException) as captured:
                    # IPs diferentes: o limite por e-mail vale mesmo trocando de IP.
                    await main.auth_login(body, Response(), self._login_request(f"198.51.100.{attempt}"))
                self.assertEqual(captured.exception.status_code, 401)
            with self.assertRaises(HTTPException) as blocked:
                await main.auth_login(body, Response(), self._login_request("198.51.100.99"))

        self.assertEqual(blocked.exception.status_code, 429)
        self.assertIn("Retry-After", blocked.exception.headers)
        self.assertEqual(helper.await_count, main.AUTH_MAX_FAILURES_PER_EMAIL)
        main._auth_failures.clear()

    async def test_successful_login_clears_failures_for_email(self) -> None:
        main._auth_failures.clear()
        failing = AsyncMock(return_value={"ok": True, "authenticated": False})
        body = main.CredentialsRequest(email="pessoa@exemplo.com", password="senha-segura")
        with patch.object(main, "run_supabase_helper", new=failing):
            for _ in range(main.AUTH_MAX_FAILURES_PER_EMAIL - 1):
                with self.assertRaises(HTTPException):
                    await main.auth_login(body, Response(), self._login_request())

        user = {"id": "user-1", "email": "pessoa@exemplo.com"}
        ok = AsyncMock(return_value={"ok": True, "authenticated": True, "user": user})
        with (
            patch.dict(os.environ, {"COOKIE_SECURE": "false"}),
            patch.object(main, "run_supabase_helper", new=ok),
        ):
            self.assertEqual(await main.auth_login(body, Response(), self._login_request()), user)

        self.assertNotIn("email:pessoa@exemplo.com", main._auth_failures)
        main._auth_failures.clear()

    async def test_many_failures_from_one_client_are_blocked_across_emails(self) -> None:
        main._auth_failures.clear()
        helper = AsyncMock(return_value={"ok": True, "authenticated": False})
        with patch.object(main, "run_supabase_helper", new=helper):
            for index in range(main.AUTH_MAX_FAILURES_PER_CLIENT):
                with self.assertRaises(HTTPException):
                    await main.auth_login(
                        main.CredentialsRequest(email=f"teste{index}@exemplo.com", password="senha-errada"),
                        Response(),
                        self._login_request(),
                    )
            with self.assertRaises(HTTPException) as blocked:
                await main.auth_login(
                    main.CredentialsRequest(email="outro@exemplo.com", password="senha-errada"),
                    Response(),
                    self._login_request(),
                )
        self.assertEqual(blocked.exception.status_code, 429)
        main._auth_failures.clear()

    def test_password_hash_uses_stronger_scrypt_and_accepts_legacy_hashes(self) -> None:
        encoded = main.hash_password("senha-segura")
        self.assertTrue(encoded.startswith(f"scrypt${2**16}$8$1$"))
        self.assertTrue(main.verify_password("senha-segura", encoded))
        self.assertFalse(main.verify_password("senha-errada", encoded))

        import hashlib
        salt = bytes(16)
        legacy_digest = hashlib.scrypt(b"senha-antiga", salt=salt, n=2**14, r=8, p=1, dklen=64)
        legacy = f"scrypt$16384$8$1${salt.hex()}${legacy_digest.hex()}"
        self.assertTrue(main.verify_password("senha-antiga", legacy))

    async def test_storage_errors_do_not_leak_internal_details(self) -> None:
        class FakeProcess:
            returncode = 1

            def __init__(self, stdout: bytes, stderr: bytes = b"") -> None:
                self._out = (stdout, stderr)

            async def communicate(self, input=None):  # noqa: A002 - mesma assinatura do asyncio
                return self._out

        raw = {"ok": False, "error": {
            "code": "supabase_error",
            "message": 'Supabase respondeu 400: column "segredo" of relation "health_users" does not exist',
            "status": 400,
        }}
        cases = [
            FakeProcess(json.dumps(raw).encode()),
            FakeProcess(b"nao-e-json", b"Traceback: /home/runner/workspace/backend/x.mjs linha 10"),
        ]
        for process in cases:
            with patch.object(main.asyncio, "create_subprocess_exec", AsyncMock(return_value=process)):
                with self.assertRaises(HTTPException) as captured:
                    await main.run_json_helper(
                        ["bun", "helper.mjs", "acao"], payload={}, timeout_seconds=5,
                        connector_name="Supabase",
                    )
            self.assertEqual(captured.exception.status_code, 502)
            self.assertNotIn("health_users", captured.exception.detail)
            self.assertNotIn("Traceback", captured.exception.detail)

    def test_api_docs_are_disabled_by_default(self) -> None:
        self.assertIsNone(main.app.openapi_url)
        self.assertIsNone(main.app.docs_url)

    def test_gemini_key_is_sent_in_header_not_in_url(self) -> None:
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"candidates": []}'
        with (
            patch.object(main, "GEMINI_API_KEY", "chave-secreta-teste"),
            patch.object(main.urllib.request, "urlopen", return_value=response) as urlopen,
        ):
            main.call_gemini_sync({"contents": []}, ["gemini-3.1-flash-lite"])

        request = urlopen.call_args.args[0]
        self.assertNotIn("chave-secreta-teste", request.full_url)
        self.assertNotIn("key=", request.full_url)
        self.assertEqual(request.get_header("X-goog-api-key"), "chave-secreta-teste")

    async def test_owner_registration_requires_administrative_activation(self) -> None:
        helper = AsyncMock()
        with (
            patch.dict(
                os.environ,
                {
                    "INVITED_EMAILS": "dono@exemplo.com",
                    "PRIMARY_OWNER_EMAIL": "dono@exemplo.com",
                    "COOKIE_SECURE": "false",
                },
            ),
            patch.object(main, "run_supabase_helper", new=helper),
        ):
            with self.assertRaises(HTTPException) as captured:
                await main.register_user(
                    main.CredentialsRequest(email="DONO@exemplo.com", password="senha-segura"),
                    Response(),
                )

        self.assertEqual(captured.exception.status_code, 403)
        helper.assert_not_awaited()


class SimulatedGeminiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.api_key = patch.object(main, "GEMINI_API_KEY", "test-key")
        self.api_key.start()
        self.addCleanup(self.api_key.stop)

    def test_photo_prompt_does_not_invent_ingredients_or_portions(self) -> None:
        prompt = main.gemini_prompt(
            None,
            1,
            context={"profile": {"clinical_profile": "hipertensão confirmada"}},
        )
        normalized_prompt = " ".join(prompt.split())

        self.assertIn("não deduza ingredientes de bebidas misturadas", normalized_prompt.lower())
        self.assertIn("não invente quantidades separadas", normalized_prompt.lower())
        self.assertIn("não dê sugestões alimentares específicas", normalized_prompt.lower())
        self.assertIn("contexto clínico confirmado", normalized_prompt)
        self.assertIn("não estime calorias", normalized_prompt)

    def test_exercise_prompt_extracts_only_displayed_facts_without_advice(self) -> None:
        prompt = " ".join(main.gemini_prompt("Caminhada no aplicativo", 1).split()).lower()

        self.assertIn("item.exercicio", prompt)
        self.assertIn("duracao_segundos", prompt)
        self.assertIn("ritmo_min_km", prompt)
        self.assertIn("não calcule ritmo, passos, calorias ou outros campos", prompt)
        self.assertIn("não gere feedback, avaliação de condicionamento", prompt)

    async def test_photo_exercise_details_survive_extraction_without_filling_missing_fields(self) -> None:
        response = gemini_response({
            "grupos": [{
                "evento_tipo": "exercicio",
                "data": "2026-09-30",
                "horario": None,
                "itens": [{
                    "item": "Caminhada",
                    "quantidade_estimada": "38 min",
                    "confirmado": True,
                    "exercicio": {
                        "inicio": "14:34",
                        "fim": "15:12",
                        "duracao_segundos": 2_296,
                        "intensidade": "Moderada",
                        "calorias_estimadas": 238,
                        "distancia_km": 3.29,
                        "passos": 4_387,
                        "pontos_cardio": 37,
                        "ritmo_min_km": "11:35/km",
                    },
                }],
            }],
        })
        with patch.object(main, "call_gemini_sync", return_value=response) as model_call:
            extracted = await main.analyze_with_gemini(
                main.ProcessInputRequest(text="Caminhada registrada no aplicativo"),
                context={"local_now": {"data": "2026-09-30", "horario": "19:00"}},
            )
        self.assertEqual(extracted["grupos"][0]["horario"], "14:34")
        self.assertEqual(extracted["grupos"][0]["data"], "2026-09-30")
        self.assertEqual(extracted["grupos"][0]["itens"][0]["quantidade_estimada"], "38 min")
        self.assertEqual(
            extracted["grupos"][0]["itens"][0]["exercicio"],
            {
                "inicio": "14:34",
                "fim": "15:12",
                "duracao_segundos": 2_296,
                "intensidade": "Moderada",
                "calorias_estimadas": 238.0,
                "distancia_km": 3.29,
                "passos": 4_387,
                "pontos_cardio": 37.0,
                "ritmo_min_km": "11:35/km",
            },
        )
        self.assertIn(
            "distancia_km",
            model_call.call_args.args[0]["generationConfig"]["responseSchema"]["properties"]["grupos"]
            ["items"]["properties"]["itens"]["items"]["properties"]["exercicio"]["properties"],
        )

    async def test_exercise_keeps_unknown_start_and_distance_missing(self) -> None:
        response = gemini_response({
            "grupos": [{
                "evento_tipo": "exercicio",
                "data": "2026-09-30",
                "horario": None,
                "itens": [{
                    "item": "Caminhada",
                    "quantidade_estimada": "não informado",
                    "confirmado": True,
                }],
            }],
        })
        with patch.object(main, "call_gemini_sync", return_value=response):
            extracted = await main.analyze_with_gemini(
                main.ProcessInputRequest(text="Caminhei"),
                context={"local_now": {"data": "2026-09-30", "horario": "19:00"}},
            )
        self.assertIsNone(extracted["grupos"][0]["horario"])
        self.assertEqual(extracted["grupos"][0]["data"], "2026-09-30")
        self.assertNotIn("exercicio", extracted["grupos"][0]["itens"][0])

    async def test_photo_meal_does_not_show_unverified_clinical_advice(self) -> None:
        response = gemini_response({
            "grupos": [
                {"evento_tipo": "alimentacao", "itens": [
                    {"item": "Vitamina", "quantidade_estimada": "não informado", "confirmado": True}
                ]}
            ],
            "resumo": "A vitamina contém açúcar e deve ser evitada por causa de resistência à insulina.",
        })
        with patch.object(main, "call_gemini_sync", return_value=response):
            result = await main.analyze_with_gemini(
                main.ProcessInputRequest(image_base64="aGVsbG8=", mime_type="image/png")
            )
        self.assertIn("visual preliminar", result["resumo"])
        self.assertNotIn("açúcar", result["resumo"])

    async def test_photo_does_not_repeat_an_identical_block_of_food(self) -> None:
        item_list = [
            {"item": "Pão", "quantidade_estimada": "1 unidade", "confirmado": True},
            {"item": "Café", "quantidade_estimada": "não informado", "confirmado": True},
        ]
        response = gemini_response({
            "grupos": [{"evento_tipo": "alimentacao", "itens": item_list + item_list}],
        })
        with patch.object(main, "call_gemini_sync", return_value=response):
            result = await main.analyze_with_gemini(
                main.ProcessInputRequest(image_base64="aGVsbG8=", mime_type="image/png")
            )
        self.assertEqual([item["item"] for item in result["grupos"][0]["itens"]], ["Pão", "Café"])

    async def test_accepts_valid_json_and_normalizes_items(self) -> None:
        response = gemini_response(
            {
                "grupos": [
                    {
                        "evento_tipo": "alimentacao",
                        "itens": [
                            {
                                "item": "  arroz  ",
                                "quantidade_estimada": " ",
                                "confirmado": True,
                            }
                        ],
                    }
                ]
            }
        )
        with patch.object(main, "call_gemini_sync", return_value=response) as mocked:
            result = await main.analyze_with_gemini(
                main.ProcessInputRequest(text="comi arroz")
            )

        mocked.assert_called_once()
        self.assertEqual(result["grupos"][0]["evento_tipo"], "alimentacao")
        self.assertEqual(result["grupos"][0]["itens"][0]["item"], "arroz")
        self.assertEqual(
            result["grupos"][0]["itens"][0]["quantidade_estimada"],
            "não informado",
        )
        self.assertRegex(result["grupos"][0]["horario"], r"^\d{2}:\d{2}$")

    async def test_keeps_analysis_when_gemini_summary_exceeds_limit(self) -> None:
        response = gemini_response(
            {
                "grupos": [
                    {
                        "evento_tipo": "sono",
                        "itens": [
                            {
                                "item": "sono profundo",
                                "quantidade_estimada": "2h09min",
                                "confirmado": True,
                            }
                        ],
                    }
                ],
                "resumo": "Resumo clínico detalhado " * 80,
            }
        )

        with patch.object(main, "call_gemini_sync", return_value=response):
            result = await main.analyze_with_gemini(
                main.ProcessInputRequest(
                    image_base64="aGVsbG8=",
                    mime_type="image/png",
                )
            )

        self.assertEqual(result["grupos"][0]["evento_tipo"], "sono")
        self.assertLessEqual(len(result["resumo"]), 1_000)
        self.assertTrue(result["resumo"].endswith("..."))

    async def test_uses_explicit_event_time_and_defaults_to_sao_paulo_time(self) -> None:
        response = gemini_response(
            {
                "grupos": [
                    {
                        "evento_tipo": "alimentacao",
                        "horario": "12:40",
                        "itens": [
                            {
                                "item": "almoço",
                                "quantidade_estimada": "1 porção",
                                "confirmado": True,
                            }
                        ],
                    },
                    {
                        "evento_tipo": "hidratacao",
                        "itens": [
                            {
                                "item": "água",
                                "quantidade_estimada": "300 ml",
                                "confirmado": True,
                            }
                        ],
                    },
                ]
            }
        )
        with patch.object(main, "call_gemini_sync", return_value=response):
            result = await main.analyze_with_gemini(
                main.ProcessInputRequest(text="almocei às 12:40 e bebi água"),
                context={"local_now": {"data": "2026-09-13", "horario": "14:25"}},
            )

        groups = {group["evento_tipo"]: group for group in result["grupos"]}
        self.assertEqual(groups["alimentacao"]["horario"], "12:40")
        self.assertEqual(groups["hidratacao"]["horario"], "14:25")
        self.assertEqual(groups["alimentacao"]["data"], "2026-09-13")
        self.assertEqual(groups["hidratacao"]["data"], "2026-09-13")

    async def test_preserves_previous_day_resolved_by_gemini(self) -> None:
        response = gemini_response(
            {
                "grupos": [
                    {
                        "evento_tipo": "hidratacao",
                        "data": "2026-09-12",
                        "itens": [
                            {
                                "item": "água",
                                "quantidade_estimada": "500 ml",
                                "confirmado": True,
                            }
                        ],
                    }
                ]
            }
        )
        with patch.object(main, "call_gemini_sync", return_value=response) as mocked:
            result = await main.analyze_with_gemini(
                main.ProcessInputRequest(text="ontem bebi 500 ml de água"),
                context={"local_now": {"data": "2026-09-13", "horario": "08:10"}},
            )

        prompt = mocked.call_args.args[0]["contents"][0]["parts"][0]["text"]
        self.assertIn("A data atual em São Paulo é\n2026-09-13", prompt)
        self.assertEqual(result["grupos"][0]["data"], "2026-09-12")

    async def test_uses_gemini_rest_field_names_for_images(self) -> None:
        response = gemini_response(
            {
                "grupos": [
                    {
                        "evento_tipo": "outro",
                        "itens": [
                            {
                                "item": "imagem",
                                "quantidade_estimada": "não informado",
                                "confirmado": True,
                            }
                        ],
                    }
                ]
            }
        )
        with patch.object(main, "call_gemini_sync", return_value=response) as mocked:
            await main.analyze_with_gemini(
                main.ProcessInputRequest(
                    image_base64="aGVsbG8=",
                    mime_type="image/png",
                )
            )

        payload = mocked.call_args.args[0]
        self.assertEqual(
            payload["contents"][0]["parts"][1],
            {
                "inlineData": {
                    "mimeType": "image/png",
                    "data": "aGVsbG8=",
                }
            },
        )

    async def test_sends_multiple_images_together_in_one_gemini_request(self) -> None:
        response = gemini_response(
            {
                "grupos": [
                    {
                        "evento_tipo": "alimentacao",
                        "itens": [
                            {
                                "item": "refeição combinada",
                                "quantidade_estimada": "não informado",
                                "confirmado": True,
                            }
                        ],
                    }
                ]
            }
        )
        with patch.object(main, "call_gemini_sync", return_value=response) as mocked:
            await main.analyze_with_gemini(
                main.ProcessInputRequest(
                    text="considere todas juntas",
                    images=[
                        main.ProcessImage(image_base64="aW1hZ2VtLTE=", mime_type="image/jpeg"),
                        main.ProcessImage(image_base64="aW1hZ2VtLTI=", mime_type="image/png"),
                    ],
                )
            )

        parts = mocked.call_args.args[0]["contents"][0]["parts"]
        self.assertEqual(len(parts), 3)
        self.assertIn("2 imagem(ns)", parts[0]["text"])
        self.assertEqual(
            parts[1:],
            [
                {
                    "inlineData": {
                        "mimeType": "image/jpeg",
                        "data": "aW1hZ2VtLTE=",
                    }
                },
                {
                    "inlineData": {
                        "mimeType": "image/png",
                        "data": "aW1hZ2VtLTI=",
                    }
                },
            ],
        )

    def test_limits_joint_analysis_to_six_images(self) -> None:
        with self.assertRaises(ValidationError):
            main.ProcessInputRequest(
                images=[
                    main.ProcessImage(image_base64="aGVsbG8=", mime_type="image/jpeg")
                    for _ in range(7)
                ]
            )

    async def test_preserves_sleep_phases_returned_by_gemini(self) -> None:
        response = gemini_response(
            {
                "grupos": [
                    {
                        "evento_tipo": "sono",
                        "itens": [
                            {
                                "item": "Sono total",
                                "quantidade_estimada": "7h 10min",
                                "confirmado": True,
                                "sono_profundo_min": "75 min",
                                "sono_leve_min": "250 min",
                                "sono_rem_min": "105 min",
                                "acordado_min": "20 min",
                            }
                        ],
                    }
                ]
            }
        )
        with patch.object(main, "call_gemini_sync", return_value=response):
            result = await main.analyze_with_gemini(
                main.ProcessInputRequest(text="dados do meu sono")
            )

        item = result["grupos"][0]["itens"][0]
        self.assertEqual(item["sono_profundo_min"], "75 min")
        self.assertEqual(item["sono_leve_min"], "250 min")
        self.assertEqual(item["sono_rem_min"], "105 min")
        self.assertEqual(item["acordado_min"], "20 min")

    async def test_keeps_mixed_food_and_hydration_in_separate_groups(self) -> None:
        response = gemini_response(
            {
                "grupos": [
                    {
                        "evento_tipo": "alimentacao",
                        "itens": [
                            {
                                "item": "arroz",
                                "quantidade_estimada": "1 porção",
                                "confirmado": True,
                            }
                        ],
                    },
                    {
                        "evento_tipo": "hidratacao",
                        "itens": [
                            {
                                "item": "água",
                                "quantidade_estimada": "500ml",
                                "confirmado": True,
                            }
                        ],
                    },
                ]
            }
        )
        with patch.object(main, "call_gemini_sync", return_value=response):
            result = await main.analyze_with_gemini(
                main.ProcessInputRequest(text="comi arroz e bebi 500ml de água")
            )

        groups = {group["evento_tipo"]: group["itens"] for group in result["grupos"]}
        self.assertEqual(set(groups), {"alimentacao", "hidratacao"})
        self.assertEqual([item["item"] for item in groups["alimentacao"]], ["arroz"])
        self.assertEqual([item["item"] for item in groups["hidratacao"]], ["água"])
        self.assertEqual(groups["hidratacao"][0]["quantidade_estimada"], "500ml")

    async def test_process_route_loads_only_authenticated_owner_context(self) -> None:
        context = {"profile": {"clinical_profile": "contexto privado"}}
        helper = AsyncMock(return_value=context)
        analyzer = AsyncMock(return_value={"grupos": []})
        with (
            patch.object(main, "run_supabase_helper", new=helper),
            patch.object(main, "analyze_with_gemini", new=analyzer),
        ):
            result = await main.process_input(
                main.ProcessInputRequest(text="dormi mal esta noite"),
                {"id": "owner-a"},
            )

        self.assertEqual(result, {"grupos": []})
        helper.assert_awaited_once_with("context", payload={"owner_id": "owner-a"})
        self.assertEqual(analyzer.await_args.kwargs["context"], context)

    async def test_exam_extraction_stays_pending_until_review(self) -> None:
        response = gemini_response(
            {
                "tipo_exame": "hemograma",
                "data_exame": "2026-08-28",
                "resumo": "Resultados transcritos para revisão.",
                "marcadores": [
                    {
                        "nome": "Hemoglobina",
                        "valor": "14,2",
                        "unidade": "g/dL",
                        "referencia": "13,0 a 17,0",
                    }
                ],
                "achados": [],
                "incertezas": [],
                "precisa_revisao": False,
            }
        )
        helper = AsyncMock(return_value={"ok": True, "exam": {"id": "exam-1", "status": "pending"}})
        with (
            patch.object(main, "call_gemini_sync", return_value=response),
            patch.object(main, "run_supabase_helper", new=helper),
        ):
            result = await main.analyze_health_exam(
                main.HealthExamUploadRequest(
                    file_name="hemograma.pdf",
                    mime_type="application/pdf",
                    file_base64="aGVsbG8=",
                ),
                "owner-a",
            )

        self.assertEqual(result["exam"]["status"], "pending")
        payload = helper.await_args.kwargs["payload"]
        self.assertEqual(payload["owner_id"], "owner-a")
        self.assertEqual(payload["exam_type"], "hemograma")
        self.assertEqual(payload["extracted_data"]["marcadores"][0]["valor"], "14,2")

    async def test_exam_dates_from_brazilian_reports_are_saved_as_iso(self) -> None:
        for reported, expected in (
            ("21/09/2026", "2026-09-21"),
            ("23/09/2026", "2026-09-23"),
        ):
            with self.subTest(reported=reported):
                helper = AsyncMock(
                    return_value={"ok": True, "exam": {"id": "exam-1", "status": "pending"}}
                )
                with (
                    patch.object(
                        main, "call_gemini_sync",
                        return_value=gemini_response({"data_exame": reported}),
                    ),
                    patch.object(main, "run_supabase_helper", new=helper),
                ):
                    await main.analyze_health_exam(
                        main.HealthExamUploadRequest(
                            file_name="exame.pdf",
                            mime_type="application/pdf",
                            file_base64="aGVsbG8=",
                        ),
                        "owner-a",
                    )
                payload = helper.await_args.kwargs["payload"]
                self.assertEqual(payload["exam_date"], expected)
                self.assertEqual(payload["extracted_data"]["data_exame"], expected)

    async def test_unrecognized_exam_date_stays_reviewable_without_database_error(self) -> None:
        helper = AsyncMock(
            return_value={"ok": True, "exam": {"id": "exam-1", "status": "pending"}}
        )
        with (
            patch.object(
                main, "call_gemini_sync",
                return_value=gemini_response({"data_exame": "31/02/2026"}),
            ),
            patch.object(main, "run_supabase_helper", new=helper),
        ):
            await main.analyze_health_exam(
                main.HealthExamUploadRequest(
                    file_name="exame.pdf", mime_type="application/pdf", file_base64="aGVsbG8="
                ),
                "owner-a",
            )
        payload = helper.await_args.kwargs["payload"]
        self.assertIsNone(payload["exam_date"])
        self.assertIsNone(payload["extracted_data"]["data_exame"])
        self.assertIn("31/02/2026", payload["uncertainties"][0])

    async def test_exam_review_derives_owner_from_session(self) -> None:
        helper = AsyncMock(return_value={"ok": True, "exam": {"id": "exam-1"}})
        body = main.HealthExamReviewRequest(
            exam_id="exam-1",
            status="confirmed",
            exam_type="hemograma",
            extracted_data={"marcadores": []},
        )
        with patch.object(main, "run_supabase_helper", new=helper):
            await main.review_health_exam(body, {"id": "owner-a"})

        self.assertEqual(helper.await_args.kwargs["payload"]["owner_id"], "owner-a")
        self.assertEqual(helper.await_args.kwargs["payload"]["status"], "confirmed")

    async def test_exam_review_accepts_brazilian_date_and_rejects_invalid_date(self) -> None:
        helper = AsyncMock(return_value={"ok": True, "exam": {"id": "exam-1"}})
        with patch.object(main, "run_supabase_helper", new=helper):
            await main.review_health_exam(
                main.HealthExamReviewRequest(
                    exam_id="exam-1",
                    status="confirmed",
                    exam_date="21/09/2026",
                    extracted_data={"data_exame": "21/09/2026"},
                ),
                {"id": "owner-a"},
            )
            self.assertEqual(helper.await_args.kwargs["payload"]["exam_date"], "2026-09-21")
            self.assertEqual(
                helper.await_args.kwargs["payload"]["extracted_data"]["data_exame"],
                "2026-09-21",
            )
            with self.assertRaisesRegex(HTTPException, "Data do exame inválida"):
                await main.review_health_exam(
                    main.HealthExamReviewRequest(
                        exam_id="exam-1", status="confirmed", exam_date="31/02/2026"
                    ),
                    {"id": "owner-a"},
                )
        helper.assert_awaited_once()

    async def test_sleep_review_routes_derive_owner_from_session(self) -> None:
        helper = AsyncMock(
            side_effect=[
                {"ok": True, "revisoes": []},
                {
                    "ok": True,
                    "corrected": True,
                    "replaced": 2,
                    "record_id": "20",
                },
            ]
        )
        with patch.object(main, "run_supabase_helper", new=helper):
            await main.sleep_reviews({"id": "owner-a"})
            await main.consolidate_sleep(
                main.SleepCorrectionRequest(record_ids=["11", "12"], total_sleep_min=420),
                {"id": "owner-a"},
            )

        self.assertEqual(
            helper.await_args_list[0].kwargs,
            {"payload": {"owner_id": "owner-a"}},
        )
        self.assertEqual(
            helper.await_args_list[1].kwargs["payload"],
            {
                "record_ids": ["11", "12"],
                "total_sleep_min": 420,
                "owner_id": "owner-a",
            },
        )

    async def test_ambiguous_image_escalates_without_losing_economy_result(self) -> None:
        economy = gemini_response(
            {
                "grupos": [
                    {
                        "evento_tipo": "alimentacao",
                        "itens": [
                            {
                                "item": "alimento visível",
                                "quantidade_estimada": "não informado",
                                "confirmado": True,
                            }
                        ],
                    }
                ],
                "precisa_revisao": True,
                "motivos_revisao": ["imagem borrada"],
            }
        )
        power = gemini_response(
            {
                "grupos": [
                    {
                        "evento_tipo": "alimentacao",
                        "itens": [
                            {
                                "item": "arroz",
                                "quantidade_estimada": "aprox. 3 colheres de sopa",
                                "confirmado": True,
                            }
                        ],
                    }
                ],
                "precisa_revisao": False,
                "motivos_revisao": [],
            }
        )
        with (
            patch.object(main, "GEMINI_POWER_MODEL", "power-model"),
            patch.object(main, "call_gemini_sync", side_effect=[economy, power]) as call,
        ):
            result = await main.analyze_with_gemini(
                main.ProcessInputRequest(
                    image_base64="aGVsbG8=",
                    mime_type="image/png",
                )
            )

        self.assertEqual(result["grupos"][0]["itens"][0]["item"], "arroz")
        self.assertEqual(call.call_count, 2)
        self.assertEqual(call.call_args_list[1].args[1], ["power-model"])

    async def test_maps_empty_gemini_response_to_safe_error(self) -> None:
        with patch.object(main, "call_gemini_sync", return_value={"candidates": []}):
            with self.assertRaisesRegex(HTTPException, "resposta vazia"):
                await main.analyze_with_gemini(main.ProcessInputRequest(text="comi arroz"))

    async def test_maps_non_object_provider_json_to_safe_error(self) -> None:
        for response in ([], "texto inesperado", None):
            with self.subTest(response=response):
                with patch.object(main, "call_gemini_sync", return_value=response):
                    with self.assertRaisesRegex(HTTPException, "resposta vazia"):
                        await main.analyze_with_gemini(
                            main.ProcessInputRequest(text="comi arroz")
                        )

    async def test_maps_invalid_json_to_safe_error(self) -> None:
        with patch.object(
            main,
            "call_gemini_sync",
            return_value=gemini_response("não é um objeto"),
        ):
            with self.assertRaisesRegex(HTTPException, "fora do formato esperado"):
                await main.analyze_with_gemini(main.ProcessInputRequest(text="comi arroz"))

    async def test_maps_invalid_event_type_to_safe_error(self) -> None:
        with patch.object(
            main,
            "call_gemini_sync",
            return_value=gemini_response(
                {
                    "grupos": [
                        {
                            "evento_tipo": "tipo-inexistente",
                            "itens": [{"item": "algo", "quantidade_estimada": "1"}],
                        }
                    ]
                }
            ),
        ):
            with self.assertRaisesRegex(HTTPException, "tipo de registro inválido"):
                await main.analyze_with_gemini(main.ProcessInputRequest(text="algo"))

    def test_maps_gemini_invalid_credential_to_safe_error(self) -> None:
        with patch.object(main.urllib.request, "urlopen", side_effect=http_error(401)):
            with self.assertRaisesRegex(HTTPException, "credencial do Gemini"):
                main.call_gemini_sync({})

    def test_retries_temporary_429_then_returns_safe_error(self) -> None:
        with (
            patch.object(main.urllib.request, "urlopen", side_effect=http_error(429)) as urlopen,
            patch.object(main.time, "sleep") as sleep,
        ):
            with self.assertRaisesRegex(HTTPException, "limite temporário"):
                main.call_gemini_sync({})

        self.assertEqual(urlopen.call_count, len(main.gemini_model_candidates()) + 2)
        self.assertEqual(sleep.call_count, 2)

    def test_falls_back_when_primary_model_quota_is_exceeded(self) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"ok": true}'
        quota_body = b'{"error":{"message":"You exceeded your current quota"}}'
        with (
            patch.object(main, "GEMINI_MODEL", "primary-model"),
            patch.object(main, "GEMINI_FALLBACK_MODEL", "fallback-model"),
            patch.object(
                main.urllib.request,
                "urlopen",
                side_effect=[http_error(429, quota_body), response],
            ) as urlopen,
        ):
            result = main.call_gemini_sync({})

        self.assertEqual(result, {"ok": True})
        self.assertEqual(urlopen.call_count, 2)
        self.assertIn("fallback-model:generateContent", urlopen.call_args_list[1].args[0].full_url)

    def test_retries_temporary_503_then_returns_safe_error(self) -> None:
        with (
            patch.object(main, "GEMINI_FALLBACK_MODEL", ""),
            patch.object(main, "GEMINI_FALLBACK_MODELS", ()),
            patch.object(main, "GEMINI_POWER_MODEL", ""),
            patch.object(main.urllib.request, "urlopen", side_effect=http_error(503)) as urlopen,
            patch.object(main.time, "sleep"),
        ):
            with self.assertRaisesRegex(HTTPException, "temporariamente sobrecarregado"):
                main.call_gemini_sync({})

        self.assertEqual(urlopen.call_count, 3)

    def test_falls_back_immediately_when_primary_model_is_overloaded(self) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"ok": true}'
        with (
            patch.object(main, "GEMINI_MODEL", "primary-model"),
            patch.object(main, "GEMINI_FALLBACK_MODEL", "fallback-model"),
            patch.object(main, "GEMINI_POWER_MODEL", ""),
            patch.object(
                main.urllib.request,
                "urlopen",
                side_effect=[
                    http_error(503),
                    response,
                ],
            ) as urlopen,
            patch.object(main.time, "sleep"),
        ):
            result = main.call_gemini_sync({})

        self.assertEqual(result, {"ok": True})
        self.assertEqual(urlopen.call_count, 2)
        self.assertIn("fallback-model:generateContent", urlopen.call_args_list[-1].args[0].full_url)

    def test_uses_shorter_timeout_for_text_than_images(self) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"ok": true}'

        with patch.object(main.urllib.request, "urlopen", return_value=response) as urlopen:
            main.call_gemini_sync({"contents": [{"parts": [{"text": "peso 93,7"}]}]})
            main.call_gemini_sync(
                {"contents": [{"parts": [{"inlineData": {"data": "aGVsbG8="}}]}]}
            )

        self.assertEqual(urlopen.call_args_list[0].kwargs["timeout"], 30)
        self.assertEqual(urlopen.call_args_list[1].kwargs["timeout"], 60)

    def test_flash_fallback_uses_minimal_thinking_and_does_not_mutate_request(self) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"ok": true}'
        payload = {"generationConfig": {"responseMimeType": "application/json"}}
        with patch.object(main.urllib.request, "urlopen", return_value=response) as urlopen:
            main.call_gemini_sync(payload, ["gemini-3-flash-preview"])
        body = json.loads(urlopen.call_args.args[0].data)
        self.assertEqual(body["generationConfig"]["thinkingConfig"], {"thinkingLevel": "minimal"})
        self.assertNotIn("thinkingConfig", payload["generationConfig"])

    def test_custom_models_and_timeout_override_are_preserved(self) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"ok": true}'
        with (
            patch.object(main, "GEMINI_TIMEOUT_SECONDS", 12),
            patch.object(main.urllib.request, "urlopen", return_value=response) as urlopen,
        ):
            main.call_gemini_sync({}, ["custom-model"])
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 12)
        body = json.loads(urlopen.call_args.args[0].data)
        self.assertNotIn("thinkingConfig", body["generationConfig"])

    def test_maps_timeout_to_safe_error(self) -> None:
        with patch.object(
            main.urllib.request,
            "urlopen",
            side_effect=TimeoutError("simulated timeout"),
        ):
            with self.assertRaisesRegex(HTTPException, "demorou demais"):
                main.call_gemini_sync({})

    def test_maps_invalid_provider_json_to_safe_error(self) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b"{invalid"
        with patch.object(main.urllib.request, "urlopen", return_value=response):
            with self.assertRaisesRegex(HTTPException, "resposta inválida"):
                main.call_gemini_sync({})

    def test_extracts_json_from_markdown_fence(self) -> None:
        response = gemini_response({"grupos": []})
        response["candidates"][0]["content"]["parts"][0]["text"] = (
            "```json\n{\"grupos\": []}\n```"
        )
        self.assertEqual(main.extract_gemini_text(response), '{"grupos": []}')


if __name__ == "__main__":
    unittest.main()
