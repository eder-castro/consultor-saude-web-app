import base64
import io
import json
import os
import unittest
import urllib.error
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException, Response
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