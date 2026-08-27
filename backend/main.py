import asyncio
import json
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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
CONTEXT_TIMEOUT_SECONDS = 20


class ProcessInputRequest(BaseModel):
    text: str | None = None
    image_base64: str | None = None
    mime_type: str | None = None


class SaveRecordsRequest(BaseModel):
    records: list[dict[str, Any]]


@app.post("/process-input")
async def process_input(body: ProcessInputRequest):
    return {"status": "ok", "items": []}


@app.post("/save-records")
async def save_records(body: SaveRecordsRequest):
    return {"status": "ok", "saved": len(body.records)}


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
