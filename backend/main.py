import asyncio
import hmac
import json
import os
from contextlib import asynccontextmanager, suppress
from datetime import date
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GOOGLE_SHEETS_CREDENTIALS = os.environ.get("GOOGLE_SHEETS_CREDENTIALS", "")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")
CONTEXT_HELPER = Path(__file__).with_name("google_drive_context.mjs")
SUPABASE_HELPER = Path(__file__).with_name("supabase_health_records.mjs")
SYNC_HELPER = Path(__file__).with_name("sync_health_sheet.mjs")
CONTEXT_TIMEOUT_SECONDS = 20
SUPABASE_TIMEOUT_SECONDS = 30
SYNC_TIMEOUT_SECONDS = 120
HEALTH_SYNC_INTERVAL_SECONDS = max(
    30,
    int(os.environ.get("HEALTH_SYNC_INTERVAL_SECONDS", "300")),
)
HEALTH_SYNC_LOCK = asyncio.Lock()
HEALTH_SYNC_STATE: dict[str, Any] = {
    "interval_seconds": HEALTH_SYNC_INTERVAL_SECONDS,
    "running": False,
    "last_checked_at": None,
    "last_synced_at": None,
    "last_modified_time": None,
    "last_result": None,
    "last_error": None,
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    sync_task = asyncio.create_task(health_sync_loop(), name="health-sheet-sync")
    try:
        yield
    finally:
        sync_task.cancel()
        with suppress(asyncio.CancelledError):
            await sync_task


app = FastAPI(title="Consultor de Saúde API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProcessInputRequest(BaseModel):
    text: str | None = None
    image_base64: str | None = None
    mime_type: str | None = None


class SaveRecordsRequest(BaseModel):
    evento_tipo: str | None = None
    itens: list[dict[str, Any]] = Field(default_factory=list)
    records: list[dict[str, Any]] = Field(default_factory=list)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def require_write_access(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    if not SESSION_SECRET:
        raise HTTPException(
            status_code=503,
            detail="A autenticação de escrita não está configurada.",
        )

    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(token, SESSION_SECRET):
        raise HTTPException(
            status_code=401,
            detail="Bearer token inválido ou ausente.",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def run_json_helper(
    command: list[str],
    *,
    payload: dict[str, Any] | None = None,
    timeout_seconds: int,
    connector_name: str,
    error_statuses: dict[str, int] | None = None,
) -> dict[str, Any]:
    process = await asyncio.create_subprocess_exec(
        *command,
        stdin=asyncio.subprocess.PIPE if payload is not None else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    input_bytes = json.dumps(payload).encode("utf-8") if payload is not None else None

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(input=input_bytes),
            timeout=timeout_seconds,
        )
    except TimeoutError as error:
        process.kill()
        await process.communicate()
        raise HTTPException(
            status_code=504,
            detail=f"O {connector_name} demorou demais para responder.",
        ) from error

    try:
        result = json.loads(stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        diagnostic = stderr.decode("utf-8", errors="replace").strip()
        raise HTTPException(
            status_code=502,
            detail=f"Resposta inválida do conector {connector_name}: {diagnostic}",
        ) from error

    if process.returncode != 0 or not result.get("ok", True):
        connector_error = result.get("error", {})
        error_code = connector_error.get("code", "connector_error")
        status_code = connector_error.get("status")
        if status_code is None:
            status_code = (error_statuses or {}).get(error_code, 502)
        raise HTTPException(
            status_code=int(status_code),
            detail=connector_error.get(
                "message",
                f"Não foi possível acessar os dados pelo conector {connector_name}.",
            ),
        )

    return result


async def run_supabase_helper(
    action: str,
    *,
    payload: dict[str, Any] | None = None,
    argument: str | None = None,
    timeout_seconds: int = SUPABASE_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    command = ["bun", str(SUPABASE_HELPER), action]
    if argument:
        command.append(argument)
    return await run_json_helper(
        command,
        payload=payload,
        timeout_seconds=timeout_seconds,
        connector_name="Supabase",
    )


async def run_sync_helper(action: str = "sync") -> dict[str, Any]:
    return await run_json_helper(
        ["bun", str(SYNC_HELPER), action],
        timeout_seconds=SYNC_TIMEOUT_SECONDS,
        connector_name="sincronização da planilha",
    )


async def synchronize_health_sheet(*, force: bool) -> dict[str, Any]:
    async with HEALTH_SYNC_LOCK:
        HEALTH_SYNC_STATE["running"] = True
        HEALTH_SYNC_STATE["last_checked_at"] = utc_now()
        try:
            metadata = await run_sync_helper("metadata")
            modified_time = metadata.get("source", {}).get("modifiedTime")

            if (
                not force
                and modified_time
                and modified_time == HEALTH_SYNC_STATE["last_modified_time"]
            ):
                return {
                    "ok": True,
                    "skipped": True,
                    "reason": "spreadsheet_unchanged",
                    "source": metadata.get("source"),
                }

            result = await run_sync_helper()
            HEALTH_SYNC_STATE.update(
                {
                    "last_synced_at": utc_now(),
                    "last_modified_time": modified_time,
                    "last_result": {
                        key: result.get(key)
                        for key in (
                            "total_rows",
                            "new_rows",
                            "ignored_rows",
                            "invalid_rows",
                            "tables",
                        )
                    },
                    "last_error": None,
                },
            )
            return result
        except Exception as error:
            HEALTH_SYNC_STATE["last_error"] = str(error)
            raise
        finally:
            HEALTH_SYNC_STATE["running"] = False


async def health_sync_loop() -> None:
    while True:
        try:
            await synchronize_health_sheet(force=False)
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        await asyncio.sleep(HEALTH_SYNC_INTERVAL_SECONDS)


@app.post("/process-input")
async def process_input(body: ProcessInputRequest):
    return {"status": "ok", "items": []}


@app.post("/save-records")
async def save_records(
    body: SaveRecordsRequest,
    _: Annotated[None, Depends(require_write_access)],
):
    return await run_supabase_helper(
        "save",
        payload=body.model_dump(),
    )

@app.post("/sync-health-sheet")
@app.post("/sync-health-records")
async def sync_health_records(
    _: Annotated[None, Depends(require_write_access)],
):
    return await synchronize_health_sheet(force=True)


@app.get("/sync-health-records/status")
async def sync_health_records_status():
    return {"ok": True, **HEALTH_SYNC_STATE}


@app.get("/daily-summary")
async def daily_summary(data: date | None = None):
    return await run_supabase_helper(
        "summary",
        argument=data.isoformat() if data else None,
    )


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/get-context")
async def get_context():
    result = await run_json_helper(
        ["bun", str(CONTEXT_HELPER), "context"],
        timeout_seconds=CONTEXT_TIMEOUT_SECONDS,
        connector_name="Google Drive",
        error_statuses={
            "folder_not_found": 404,
            "context_file_not_found": 404,
            "multiple_context_files": 409,
        },
    )

    return {
        "status": "ok",
        "context": result["context"],
        "source": result["source"],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
