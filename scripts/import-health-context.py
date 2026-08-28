import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "backend" / "supabase_health_records.mjs"


def run_helper(action: str, payload: dict[str, Any]) -> dict[str, Any]:
    result = subprocess.run(
        ["bun", str(HELPER), action],
        cwd=ROOT,
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
    )
    parsed = json.loads(result.stdout or "{}")
    if result.returncode != 0 or not parsed.get("ok"):
        message = parsed.get("error", {}).get("message", result.stderr.strip())
        raise RuntimeError(message or "O Supabase recusou a importação do contexto.")
    return parsed


def split_gem_source(content: str) -> tuple[str, str]:
    profile_heading = "📋 PERFIL CLÍNICO CONSOLIDADO (REFERÊNCIA OBRIGATÓRIA)"
    next_heading = "🧠 MEMÓRIA E CONTEXTO (INTEGRAÇÃO AUTOMÁTICA)"
    if profile_heading not in content or next_heading not in content:
        raise ValueError("O arquivo não contém as seções esperadas do perfil clínico.")

    _, after_profile = content.split(profile_heading, 1)
    clinical_profile, remaining_instructions = after_profile.split(next_heading, 1)
    persona = content.split(profile_heading, 1)[0].strip()
    instructions = f"{persona}\n\n{next_heading}\n{remaining_instructions.strip()}".strip()
    return clinical_profile.strip(), instructions


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Importa o perfil clínico e as instruções de um Gem para uma conta existente."
    )
    parser.add_argument("--email", required=True)
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()

    content = args.source.read_text(encoding="utf-8")
    clinical_profile, gem_instructions = split_gem_source(content)
    user = run_helper("user-by-email", {"email": args.email}).get("user")
    if not isinstance(user, dict) or not user.get("id"):
        raise RuntimeError("A conta informada não foi encontrada.")

    run_helper(
        "upsert-context",
        {
            "owner_id": user["id"],
            "clinical_profile": clinical_profile,
            "gem_instructions": gem_instructions,
        },
    )
    print("Perfil clínico e instruções importados com segurança.")
    return 0


if __name__ == "__main__":
    sys.exit(main())