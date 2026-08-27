#!/usr/bin/env bash
set -euo pipefail

bun install --frozen-lockfile
python -m compileall -q backend
bun test backend/sync_health_sheet.test.mjs
bun run build