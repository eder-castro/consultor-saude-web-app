import unittest
from backend.main import GeminiPayload, gemini_prompt


class ExerciseExtractionTests(unittest.TestCase):
    def test_overflowing_provider_pace_is_preserved_without_losing_the_activity(self):
        raw = "11:20/km (média), " + "1km: 11:44; 2km: 10:32; 3km: 11:01; " * 6 + "calorias:275, distancia_km:3.65"
        payload = {"grupos": [{"evento_tipo": "exercicio", "data": "2026-10-20",
            "itens": [{"item": "Caminhada", "exercicio": {
                "inicio": "17:12", "fim": "17:53", "duracao_segundos": 2481,
                "distancia_km": 3.65, "passos": 4895, "ritmo_min_km": raw,
            }}]}]}
        details = GeminiPayload.model_validate(payload).grupos[0].itens[0].exercicio
        self.assertEqual(details.ritmo_min_km, "11:20/km (média)")
        self.assertEqual(details.ritmos_parciais, raw)
        self.assertEqual(details.passos, 4895)
        self.assertEqual(details.duracao_segundos, 2481)
        self.assertEqual(payload["grupos"][0]["itens"][0]["exercicio"]["ritmo_min_km"], raw)

    def test_long_pace_without_explicit_mean_is_not_guessed(self):
        raw = "1km: 11:44; 2km: 10:32; " * 10
        payload = {"grupos": [{"evento_tipo": "exercicio", "itens": [{
            "item": "Caminhada", "exercicio": {"ritmo_min_km": raw, "ritmos_parciais": "Fonte original"},
        }]}]}
        details = GeminiPayload.model_validate(payload).grupos[0].itens[0].exercicio
        self.assertIsNone(details.ritmo_min_km)
        self.assertEqual(details.ritmos_parciais, "Fonte original\n" + raw)

    def test_prompt_preserves_source_times_even_when_duration_disagrees(self):
        prompt = gemini_prompt("Teve caminhada", 2)
        self.assertIn("nunca subtraia a duração do fim", prompt)
        self.assertIn("ritmos_parciais", prompt)
