import base64
import asyncio
import hmac
import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from typing import Annotated, Any
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")
SUPABASE_HELPER = Path(__file__).with_name("supabase_health_records.mjs")
SUPABASE_TIMEOUT_SECONDS = 30
GEMINI_TIMEOUT_SECONDS = 30
MAX_TEXT_LENGTH = 12_000
MAX_IMAGE_BYTES = 8 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
EVENT_TYPES = ("alimentacao", "hidratacao", "exercicio", "sono", "peso", "outro")

logger = logging.getLogger(__name__)

app = FastAPI(title="Consultor de Saúde API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProcessInputRequest(BaseModel):
    text: str | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    image_base64: str | None = Field(
        default=None,
        max_length=(MAX_IMAGE_BYTES * 4 // 3) + 2048,
    )
    mime_type: str | None = Field(default=None, max_length=100)


class SaveRecordsRequest(BaseModel):
    evento_tipo: str | None = None
    itens: list[dict[str, Any]] = Field(default_factory=list)
    records: list[dict[str, Any]] = Field(default_factory=list)
    grupos: list[dict[str, Any]] = Field(default_factory=list)


class GeminiItem(BaseModel):
    item: str = Field(min_length=1, max_length=200)
    quantidade_estimada: str = Field(default="não informado", max_length=100)
    confirmado: bool = True


class GeminiGroup(BaseModel):
    evento_tipo: str
    itens: list[GeminiItem] = Field(min_length=1, max_length=50)


class GeminiPayload(BaseModel):
    grupos: list[GeminiGroup] = Field(min_length=1, max_length=len(EVENT_TYPES))
    resumo: str | None = Field(default=None, max_length=500)


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


def clean_base64_image(value: str) -> str:
    encoded = value.strip()
    if encoded.startswith("data:") and "," in encoded:
        encoded = encoded.split(",", 1)[1]

    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error) as error:
        raise HTTPException(status_code=422, detail="A imagem não possui Base64 válido.") from error

    if len(decoded) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="A imagem excede o limite de 8 MB.",
        )
    return encoded


def gemini_schema() -> dict[str, Any]:
    return {
        "type": "OBJECT",
        "properties": {
            "grupos": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "evento_tipo": {"type": "STRING", "enum": list(EVENT_TYPES)},
                        "itens": {
                            "type": "ARRAY",
                            "items": {
                                "type": "OBJECT",
                                "properties": {
                                    "item": {"type": "STRING"},
                                    "quantidade_estimada": {"type": "STRING"},
                                    "confirmado": {"type": "BOOLEAN"},
                                },
                                "required": ["item", "quantidade_estimada", "confirmado"],
                            },
                        },
                    },
                    "required": ["evento_tipo", "itens"],
                },
            },
            "resumo": {"type": "STRING"},
        },
        "required": ["grupos"],
    }


def gemini_prompt(text: str | None, has_image: bool) -> str:
    source_description = []
    if text:
        source_description.append(f'Texto enviado pelo usuário: "{text}"')
    if has_image:
        source_description.append("Uma imagem foi anexada ao registro.")

    return f"""
Você é um assistente de registro de saúde em português do Brasil.
Interprete o conteúdo abaixo e extraia somente fatos explicitamente observados.
Não dê diagnóstico, recomendação médica ou informação nutricional.
Não invente itens ou quantidades; quando a quantidade não estiver clara, use "não informado".

Classifique cada fato observado em um tipo:
- alimentacao: refeições, alimentos ou bebidas que não sejam apenas água;
- hidratacao: água, copos de água ou volume de água;
- exercicio: atividade física;
- sono: período ou qualidade do sono;
- peso: peso corporal;
- outro: quando não se encaixar nos tipos anteriores.
Uma mensagem pode conter mais de um tipo. Nesse caso, não use um único tipo para
toda a mensagem: crie um grupo separado por tipo em "grupos". Cada item deve
aparecer em exatamente um grupo. Por exemplo, "comi arroz e bebi água" deve
gerar um grupo alimentacao com arroz e um grupo hidratacao com água.

Retorne apenas o JSON no formato solicitado.

{chr(10).join(source_description)}
""".strip()


def call_gemini_sync(payload: dict[str, Any]) -> dict[str, Any]:
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    )
    request_body = json.dumps(payload).encode("utf-8")

    for attempt in range(3):
        request = urllib.request.Request(
            url,
            data=request_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=GEMINI_TIMEOUT_SECONDS) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:300]
            logger.warning(
                "Gemini respondeu HTTP %s na tentativa %s: %s",
                error.code,
                attempt + 1,
                detail,
            )
            if error.code in {429, 503} and attempt < 2:
                time.sleep(2**attempt)
                continue
            if error.code == 429:
                raise HTTPException(
                    status_code=429,
                    detail="O limite temporário do Gemini foi atingido. Tente novamente em instantes.",
                ) from error
            if error.code == 503:
                raise HTTPException(
                    status_code=503,
                    detail="O Gemini está temporariamente sobrecarregado. Tente novamente em instantes.",
                ) from error
            if error.code in {401, 403}:
                raise HTTPException(
                    status_code=503,
                    detail="A credencial do Gemini não está válida ou não tem permissão.",
                ) from error
            raise HTTPException(
                status_code=502,
                detail="O Gemini não conseguiu processar a solicitação.",
            ) from error
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            logger.warning("Falha de comunicação com o Gemini: %s", error)
            raise HTTPException(
                status_code=502,
                detail="Não foi possível comunicar com o Gemini.",
            ) from error

    raise HTTPException(status_code=503, detail="O Gemini está temporariamente indisponível.")


def extract_gemini_text(response: dict[str, Any]) -> str:
    parts = (
        response.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [])
    )
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise HTTPException(status_code=502, detail="O Gemini retornou uma resposta vazia.")

    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    return fenced.group(1).strip() if fenced else text


async def analyze_with_gemini(body: ProcessInputRequest) -> dict[str, Any]:
    text = (body.text or "").strip()
    image_base64 = body.image_base64

    if not text and not image_base64:
        raise HTTPException(
            status_code=422,
            detail="Envie um texto, uma imagem ou os dois.",
        )
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="A integração do Gemini ainda não está configurada.",
        )

    image_part = None
    if image_base64:
        mime_type = (body.mime_type or "image/jpeg").lower().strip()
        if mime_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=415,
                detail="Tipo de imagem não suportado. Use JPEG, PNG, WebP ou GIF.",
            )
        image_part = {
            "inline_data": {
                "mime_type": mime_type,
                "data": clean_base64_image(image_base64),
            }
        }

    parts: list[dict[str, Any]] = [
        {"text": gemini_prompt(text or None, image_part is not None)}
    ]
    if image_part:
        parts.append(image_part)

    response = await asyncio.to_thread(
        call_gemini_sync,
        {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json",
                "responseSchema": gemini_schema(),
            },
        },
    )

    try:
        parsed = GeminiPayload.model_validate(json.loads(extract_gemini_text(response)))
    except (json.JSONDecodeError, ValidationError) as error:
        logger.warning("Resposta estruturada inválida do Gemini: %s", error)
        raise HTTPException(
            status_code=502,
            detail="O Gemini retornou dados fora do formato esperado.",
        ) from error

    groups_by_type: dict[str, list[GeminiItem]] = {}
    for group in parsed.grupos:
        if group.evento_tipo not in EVENT_TYPES:
            raise HTTPException(
                status_code=502,
                detail="O Gemini retornou um tipo de registro inválido.",
            )
        groups_by_type.setdefault(group.evento_tipo, []).extend(group.itens)

    return {
        "grupos": [
            {
                "evento_tipo": evento_tipo,
                "itens": [
                    {
                        "id": str(uuid4()),
                        "item": item.item.strip(),
                        "quantidade_estimada": item.quantidade_estimada.strip() or "não informado",
                        "confirmado": item.confirmado,
                    }
                    for item in itens
                ],
            }
            for evento_tipo, itens in groups_by_type.items()
        ],
        **({"resumo": parsed.resumo} if parsed.resumo else {}),
    }


@app.post("/process-input")
async def process_input(
    body: ProcessInputRequest,
    _: Annotated[None, Depends(require_write_access)],
):
    return await analyze_with_gemini(body)


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
