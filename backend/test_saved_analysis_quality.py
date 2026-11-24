import json
import unittest
from unittest.mock import patch

from backend import main
from backend.test_main import gemini_response


def fictional_context():
    return {
        "para_dia": "2026-10-05",
        "perfil_clinico": "Pessoa adulta, hipertensão informada, quer melhorar hábitos de sono.",
        "instrucoes_do_gem": "Explique a prioridade principal e proponha uma ação para hoje.",
        "exames_confirmados_recentes": [{
            "exam_type": "Laboratorial", "exam_date": "2026-08-01",
            "status": "confirmed", "extracted_data": {"LDL": "140 mg/dL"},
        }],
        "confirmados": [
            {"tipo": "peso", "registros": [{"data": "2026-10-05", "valor_kg": 72.4}]},
            {"tipo": "sono", "registros": [{
                "data": "2026-10-05", "duracao_minutos": 368,
                "sono_profundo_min": 87, "sono_leve_min": 192,
                "sono_rem_min": 89, "acordado_min": 4,
            }]},
        ],
        "resumo": {"dias": [
            {"data": "2026-10-04", "peso_kg": 72.4, "sono_min": 390},
        ]},
        "registros_do_dia": {"data": "2026-10-05", "registros": {}},
    }


class SavedAnalysisQualityTests(unittest.IsolatedAsyncioTestCase):
    async def test_quality_request_uses_clinical_context_preferences_and_more_reasoning(self):
        context = fictional_context()
        expected = (
            "Leitura do registro: o sono foi curto para um adulto.\n\n"
            "No seu contexto: priorize a regularidade do descanso.\n\n"
            "Próximo passo: reserve mais tempo para dormir nesta noite."
        )
        with patch.object(main, "GEMINI_API_KEY", "test-only"), \
                patch.object(main, "call_gemini_sync", return_value=gemini_response({
                    "analysis": expected,
                })) as model:
            self.assertEqual(await main.generate_saved_record_analysis(context), expected)
        payload = model.call_args.args[0]
        prompt = payload["contents"][0]["parts"][0]["text"]
        self.assertIn(json.dumps(context, ensure_ascii=False), prompt)
        self.assertIn("siga seus objetivos, prioridades e estilo", prompt)
        self.assertIn("não trate um exame antigo como resultado atual", prompt)
        self.assertIn("Não se limite a transcrever os números", prompt)
        self.assertIn("referência geral de 7–9 horas", prompt)
        self.assertIn("sem chamar estabilidade de progresso", prompt)
        self.assertIn("As fases de wearables são estimativas", prompt)
        self.assertIn("não os conte nem some duas vezes", prompt)
        self.assertNotIn("Use no máximo dois parágrafos", prompt)
        self.assertEqual(payload["generationConfig"]["thinkingConfig"], {"thinkingLevel": "low"})
        self.assertEqual(model.call_args.args[1][0], main.GEMINI_ANALYSIS_MODEL)
        self.assertEqual(len(model.call_args.args[1]), len(set(model.call_args.args[1])))
        self.assertIn("não comprova estabilidade hídrica", prompt)
        self.assertIn("uma única noite", prompt)

    def test_custom_models_do_not_receive_gemini3_only_thinking_parameters(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def read(self):
                return b'{"candidates":[]}'

        payload = {"contents": [], "generationConfig": {"thinkingConfig": {"thinkingLevel": "low"}}}
        with patch.object(main.urllib.request, "urlopen", return_value=Response()) as urlopen:
            main.call_gemini_sync(payload, ["gemini-2.5-flash"])
        sent = json.loads(urlopen.call_args.args[0].data)
        self.assertNotIn("thinkingConfig", sent["generationConfig"])
        self.assertEqual(urlopen.call_args.kwargs["timeout"], min(main.GEMINI_TIMEOUT_SECONDS, 60))
        self.assertIn("thinkingConfig", payload["generationConfig"])
