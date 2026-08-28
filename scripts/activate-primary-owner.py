import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.main import hash_password, normalize_email


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
    if result.returncode != 0:
        raise RuntimeError(f"Falha na ativação administrativa: {result.stderr.strip()}")
    parsed = json.loads(result.stdout)
    if not parsed.get("ok"):
        raise RuntimeError("O conector recusou a ativação administrativa.")
    return parsed


def main() -> int:
    email = normalize_email(os.environ.get("PRIMARY_OWNER_EMAIL", ""))
    password = os.environ.get("PRIMARY_OWNER_INITIAL_PASSWORD", "")
    if len(password) < 8:
        raise RuntimeError(
            "Defina PRIMARY_OWNER_INITIAL_PASSWORD como Secret com pelo menos 8 caracteres."
        )

    existing = run_helper("user-by-email", {"email": email}).get("user")
    if not isinstance(existing, dict) or not existing.get("id"):
        raise RuntimeError("A conta principal pendente não foi encontrada.")
    pending_hash = existing.get("password_hash")
    if not isinstance(pending_hash, str) or not pending_hash.startswith("pending$"):
        print("A conta principal já está ativa; nenhuma alteração foi feita.")
        return 0

    activated = run_helper(
        "activate-user",
        {
            "user_id": existing["id"],
            "expected_password_hash": pending_hash,
            "password_hash": hash_password(password),
        },
    ).get("user")
    if not isinstance(activated, dict) or activated.get("id") != existing["id"]:
        raise RuntimeError("Não foi possível ativar a conta principal.")

    run_helper("claim-owner", {"owner_id": existing["id"]})
    print("Conta principal ativada e registros associados com segurança.")
    return 0


if __name__ == "__main__":
    sys.exit(main())