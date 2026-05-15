import os
import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any

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
    return {"status": "ok", "context": []}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="localhost", port=8000, reload=True)
