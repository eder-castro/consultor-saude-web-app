"""Request-local progress over SSE; no inputs, media or identities in progress events."""
import asyncio
import json
import logging
from contextvars import ContextVar
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import HTTPException
from starlette.responses import StreamingResponse

_reporter: ContextVar[Callable[[str], None] | None] = ContextVar("analysis_reporter", default=None)


def report_progress(stage: str) -> None:
    reporter = _reporter.get()
    if reporter is not None:
        reporter(stage)


def progress_response(operation: Callable[[], Awaitable[Any]]) -> StreamingResponse:
    async def events():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        active = True

        def report(stage: str):
            if not active:
                return
            # asyncio.to_thread copies context; safely deliver Gemini retry stages.
            event = {"type": "progress", "stage": stage}
            try:
                if asyncio.get_running_loop() is loop:
                    queue.put_nowait(event)
                    return
            except RuntimeError:
                pass
            if not loop.is_closed():
                loop.call_soon_threadsafe(queue.put_nowait, event)

        async def work():
            token = _reporter.set(report)
            try:
                result = await operation()
                await queue.put({"type": "result", "data": result})
            except HTTPException as error:
                logging.getLogger(__name__).warning(
                    "Analysis stream failed: HTTP %s", error.status_code,
                )
                await queue.put({"type": "error", "status": error.status_code, "detail": error.detail})
            except Exception:
                logging.getLogger(__name__).exception("Analysis stream failed")
                await queue.put({"type": "error", "status": 500,
                                 "detail": "Não foi possível concluir a análise. Tente novamente."})
            finally:
                _reporter.reset(token)

        task = asyncio.create_task(work())
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event["type"] in ("result", "error"):
                    break
        finally:
            active = False
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})