from __future__ import annotations

from .dispatch import dispatch_request
from .types import JadyError, JadyErrorCodes, JadyHooks, JadyInstance, JadyResponse
from .utils import merge_config


def create(default_config: dict | None = None) -> JadyInstance:
    return JadyInstance(defaults=dict(default_config or {}))


jady = create({})
call = jady

__all__ = [
    "JadyError",
    "JadyErrorCodes",
    "JadyHooks",
    "JadyInstance",
    "JadyResponse",
    "call",
    "create",
    "dispatch_request",
    "jady",
    "merge_config",
]
