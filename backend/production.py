"""Production entrypoint with startup measurements, without changing Uvicorn defaults."""
from time import perf_counter, time
import os
import json

_started = perf_counter()
_previous = _started
_launched_at = float(os.environ.get("STARTUP_LAUNCHED_AT_MS", str(time() * 1000)))


def milestone(phase: str) -> None:
    global _previous
    now = perf_counter()
    print("[startup] " + json.dumps({
        "service": "python",
        "phase": phase,
        "since_launch_ms": round(time() * 1000 - _launched_at, 1),
        "since_python_entry_ms": round((now - _started) * 1000, 1),
        "stage_ms": round((now - _previous) * 1000, 1),
    }), flush=True)
    _previous = now


def main() -> None:
    milestone("interpreter_entered")
    import uvicorn

    milestone("uvicorn_imported")
    from backend.main import app

    milestone("application_imported")

    class MeasuredServer(uvicorn.Server):
        async def startup(self, sockets=None) -> None:
            milestone("api_initialization_started")
            await super().startup(sockets=sockets)
            if self.started:
                milestone("api_listening")

    config = uvicorn.Config(
        app, host="127.0.0.1",
        port=int(os.environ.get("BACKEND_INTERNAL_PORT", "8000")),
    )
    server = MeasuredServer(config)
    # Retain Config's automatic loop/protocol selection and signal handling.
    server.run()
    if not server.started:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
