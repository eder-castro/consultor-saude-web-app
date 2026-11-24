import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from backend.analysis_progress import progress_response, report_progress
import backend.main as main


async def collect(response):
    events = []
    async for chunk in response.body_iterator:
        if chunk.startswith("data: "):
            events.append(json.loads(chunk[6:]))
    return events


class AnalysisProgressTests(unittest.IsolatedAsyncioTestCase):
    async def test_progress_from_main_and_worker_thread_precedes_result(self):
        async def operation():
            report_progress("loading_context")
            await asyncio.to_thread(report_progress, "retrying_service")
            report_progress("checking_result")
            return {"analysis": "Concluída"}
        response = progress_response(operation)
        events = await collect(response)
        self.assertEqual([event.get("stage") for event in events[:-1]],
                         ["loading_context", "retrying_service", "checking_result"])
        self.assertEqual(events[-1], {"type": "result", "data": {"analysis": "Concluída"}})
        self.assertEqual(response.headers["x-accel-buffering"], "no")

    async def test_service_error_is_terminal_and_preserves_status(self):
        async def operation():
            report_progress("retrying_service")
            raise HTTPException(status_code=503, detail="Serviço ocupado")
        events = await collect(progress_response(operation))
        self.assertEqual(events[-1], {"type": "error", "status": 503, "detail": "Serviço ocupado"})

    async def test_parallel_request_progress_is_isolated(self):
        async def operation(stage):
            report_progress(stage)
            await asyncio.sleep(0)
            return {"ok": True}
        a, b = await asyncio.gather(
            collect(progress_response(lambda: operation("analyzing_image"))),
            collect(progress_response(lambda: operation("analyzing_text"))))
        self.assertEqual(a[0]["stage"], "analyzing_image")
        self.assertEqual(b[0]["stage"], "analyzing_text")
        report_progress("ignored_without_request")

    async def test_direct_numeric_input_never_claims_to_use_ai(self):
        body = main.ProcessInputRequest(text="Bebi 300 ml de água")
        with patch.object(main, "run_supabase_helper", new=AsyncMock()) as helper:
            response = await main.process_input_stream(body, {"id": "owned-account"})
            events = await collect(response)
        self.assertEqual(events[0], {"type": "progress", "stage": "reading_input"})
        self.assertEqual(events[-1]["type"], "result")
        helper.assert_not_awaited()
        self.assertNotIn("analyzing_text", [event.get("stage") for event in events])

    async def test_saved_analysis_stream_uses_authenticated_owner(self):
        body = main.AnalyzeSavedRecordsRequest(record_refs=[{
            "table": "hidratacao", "import_key": "app:00000000-0000-4000-8000-000000000001"}])
        helper = AsyncMock(return_value={"confirmados": []})
        async def generate(context):
            report_progress("analyzing_saved_record")
            return "Comentário"
        with patch.object(main, "run_supabase_helper", new=helper), \
                patch.object(main, "generate_saved_record_analysis", new=generate):
            events = await collect(await main.analyze_saved_records_stream(body, {"id": "owned-account"}))
        self.assertEqual(helper.call_args.kwargs["payload"]["owner_id"], "owned-account")
        self.assertEqual(events[0]["stage"], "loading_saved_context")
        self.assertEqual(events[1]["stage"], "analyzing_saved_record")
        self.assertEqual(events[-1]["data"], {"analysis": "Comentário"})