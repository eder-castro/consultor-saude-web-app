#!/usr/bin/env bash
set -euo pipefail

bun install --frozen-lockfile
python -m compileall -q backend
bun run build