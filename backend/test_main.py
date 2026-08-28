import base64
import io
import json
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pydantic import ValidationError

import backend.main as main


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


def http_error(status: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        "https://generativelanguage.googleapis.com",
        status,
        "simulated Gemini error",
        {},
        io.BytesIO(b'{"error":{"message":"simulated"}}'),
    )


class InputValidationTests(unittest.IsolatedAsyncioTestCase):
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


class SimulatedGeminiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.api_key = patch.object(main, "GEMINI_API_KEY", "test-key")
        self.api_key.start()
        self.addCleanup(self.api_key.stop)

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

        self.assertEqual(urlopen.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_retries_temporary_503_then_returns_safe_error(self) -> None:
        with (
            patch.object(main.urllib.request, "urlopen", side_effect=http_error(503)) as urlopen,
            patch.object(main.time, "sleep"),
        ):
            with self.assertRaisesRegex(HTTPException, "temporariamente sobrecarregado"):
                main.call_gemini_sync({})

        self.assertEqual(urlopen.call_count, 3)

    def test_maps_timeout_to_safe_error(self) -> None:
        with patch.object(
            main.urllib.request,
            "urlopen",
            side_effect=TimeoutError("simulated timeout"),
        ):
            with self.assertRaisesRegex(HTTPException, "comunicar com o Gemini"):
                main.call_gemini_sync({})

    def test_maps_invalid_provider_json_to_safe_error(self) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b"{invalid"
        with patch.object(main.urllib.request, "urlopen", return_value=response):
            with self.assertRaisesRegex(HTTPException, "comunicar com o Gemini"):
                main.call_gemini_sync({})

    def test_extracts_json_from_markdown_fence(self) -> None:
        response = gemini_response({"grupos": []})
        response["candidates"][0]["content"]["parts"][0]["text"] = (
            "```json\n{\"grupos\": []}\n```"
        )
        self.assertEqual(main.extract_gemini_text(response), '{"grupos": []}')


if __name__ == "__main__":
    unittest.main()