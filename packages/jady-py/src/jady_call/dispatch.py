from __future__ import annotations

import time
from typing import Any
from urllib.parse import urlparse

from .adapters import urllib_adapter
from .types import JadyAttempt, JadyConfig, JadyError, JadyErrorCodes, JadyHooks, JadyResponse
from .utils import (
    build_full_path,
    build_url,
    combine_urls,
    create_error,
    generate_request_id,
    is_absolute_url,
    is_signal_aborted,
    merge_config,
    parse_cookie,
    parse_retry_after,
    process_headers,
    substitute_path,
)


DEFAULTS: dict[str, Any] = {
    "method": "GET",
    "timeout": 30000,
    "totalTimeout": 0,
    "paramsArrayFormat": "repeat",
    "cookieMode": "none",
    "redirect": "follow",
    "maxRedirects": 10,
    "retry": 0,
    "retryDelay": 0,
    "responseType": "auto",
    "responseEncoding": "utf-8",
    "decompress": True,
    "cache": "default",
    "priority": "auto",
    "xsrfCookieName": "XSRF-TOKEN",
    "xsrfHeaderName": "X-XSRF-TOKEN",
    "validateStatus": lambda status: 200 <= status < 300,
    "headers": {"Accept": "application/json, text/plain, */*"},
    "adapter": urllib_adapter,
}


def dispatch_request(user_config: JadyConfig) -> JadyResponse[Any]:
    config = merge_config(DEFAULTS, dict(user_config))
    if config.get("method"):
        config["method"] = str(config["method"]).upper()

    if not config.get("requestId"):
        config["requestId"] = generate_request_id()

    config["headers"] = process_headers(config.get("headers"))
    _apply_manual_cookies(config)
    _apply_decompress_header(config)
    _apply_xsrf_header(config)

    if config.get("baseUrl") and not is_absolute_url(config.get("url", "")):
        config["url"] = build_full_path(config.get("baseUrl"), config.get("url"))

    if config.get("path"):
        config["url"] = substitute_path(config["url"], config.get("path"))
    config["url"] = build_url(
        config["url"],
        config.get("params"),
        config.get("paramsSerializer"),
        config.get("paramsArrayFormat"),
    )

    if not config.get("url"):
        raise ValueError("url is required")

    auth = config.get("auth") or {}
    if auth.get("username") is not None and auth.get("bearer") is not None:
        raise ValueError("Cannot use both Basic and Bearer authentication")

    hooks = _coerce_hooks(config.get("hooks"))
    if hooks.beforeRequest:
        config = hooks.beforeRequest(config)

    start_time = time.perf_counter()
    attempts: list[JadyAttempt] = []
    retry_count = 0
    redirect_count = 0
    response: JadyResponse[Any] | None = None
    error: Exception | None = None

    while True:
        attempt_started = time.perf_counter()
        _check_canceled(config)
        _check_total_timeout(config, start_time, None)

        try:
            adapter = config.get("adapter")
            if not callable(adapter):
                raise create_error("Adapter not implemented yet", JadyErrorCodes.EUNKNOWN, config)

            response = adapter(config)
            response.config = config
            response.duration = _elapsed_ms(attempt_started)
            response.totalDuration = _elapsed_ms(start_time)
            attempts.append(
                JadyAttempt(
                    url=response.url,
                    duration=response.duration,
                    status=response.status,
                    statusText=response.statusText,
                    headers=response.headers,
                )
            )

            if _should_follow_redirect(config, response):
                if redirect_count >= int(config.get("maxRedirects") or 10):
                    raise create_error("Max redirects exceeded", JadyErrorCodes.EMAXREDIRECTS, config, response)
                config = _build_redirect_config(config, response, hooks)
                redirect_count += 1
                continue

            if _should_retry_response(config, response, retry_count):
                retry_error = create_error(f"Request failed with status code {response.status}", JadyErrorCodes.ENETWORK, config, response)
                attempts[-1].error = {"code": retry_error.code, "message": str(retry_error)}
                if not _run_before_retry(hooks, retry_error, retry_count + 1, config):
                    error = retry_error
                    break
                delay = _get_retry_delay(config, retry_count + 1, retry_error, response)
                _sleep(delay, config, start_time, response)
                retry_count += 1
                continue

            if hooks.afterResponse:
                response = hooks.afterResponse(response)
            response.attempts = attempts
            response.totalDuration = _elapsed_ms(start_time)
            response.ok = bool((config.get("validateStatus") or DEFAULTS["validateStatus"])(response.status))
            if not response.ok:
                error = create_error(f"Request failed with status code {response.status}", JadyErrorCodes.ENETWORK, config, response)
                break
            return response
        except Exception as exc:
            error = exc
            if not isinstance(exc, JadyError):
                error = create_error(str(exc), JadyErrorCodes.EUNKNOWN, config, response, exc)

            attempts.append(
                JadyAttempt(
                    url=config["url"],
                    duration=_elapsed_ms(attempt_started),
                    error={"code": getattr(error, "code", JadyErrorCodes.EUNKNOWN), "message": str(error)},
                )
            )

            if _should_retry_error(config, error, retry_count):
                if not _run_before_retry(hooks, error, retry_count + 1, config):
                    break
                delay = _get_retry_delay(config, retry_count + 1, error, getattr(error, "response", None))
                _sleep(delay, config, start_time, getattr(error, "response", None))
                retry_count += 1
                continue
            break

    assert error is not None
    if isinstance(error, JadyError) and error.response is not None:
        error.response.attempts = attempts
        error.response.totalDuration = _elapsed_ms(start_time)
    if hooks.beforeError:
        raised = hooks.beforeError(error)
        if isinstance(raised, Exception):
            raise raised
        raise error
    raise error


def _coerce_hooks(raw_hooks: Any) -> JadyHooks:
    if isinstance(raw_hooks, JadyHooks):
        return raw_hooks
    if isinstance(raw_hooks, dict):
        return JadyHooks(**raw_hooks)
    return JadyHooks()


def _apply_manual_cookies(config: JadyConfig) -> None:
    if config.get("cookieMode") != "manual":
        return
    cookies = (config.get("platform") or {}).get("cookies") or {}
    if not cookies:
        return
    cookie_header = "; ".join(
        f"{key}={value}"
        for key, value in cookies.items()
        if value is not None
    )
    if cookie_header:
        config["headers"]["cookie"] = cookie_header


def _apply_decompress_header(config: JadyConfig) -> None:
    if config.get("decompress", True) and "accept-encoding" not in config["headers"]:
        config["headers"]["accept-encoding"] = "gzip, deflate, br"


def _apply_xsrf_header(config: JadyConfig) -> None:
    method = str(config.get("method") or "GET").upper()
    if method in {"GET", "HEAD", "OPTIONS", "TRACE"}:
        return
    cookie_name = config.get("xsrfCookieName")
    header_name = config.get("xsrfHeaderName")
    if not cookie_name or not header_name:
        return
    header_key = str(header_name).lower()
    if header_key in config["headers"]:
        return

    cookie_value = None
    cookie_header = config["headers"].get("cookie")
    if cookie_header:
        cookie_value = parse_cookie(str(cookie_header), str(cookie_name))

    if cookie_value is None:
        platform_cookies = (config.get("platform") or {}).get("cookies") or {}
        if cookie_name in platform_cookies and platform_cookies[cookie_name] is not None:
            cookie_value = str(platform_cookies[cookie_name])

    if cookie_value is not None:
        config["headers"][header_key] = cookie_value


def _check_canceled(config: JadyConfig) -> None:
    if is_signal_aborted(config.get("signal")):
        raise create_error("Canceled", JadyErrorCodes.ECANCELED, config)


def _check_total_timeout(config: JadyConfig, start_time: float, response: JadyResponse[Any] | None) -> None:
    total_timeout = int(config.get("totalTimeout") or 0)
    if total_timeout > 0 and _elapsed_ms(start_time) > total_timeout:
        raise create_error("Total timeout exceeded", JadyErrorCodes.ETIMEDOUT, config, response)


def _should_follow_redirect(config: JadyConfig, response: JadyResponse[Any]) -> bool:
    location = response.headers.get("location")
    return bool(config.get("redirect") == "follow" and 300 <= response.status < 400 and location)


def _build_redirect_config(config: JadyConfig, response: JadyResponse[Any], hooks: JadyHooks) -> JadyConfig:
    location = str(response.headers["location"])
    next_url = location if is_absolute_url(location) else combine_urls(config["url"].rsplit("/", 1)[0], location)
    next_config = merge_config(config, {"url": next_url})
    if response.status in {301, 302, 303}:
        next_config["method"] = "GET"
        next_config.pop("data", None)
        next_config.pop("files", None)
    if _is_cross_domain(config["url"], next_url):
        for key in ("authorization", "cookie", "proxy-authorization"):
            next_config.get("headers", {}).pop(key, None)
    if hooks.beforeRedirect:
        hooks.beforeRedirect(next_config, response)
    return next_config


def _is_cross_domain(current_url: str, next_url: str) -> bool:
    current = urlparse(current_url)
    target = urlparse(next_url)
    return (current.scheme, current.hostname, current.port) != (target.scheme, target.hostname, target.port)


def _should_retry_response(config: JadyConfig, response: JadyResponse[Any], retry_count: int) -> bool:
    retry_limit = int(config.get("retry") or 0)
    if retry_count >= retry_limit:
        return False
    if callable(config.get("retryCondition")):
        synthetic_error = create_error(f"Request failed with status code {response.status}", JadyErrorCodes.ENETWORK, config, response)
        return bool(config["retryCondition"](synthetic_error, retry_count + 1))
    return response.status == 429 or response.status >= 500


def _should_retry_error(config: JadyConfig, error: Exception, retry_count: int) -> bool:
    retry_limit = int(config.get("retry") or 0)
    if retry_count >= retry_limit:
        return False
    code = getattr(error, "code", None)
    if code in {JadyErrorCodes.ECANCELED, JadyErrorCodes.EMAXREDIRECTS, JadyErrorCodes.EPARSE}:
        return False
    custom = config.get("retryCondition")
    if callable(custom):
        return bool(custom(error, retry_count + 1))
    return True


def _get_retry_delay(config: JadyConfig, retry_count: int, error: Exception, response: JadyResponse[Any] | None) -> int:
    retry_after = parse_retry_after((response.headers.get("retry-after") if response else None))
    if retry_after is not None:
        return retry_after
    retry_delay = config.get("retryDelay", 0)
    if callable(retry_delay):
        return int(retry_delay(retry_count, error))
    return int(retry_delay or 0)


def _run_before_retry(hooks: JadyHooks, error: Exception, retry_count: int, config: JadyConfig) -> bool:
    if not hooks.beforeRetry:
        return True
    hook_result = hooks.beforeRetry(error, retry_count)
    if hook_result is False:
        return False
    if isinstance(hook_result, dict):
        config.clear()
        config.update(hook_result)
    return True


def _sleep(delay_ms: int, config: JadyConfig, start_time: float, response: JadyResponse[Any] | None) -> None:
    if delay_ms <= 0:
        _check_total_timeout(config, start_time, response)
        _check_canceled(config)
        return
    end_time = time.perf_counter() + (delay_ms / 1000)
    while True:
        _check_canceled(config)
        _check_total_timeout(config, start_time, response)
        remaining = end_time - time.perf_counter()
        if remaining <= 0:
            return
        time.sleep(min(remaining, 0.05))


def _elapsed_ms(start_time: float) -> int:
    return int((time.perf_counter() - start_time) * 1000)
