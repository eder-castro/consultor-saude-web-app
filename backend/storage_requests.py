"""Coordinate bridge subprocesses; their individual request pacers are not shared."""
import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from weakref import WeakKeyDictionary

from fastapi import HTTPException

INTER_HELPER_DELAY = 0.125


@dataclass
class _Gate:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    next_allowed: float = 0


_gates: WeakKeyDictionary = WeakKeyDictionary()


@asynccontextmanager
async def storage_helper_turn():
    loop = asyncio.get_running_loop()
    gate = _gates.setdefault(loop, _Gate())
    async with gate.lock:
        delay = gate.next_allowed - loop.time()
        if delay > 0:
            await asyncio.sleep(delay)
        try:
            yield
        except HTTPException as error:
            # Carry the provider's cooldown across short-lived JS bridge processes.
            if error.status_code in {429, 503} and error.headers:
                try:
                    retry_after = max(0, float(error.headers.get("Retry-After", "0")))
                    gate.next_allowed = max(gate.next_allowed, loop.time() + retry_after)
                except (TypeError, ValueError):
                    pass
            raise
        finally:
            gate.next_allowed = max(gate.next_allowed, loop.time() + INTER_HELPER_DELAY)