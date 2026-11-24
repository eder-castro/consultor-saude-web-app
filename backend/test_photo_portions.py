import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend import main
from backend.photo_portions import has_concrete_portion
from backend.test_main import gemini_response


def meal_response(quantities):
    return gemini_response({
        "grupos": [{"evento_tipo": "alimentacao", "itens": [
            {"item": name, "quantidade_estimada": quantity, "confirmado": False}
            for name, quantity in quantities
        ]}],
    })


class PhotoPortionTests(unittest.IsolatedAsyncioTestCase):
    def test_concrete_quantities_and_generic_placeholders(self):
        for quantity in [
            "aprox. 3 colheres de sopa", "cerca de 1 concha", "2 folhas",
            "cerca de 80–120 g", "aprox. 1/2 xícara", "150g", "1 a 2 fatias",
        ]:
            with self.subTest(quantity=quantity):
                self.assertTrue(has_concrete_portion(quantity))
        for quantity in [
            "porção visualmente estimada", "quantidade aproximada",
            "1 porção", "porção média", "", "100",
        ]:
            with self.subTest(quantity=quantity):
                self.assertFalse(has_concrete_portion(quantity))

    async def test_photo_reassesses_generic_portions_using_original_images(self):
        initial = meal_response([
            ("Feijão", "porção visualmente estimada"),
            ("Carne", "porção visualmente estimada"),
            ("Alface", "porção visualmente estimada"),
        ])
        refined = meal_response([
            ("Feijão", "aprox. 1 concha"),
            ("Carne", "cerca de 80–120 g"),
            ("Alface", "aprox. 2 folhas"),
        ])
        with patch.object(main, "GEMINI_API_KEY", "test-only"), \
                patch.object(main, "call_gemini_sync", side_effect=[initial, refined]) as model:
            result = await main.analyze_with_gemini(
                main.ProcessInputRequest(image_base64="aGVsbG8=", mime_type="image/png"),
            )
        self.assertEqual(model.call_count, 2)
        requests = [call.args[0] for call in model.call_args_list]
        self.assertEqual(requests[0]["contents"][0], requests[1]["contents"][0])
        self.assertIn("Feijão", requests[1]["contents"][-1]["parts"][0]["text"])
        self.assertEqual(
            [item["quantidade_estimada"] for item in result["grupos"][0]["itens"]],
            ["aprox. 1 concha", "cerca de 80–120 g", "aprox. 2 folhas"],
        )
        self.assertTrue(all(not item["confirmado"] for item in result["grupos"][0]["itens"]))

    async def test_repeated_placeholder_fails_without_inventing_quantities(self):
        response = meal_response([("Feijão", "porção visualmente estimada")])
        with patch.object(main, "GEMINI_API_KEY", "test-only"), \
                patch.object(main, "call_gemini_sync", return_value=response) as model:
            with self.assertRaises(HTTPException) as caught:
                await main.analyze_with_gemini(
                    main.ProcessInputRequest(image_base64="aGVsbG8=", mime_type="image/png"),
                )
        self.assertEqual(model.call_count, 2)
        self.assertEqual(caught.exception.status_code, 502)

    async def test_concrete_photo_portions_do_not_need_an_extra_request(self):
        with patch.object(main, "GEMINI_API_KEY", "test-only"), \
                patch.object(main, "call_gemini_sync", return_value=meal_response([
                    ("Arroz", "aprox. 3 colheres de sopa"),
                ])) as model:
            await main.analyze_with_gemini(
                main.ProcessInputRequest(image_base64="aGVsbG8=", mime_type="image/png"),
            )
        model.assert_called_once()

    async def test_text_quantity_is_preserved_without_photo_estimation(self):
        with patch.object(main, "GEMINI_API_KEY", "test-only"), \
                patch.object(main, "call_gemini_sync", return_value=meal_response([
                    ("Arroz", "1 porção"),
                ])) as model:
            result = await main.analyze_with_gemini(main.ProcessInputRequest(text="Comi 1 porção de arroz"))
        model.assert_called_once()
        self.assertEqual(result["grupos"][0]["itens"][0]["quantidade_estimada"], "1 porção")

    async def test_unobservable_quantity_is_not_replaced_with_a_fixed_portion(self):
        with patch.object(main, "GEMINI_API_KEY", "test-only"), \
                patch.object(main, "call_gemini_sync", return_value=meal_response([
                    ("Bebida", "não informado"),
                ])) as model:
            result = await main.analyze_with_gemini(
                main.ProcessInputRequest(image_base64="aGVsbG8=", mime_type="image/png"),
            )
        model.assert_called_once()
        self.assertEqual(result["grupos"][0]["itens"][0]["quantidade_estimada"], "não informado")

    def test_prompt_requires_individual_estimates_not_generic_disclaimers(self):
        prompt = main.gemini_prompt(None, 1)
        self.assertIn("NÚMERO e uma UNIDADE ou MEDIDA CASEIRA", prompt)
        self.assertIn("nunca copie uma quantidade fixa", prompt)
        self.assertIn("não são porções padrão", prompt)