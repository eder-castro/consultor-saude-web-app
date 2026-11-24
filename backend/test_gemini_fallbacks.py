import io
import json
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from backend import main


def failure(code):
    return urllib.error.HTTPError(
        "https://provider.invalid", code, "unavailable", {},
        io.BytesIO(b'{"error":{"message":"unavailable"}}'),
    )


def success():
    response = MagicMock()
    response.__enter__.return_value = response
    response.read.return_value = b'{"ok": true}'
    return response


class GeminiFallbackTests(unittest.TestCase):
    def setUp(self):
        for name, value in {
            "GEMINI_MODEL": "primary",
            "GEMINI_POWER_MODEL": "primary",
            "GEMINI_FALLBACK_MODEL": "reserve-1",
            "GEMINI_FALLBACK_MODELS": ("reserve-1", "reserve-2", "reserve-3"),
        }.items():
            patcher = patch.object(main, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_three_distinct_reserves_without_duplicate_calls(self):
        self.assertEqual(main.gemini_model_candidates(),
                         ["primary", "reserve-1", "reserve-2", "reserve-3"])

    def test_explicit_priorities_still_include_all_reserves_for_every_stage(self):
        for preferred in (["analysis", "primary"], ["power"], ["review", "primary", "reserve-1"]):
            candidates = main.gemini_model_candidates(preferred)
            self.assertEqual(candidates[0], preferred[0])
            self.assertEqual(len(candidates), len(set(candidates)))
            self.assertTrue({"reserve-1", "reserve-2", "reserve-3"} <= set(candidates))

    def test_primary_and_first_two_reserves_fail_then_third_recovers(self):
        with (
            patch.object(main.urllib.request, "urlopen", side_effect=[
                failure(503), failure(429), failure(500), success(),
            ]) as request,
            patch.object(main.time, "sleep") as sleep,
        ):
            self.assertEqual(main.call_gemini_sync({}), {"ok": True})
        self.assertEqual(request.call_count, 4)
        self.assertFalse(sleep.called)
        called = [call.args[0].full_url.split("/models/")[1].split(":")[0]
                  for call in request.call_args_list]
        self.assertEqual(called, ["primary", "reserve-1", "reserve-2", "reserve-3"])

    def test_transient_or_retired_model_errors_reach_next_reserve(self):
        for code in (429, 500, 502, 503, 504, 404, 410):
            with self.subTest(code=code), patch.object(
                main.urllib.request, "urlopen", side_effect=[failure(code), success()],
            ) as request:
                self.assertEqual(main.call_gemini_sync({}), {"ok": True})
                self.assertEqual(request.call_count, 2)

    def test_network_timeouts_can_recover_on_third_reserve(self):
        with patch.object(main.urllib.request, "urlopen", side_effect=[
            TimeoutError(), urllib.error.URLError("network"), TimeoutError(), success(),
        ]) as request:
            self.assertEqual(main.call_gemini_sync({}), {"ok": True})
        self.assertEqual(request.call_count, 4)

    def test_all_reserves_exhausted_return_an_explicit_failure(self):
        def unavailable(*args, **kwargs):
            raise failure(503)
        with (
            patch.object(main.urllib.request, "urlopen", side_effect=unavailable) as request,
            patch.object(main.time, "sleep") as sleep,
        ):
            with self.assertRaises(HTTPException) as error:
                main.call_gemini_sync({})
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(request.call_count, 6)
        self.assertEqual(sleep.call_count, 2)

    def test_auth_or_payload_errors_do_not_get_hidden_by_fallback(self):
        for code in (400, 401, 403):
            with self.subTest(code=code), patch.object(
                main.urllib.request, "urlopen", side_effect=failure(code),
            ) as request:
                with self.assertRaises(HTTPException):
                    main.call_gemini_sync({})
                self.assertEqual(request.call_count, 1)

    def test_supported_new_flash_reserves_get_minimal_thinking(self):
        for model in ("gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.5-flash"):
            with self.subTest(model=model), patch.object(
                main.urllib.request, "urlopen", return_value=success(),
            ) as request:
                main.call_gemini_sync({}, [model])
                body = json.loads(request.call_args.args[0].data)
                self.assertEqual(body["generationConfig"]["thinkingConfig"], {"thinkingLevel": "minimal"})

    def test_weight_endpoint_defaults_to_week_and_sends_authenticated_owner(self):
        import asyncio
        from datetime import date
        from unittest.mock import AsyncMock
        with patch.object(main, "run_supabase_helper", new_callable=AsyncMock) as helper:
            asyncio.run(main.weight_history({"id": "owner"}, date(2026, 10, 22)))
        helper.assert_awaited_once_with("weight-history", payload={
            "owner_id": "owner", "data": "2026-10-22", "periodo": "semana",
        })
