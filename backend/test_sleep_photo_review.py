import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend import main
from backend.sleep_photo_review import missing_sleep_phases, merge_missing_sleep_phases, merge_sleep_readings


class SleepLevelTests(unittest.TestCase):
    def test_source_levels_are_merged_without_inferring_missing_grades(self):
        groups = main.GeminiPayload.model_validate(extraction(complete=True)).grupos
        merge_sleep_readings(groups, {"leituras": [{
            "sessao_id": "sono:0:0", "total_minutos": 480,
            "sono_niveis": {"profundo": "alto", "leve": "normal", "rem": "baixo"},
        }]})
        levels = groups[0].itens[0].sono_niveis
        self.assertEqual(levels.profundo, "alto")
        self.assertEqual(levels.leve, "normal")
        self.assertEqual(levels.rem, "baixo")
        self.assertIsNone(levels.acordado)

    def test_invalid_source_label_is_not_stored_as_normal(self):
        groups = main.GeminiPayload.model_validate(extraction(complete=True)).grupos
        merge_sleep_readings(groups, {"leituras": [{
            "sessao_id": "sono:0:0", "total_minutos": 480,
            "sono_niveis": {"profundo": "desconhecido"},
        }]})
        self.assertIsNone(groups[0].itens[0].sono_niveis.profundo)


def extraction(*, complete=False, date="2026-09-01"):
    return {
        "grupos": [{
            "evento_tipo": "sono", "data": date, "horario": None,
            "itens": [{
                "item": "Sono total", "quantidade_estimada": "480 min",
                "sono_profundo_min": "60 min", "sono_rem_min": "150 min",
                "sono_leve_min": "270 min" if complete else None,
                "acordado_min": "0 min" if complete else None,
            }],
        }],
    }


def response(payload):
    import json
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}

def readings(payload):
    return {"leituras": [
        {"sessao_id": f"sono:{group_index}:{item_index}", "total_minutos": 480,
         "data_imagem": group.get("data"),
         **{key: item.get(key) for key in ("sono_profundo_min", "sono_leve_min", "sono_rem_min", "acordado_min")}}
        for group_index, group in enumerate(payload["grupos"]) if group["evento_tipo"] == "sono"
        for item_index, item in enumerate(group["itens"])
    ]}

class SleepPhotoReviewTests(unittest.IsolatedAsyncioTestCase):
    async def analyze(self, initial, second=None, *, photo=True):
        calls = [response(initial)]
        if photo and second is None and any(group["evento_tipo"] == "sono" for group in initial["grupos"]):
            second = readings(initial)
        if second is not None:
            calls.append(second if isinstance(second, Exception) else response(
                readings(second) if "grupos" in second else second,
            ))
        with (
            patch.object(main, "GEMINI_API_KEY", "test-only"),
            patch.object(main, "GEMINI_POWER_MODEL", main.GEMINI_MODEL),
            patch.object(main, "call_gemini_sync", side_effect=calls) as model,
        ):
            request = main.ProcessInputRequest(
                image_base64="aGVsbG8=", mime_type="image/png",
            ) if photo else main.ProcessInputRequest(text="Dormi oito horas")
            result = await main.analyze_with_gemini(request)
        return result, model

    async def test_missing_phases_trigger_one_second_reading_of_same_images(self):
        result, model = await self.analyze(extraction(), extraction(complete=True))
        self.assertEqual(model.call_count, 2)
        self.assertEqual(
            model.call_args_list[0].args[0]["contents"][0]["parts"][1:],
            model.call_args_list[1].args[0]["contents"][0]["parts"][1:],
        )
        item = result["grupos"][0]["itens"][0]
        self.assertEqual(item["sono_leve_min"], "270 min")
        self.assertEqual(item["acordado_min"], "0 min")
        self.assertEqual(item["quantidade_estimada"], "480 min")
        self.assertNotIn("avisos_extracao", result)
        self.assertIn("leituras", model.call_args_list[1].args[0]["generationConfig"]["responseSchema"]["properties"])

    async def test_sleep_table_refinement_is_not_a_rewritten_health_group(self):
        result, model = await self.analyze(extraction(), {"leituras": [{
            "sessao_id": "sono:0:0", "total_minutos": 480,
            "sono_profundo_min": "1hr", "sono_leve_min": "4hr30min",
            "sono_rem_min": "2hr30min", "acordado_min": "05min",
        }]})
        item = result["grupos"][0]["itens"][0]
        self.assertEqual(item["sono_leve_min"], "270 min")
        self.assertEqual(item["acordado_min"], "5 min")
        self.assertEqual(item["item"], "Sono total")
        self.assertEqual(item["quantidade_estimada"], "480 min")
        self.assertEqual(result["grupos"][0]["data"], "2026-09-01")

    def test_refinement_requires_unique_session_and_matching_total(self):
        for sid, total in [("sono:3:0", 480), ("sono:0:0", 420)]:
            candidate = main.GeminiPayload.model_validate(extraction())
            merge_sleep_readings(candidate.grupos, {"leituras": [{
                "sessao_id": sid, "total_minutos": total, "sono_leve_min": "270 min",
            }]})
            self.assertIsNone(candidate.grupos[0].itens[0].sono_leve_min)

    async def test_complete_photo_still_checks_image_date(self):
        result, model = await self.analyze(extraction(complete=True))
        self.assertEqual(model.call_count, 2)
        self.assertEqual(result["grupos"][0]["data_imagem"], "2026-09-01")
        self.assertNotIn("avisos_extracao", result)

    async def test_text_does_not_infer_or_recheck_missing_phases(self):
        result, model = await self.analyze(extraction(), photo=False)
        self.assertEqual(model.call_count, 1)
        self.assertIsNone(result["grupos"][0]["itens"][0]["sono_leve_min"])
        self.assertNotIn("avisos_extracao", result)

    async def test_image_date_overrides_upload_date_and_preserves_known_measurements(self):
        initial = extraction(complete=True)
        initial["grupos"][0]["data"] = "2026-10-12"
        result, _ = await self.analyze(initial, {"leituras": [{
            "sessao_id": "sono:0:0", "total_minutos": 480, "data_imagem": "2026-10-11",
            "sono_profundo_min": "999 min", "sono_leve_min": "270 min",
            "sono_rem_min": "150 min", "acordado_min": "5 min",
        }]})
        self.assertEqual(result["grupos"][0]["data"], "2026-10-11")
        self.assertEqual(result["grupos"][0]["data_imagem"], "2026-10-11")
        self.assertEqual(result["grupos"][0]["itens"][0]["sono_profundo_min"], "60 min")

    async def test_still_missing_phases_are_left_empty_with_warning(self):
        result, model = await self.analyze(extraction(), extraction())
        self.assertEqual(model.call_count, 2)
        item = result["grupos"][0]["itens"][0]
        self.assertIsNone(item["sono_leve_min"])
        self.assertIsNone(item["acordado_min"])
        self.assertIn("sono leve", result["avisos_extracao"][0])
        self.assertIn("não foram calculados", result["avisos_extracao"][0])

    async def test_failed_refinement_keeps_original_and_warns(self):
        result, model = await self.analyze(extraction(), HTTPException(503, "unavailable"))
        self.assertEqual(model.call_count, 2)
        self.assertEqual(result["grupos"][0]["itens"][0]["sono_profundo_min"], "60 min")
        self.assertIn("avisos_extracao", result)

    def test_merge_does_not_overwrite_known_values_or_other_records(self):
        original = main.GeminiPayload.model_validate(extraction())
        original.grupos.append(main.GeminiGroup(
            evento_tipo="peso", itens=[main.GeminiItem(item="Peso", quantidade_estimada="70 kg")],
        ))
        refined = main.GeminiPayload.model_validate(extraction(complete=True))
        refined.grupos[0].itens[0].sono_profundo_min = "300 min"
        merge_missing_sleep_phases(original.grupos, refined.grupos)
        self.assertEqual(original.grupos[0].itens[0].sono_profundo_min, "60 min")
        self.assertEqual(original.grupos[0].itens[0].sono_leve_min, "270 min")
        self.assertEqual(original.grupos[1].itens[0].quantidade_estimada, "70 kg")

    def test_different_session_is_not_used_to_fill_missing_measurements(self):
        original = main.GeminiPayload.model_validate(extraction())
        refined = main.GeminiPayload.model_validate(extraction(complete=True, date="2026-09-02"))
        merge_missing_sleep_phases(original.grupos, refined.grupos)
        self.assertIsNone(original.grupos[0].itens[0].sono_leve_min)

    def test_equivalent_total_format_matches_without_rewriting_original_total(self):
        original = main.GeminiPayload.model_validate(extraction())
        for total in ("8h 00min", "8hr", "08:00"):
            with self.subTest(total=total):
                refined = main.GeminiPayload.model_validate(extraction(complete=True))
                refined.grupos[0].itens[0].quantidade_estimada = total
                candidate = original.model_copy(deep=True)
                merge_missing_sleep_phases(candidate.grupos, refined.grupos)
                self.assertEqual(candidate.grupos[0].itens[0].sono_leve_min, "270 min")
                self.assertEqual(candidate.grupos[0].itens[0].quantidade_estimada, "480 min")

    def test_placeholder_is_missing_but_zero_is_a_measurement(self):
        original = main.GeminiPayload.model_validate(extraction(complete=True))
        self.assertEqual(missing_sleep_phases(original.grupos), [])
        original.grupos[0].itens[0].sono_leve_min = "não informado"
        self.assertEqual(missing_sleep_phases(original.grupos)[0]["campos_ausentes"], ["sono_leve_min"])

    def test_prompt_requires_full_table_and_awake_alias_without_inference(self):
        prompt = main.gemini_prompt(None, 1)
        self.assertIn("tabela de dados abaixo", prompt)
        self.assertIn('"Despertar"', prompt)
        self.assertIn("nunca calcule uma", prompt)
