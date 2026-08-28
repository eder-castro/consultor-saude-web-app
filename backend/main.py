import asyncio
import hmac
import json
import os
from datetime import date
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")
SUPABASE_HELPER = Path(__file__).with_name("supabase_health_records.mjs")
SUPABASE_TIMEOUT_SECONDS = 30

app = FastAPI(title="Consultor de Saúde API")

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

@app.get("/daily-summary")
async def daily_summary(data: date | None = None):
    return await run_supabase_helper(
        "summary",
        argument=data.isoformat() if data else None,
    )


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
