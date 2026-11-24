import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from backend import main, storage_requests


class StorageRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_photo_context_busy_queues_for_retry_without_analyzing_or_saving(self):
        helper = AsyncMock(side_effect=[
            HTTPException(429, "O armazenamento está temporariamente ocupado."),
            {"job_id": "00000000-0000-4000-8000-000000000001"},
        ])
        analyzer = AsyncMock()
        with patch.object(main, "run_supabase_helper", new=helper), \
                patch.object(main, "analyze_with_gemini", new=analyzer), \
                patch.object(main, "wake_photo_worker") as wake:
            result = await main.process_input(
                main.ProcessInputRequest(image_base64="aW1hZ2U="), {"id": "owner-a"},
            )
        self.assertEqual(result["status"], "pending")
        self.assertEqual([call.args[0] for call in helper.await_args_list], ["context", "enqueue-photo"])
        self.assertEqual(helper.await_args_list[1].kwargs["payload"]["owner_id"], "owner-a")
        analyzer.assert_not_awaited()
        wake.assert_called_once()

    async def test_all_helper_subprocesses_share_one_turn(self):
        active = 0
        peak = 0
        actions = []

        async def helper(command, **kwargs):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            actions.append(command[2])
            await asyncio.sleep(0.001)
            active -= 1
            return {"ok": True}

        with patch.object(storage_requests, "INTER_HELPER_DELAY", 0), \
                patch.object(main, "run_json_helper", side_effect=helper):
            await asyncio.gather(*[
                main.run_supabase_helper(action) for action in ("context", "save-chat", "list-photos")
            ])
        self.assertEqual(peak, 1)
        self.assertEqual(actions, ["context", "save-chat", "list-photos"])

    async def test_cooldown_survives_failed_helper_and_does_not_repeat_the_write(self):
        times = []
        loop = asyncio.get_running_loop()

        async def helper(command, **kwargs):
            times.append(loop.time())
            if len(times) == 1:
                raise HTTPException(429, "busy", headers={"Retry-After": "0.025"})
            return {"ok": True}

        with patch.object(storage_requests, "INTER_HELPER_DELAY", 0), \
                patch.object(main, "run_json_helper", side_effect=helper):
            with self.assertRaises(HTTPException):
                await main.run_supabase_helper("save")
            self.assertEqual(await main.run_supabase_helper("context"), {"ok": True})
        self.assertEqual(len(times), 2)
        self.assertGreaterEqual(times[1] - times[0], 0.024)

    async def test_bridge_preserves_provider_wait_and_does_not_mislabel_a_full_photo_queue(self):
        for code, delay, expected_detail in [
            ("supabase_error", 60_000, "O armazenamento está temporariamente ocupado."),
            ("too_many_photo_jobs", None, "Aguarde a conclusão das fotos pendentes."),
        ]:
            output = json.dumps({"ok": False, "error": {
                "code": code, "status": 429, "retry_after_ms": delay,
                "message": "Aguarde a conclusão das fotos pendentes.",
            }}).encode()
            process = AsyncMock()
            process.returncode = 1
            process.communicate.return_value = (output, b"")
            with patch.object(main.asyncio, "create_subprocess_exec", return_value=process):
                with self.assertRaises(HTTPException) as caught:
                    await main.run_json_helper(
                        ["bun", "helper.mjs", "enqueue-photo"], payload={},
                        timeout_seconds=1, connector_name="Supabase",
                    )
            self.assertIn(expected_detail, caught.exception.detail)
            if code == "supabase_error":
                self.assertEqual(caught.exception.headers, {"Retry-After": "60"})
            else:
                self.assertIsNone(caught.exception.headers)