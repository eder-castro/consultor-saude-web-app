import asyncio
import json
import os
from datetime import date
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Consultor de Saúde API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GOOGLE_SHEETS_CREDENTIALS = os.environ.get("GOOGLE_SHEETS_CREDENTIALS", "")
CONTEXT_HELPER = Path(__file__).with_name("google_drive_context.mjs")
SUPABASE_HELPER = Path(__file__).with_name("supabase_health_records.mjs")
SYNC_HELPER = Path(__file__).with_name("sync_health_sheet.mjs")
CONTEXT_TIMEOUT_SECONDS = 20
SUPABASE_TIMEOUT_SECONDS = 30
SYNC_TIMEOUT_SECONDS = 90


class ProcessInputRequest(BaseModel):
    text: str | None = None
    image_base64: str | None = None
    mime_type: str | None = None


class SaveRecordsRequest(BaseModel):
    evento_tipo: str | None = None
    itens: list[dict[str, Any]] = Field(default_factory=list)
    records: list[dict[str, Any]] = Field(default_factory=list)


async def run_supabase_helper(
    action: str,
    *,
    payload: dict[str, Any] | None = None,
    argument: str | None = None,
) -> dict[str, Any]:
    command = ["bun", str(SUPABASE_HELPER), action]
    if argument:
        command.append(argument)

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
            timeout=SUPABASE_TIMEOUT_SECONDS,
        )
    except TimeoutError as error:
        process.kill()
        await process.communicate()
        raise HTTPException(
            status_code=504,
            detail="O Supabase demorou demais para responder.",
        ) from error

    try:
        result = json.loads(stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        diagnostic = stderr.decode("utf-8", errors="replace").strip()
        raise HTTPException(
            status_code=502,
            detail=f"Resposta inválida do conector do Supabase: {diagnostic}",
        ) from error

    if process.returncode != 0 or not result.get("ok", True):
        connector_error = result.get("error", {})
        raise HTTPException(
            status_code=int(connector_error.get("status", 502)),
            detail=connector_error.get(
                "message",
                "Não foi possível acessar os registros de saúde no Supabase.",
            ),
        )

    return result


async def run_sync_helper() -> dict[str, Any]:
    process = await asyncio.create_subprocess_exec(
        "bun",
        str(SYNC_HELPER),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=SYNC_TIMEOUT_SECONDS,
        )
    except TimeoutError as error:
        process.kill()
        await process.communicate()
        raise HTTPException(
            status_code=504,
            detail="A sincronização da planilha demorou demais.",
        ) from error

    try:
        result = json.loads(stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        diagnostic = stderr.decode("utf-8", errors="replace").strip()
        raise HTTPException(
            status_code=502,
            detail=f"Resposta inválida da sincronização: {diagnostic}",
        ) from error

    if process.returncode != 0 or not result.get("ok"):
        sync_error = result.get("error", {})
        raise HTTPException(
            status_code=int(sync_error.get("status", 502)),
            detail=sync_error.get(
                "message",
                "Não foi possível sincronizar a planilha com o Supabase.",
            ),
        )

    return result


@app.post("/process-input")
async def process_input(body: ProcessInputRequest):
    return {"status": "ok", "items": []}


@app.post("/save-records")
async def save_records(body: SaveRecordsRequest):
    return await run_supabase_helper(
        "save",
        payload=body.model_dump(),
    )


@app.get("/daily-summary")
async def daily_summary(data: date | None = None):
    return await run_supabase_helper(
        "summary",
        argument=data.isoformat() if data else None,
    )


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/sync-health-sheet")
async def sync_health_sheet():
    return await run_sync_helper()


@app.get("/get-context")
async def get_context():
    process = await asyncio.create_subprocess_exec(
        "bun",
        str(CONTEXT_HELPER),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=CONTEXT_TIMEOUT_SECONDS,
        )
    except TimeoutError as error:
        process.kill()
        await process.communicate()
        raise HTTPException(
            status_code=504,
            detail="O Google Drive demorou demais para responder.",
        ) from error

    try:
        result = json.loads(stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        diagnostic = stderr.decode("utf-8", errors="replace").strip()
        raise HTTPException(
            status_code=502,
            detail=f"Resposta inválida do conector do Google Drive: {diagnostic}",
        ) from error

    if process.returncode != 0 or not result.get("ok"):
        connector_error = result.get("error", {})
        error_code = connector_error.get("code", "google_drive_error")
        status_code = (
            404
            if error_code in {"folder_not_found", "context_file_not_found"}
            else 409
            if error_code == "multiple_context_files"
            else 502
        )
        raise HTTPException(
            status_code=status_code,
            detail=connector_error.get(
                "message",
                "Não foi possível ler o histórico de saúde no Google Drive.",
            ),
        )

    return {
        "status": "ok",
        "context": result["context"],
        "source": result["source"],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
