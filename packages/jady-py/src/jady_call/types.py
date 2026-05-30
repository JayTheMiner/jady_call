from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Generic, MutableMapping, TypeVar

T = TypeVar("T")
JadyConfig = MutableMapping[str, Any]


class JadyErrorCodes:
    ETIMEDOUT = "ETIMEDOUT"
    ECANCELED = "ECANCELED"
    ENETWORK = "ENETWORK"
    EPARSE = "EPARSE"
    EMAXREDIRECTS = "EMAXREDIRECTS"
    EUNKNOWN = "EUNKNOWN"


@dataclass
class JadyAttempt:
    url: str
    duration: int
    status: int | None = None
    statusText: str | None = None
    headers: dict[str, Any] | None = None
    error: dict[str, str] | None = None


@dataclass
class JadyResponse(Generic[T]):
    status: int
    statusText: str
    duration: int
    totalDuration: int
    url: str
    attempts: list[JadyAttempt]
    config: JadyConfig
    body: T
    headers: dict[str, Any]
    ok: bool
    timings: dict[str, int] | None = None
    request: Any | None = None
    rawBody: str | bytes | None = None

    @property
    def data(self) -> T:
        return self.body


class JadyError(Exception):
    def __init__(
        self,
        message: str,
        code: str,
        config: JadyConfig,
        response: JadyResponse[Any] | None = None,
        timings: dict[str, int] | None = None,
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.config = config
        self.response = response
        self.timings = timings
        self.cause = cause


BeforeRequestHook = Callable[[JadyConfig], JadyConfig]
AfterResponseHook = Callable[[JadyResponse[Any]], JadyResponse[Any]]
BeforeErrorHook = Callable[[Exception], Exception]
BeforeRetryHook = Callable[[Exception, int], None | bool | JadyConfig]
BeforeRedirectHook = Callable[[JadyConfig, JadyResponse[Any]], None]


@dataclass
class JadyHooks:
    beforeRequest: BeforeRequestHook | None = None
    afterResponse: AfterResponseHook | None = None
    beforeError: BeforeErrorHook | None = None
    beforeRetry: BeforeRetryHook | None = None
    beforeRedirect: BeforeRedirectHook | None = None


@dataclass
class JadyInstance:
    defaults: dict[str, Any] = field(default_factory=dict)

    def __call__(self, config: JadyConfig) -> JadyResponse[Any]:
        from .dispatch import dispatch_request
        from .utils import merge_config

        merged = merge_config(self.defaults, dict(config))
        return dispatch_request(merged)

    def create(self, config: JadyConfig | None = None) -> "JadyInstance":
        from .utils import merge_config

        return JadyInstance(merge_config(self.defaults, dict(config or {})))

    def get(self, url: str, config: JadyConfig | None = None) -> JadyResponse[Any]:
        payload = dict(config or {})
        payload.update({"url": url, "method": "GET"})
        return self(payload)

    def delete(self, url: str, config: JadyConfig | None = None) -> JadyResponse[Any]:
        payload = dict(config or {})
        payload.update({"url": url, "method": "DELETE"})
        return self(payload)

    def head(self, url: str, config: JadyConfig | None = None) -> JadyResponse[Any]:
        payload = dict(config or {})
        payload.update({"url": url, "method": "HEAD"})
        return self(payload)

    def options(self, url: str, config: JadyConfig | None = None) -> JadyResponse[Any]:
        payload = dict(config or {})
        payload.update({"url": url, "method": "OPTIONS"})
        return self(payload)

    def post(self, url: str, data: Any = None, config: JadyConfig | None = None) -> JadyResponse[Any]:
        payload = dict(config or {})
        payload.update({"url": url, "method": "POST", "data": data})
        return self(payload)

    def put(self, url: str, data: Any = None, config: JadyConfig | None = None) -> JadyResponse[Any]:
        payload = dict(config or {})
        payload.update({"url": url, "method": "PUT", "data": data})
        return self(payload)

    def patch(self, url: str, data: Any = None, config: JadyConfig | None = None) -> JadyResponse[Any]:
        payload = dict(config or {})
        payload.update({"url": url, "method": "PATCH", "data": data})
        return self(payload)
