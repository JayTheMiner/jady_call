from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
import mimetypes
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from collections.abc import Mapping
from typing import Any

from ..types import JadyConfig, JadyErrorCodes, JadyResponse
from ..utils import compact_iterable, create_error, stringify_query_value, to_json_body


TEXT_CONTENT_TYPES = (
    "text/",
    "application/xml",
    "application/javascript",
    "application/x-www-form-urlencoded",
)


@dataclass
class UrllibPreparedRequest:
    method: str
    url: str
    headers: dict[str, str]


@dataclass
class UrllibResponse:
    status_code: int
    headers: Any
    content: bytes | None
    url: str
    reason: str
    request: UrllibPreparedRequest
    raw: Any


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ProgressReader:
    def __init__(self, raw: Any, callback: Any = None, total: int | None = None, max_body_length: int | None = None, config: JadyConfig | None = None, integrity_state: list[tuple[str, Any, bytes]] | None = None) -> None:
        self._raw = raw
        self._callback = callback
        self._total = total
        self._max_body_length = max_body_length if max_body_length and max_body_length > 0 else None
        self._config = config or {}
        self._integrity_state = integrity_state or []
        self._integrity_finalized = False
        self._loaded = 0

    def read(self, size: int = -1) -> bytes:
        chunk = self._raw.read(size)
        if not chunk:
            _finalize_integrity(self._integrity_state, self._config)
            self._integrity_finalized = True
            return chunk
        self._loaded += len(chunk)
        _check_max_body_length(self._loaded, self._max_body_length, self._config)
        _update_integrity(self._integrity_state, chunk)
        _notify_progress(self._callback, self._loaded, self._total)
        if self._total is not None and self._loaded >= self._total and not self._integrity_finalized:
            _finalize_integrity(self._integrity_state, self._config)
            self._integrity_finalized = True
        return chunk

    def close(self) -> None:
        close = getattr(self._raw, "close", None)
        if callable(close):
            close()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._raw, name)


def urllib_adapter(config: JadyConfig) -> JadyResponse[Any]:
    headers = dict(config.get("headers") or {})
    _apply_auth(headers, config)
    request_kwargs = _build_request_kwargs(config, headers)

    opener = urllib.request.build_opener(NoRedirectHandler())
    opener.addheaders = []
    start = time.perf_counter()
    try:
        response = _send_with_urllib(opener, request_kwargs)
    except TimeoutError as exc:
        raise create_error("Request timed out", JadyErrorCodes.ETIMEDOUT, config, original_error=exc) from exc
    except socket.timeout as exc:
        raise create_error("Request timed out", JadyErrorCodes.ETIMEDOUT, config, original_error=exc) from exc
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", None)
        if isinstance(reason, (TimeoutError, socket.timeout)):
            raise create_error("Request timed out", JadyErrorCodes.ETIMEDOUT, config, original_error=exc) from exc
        raise create_error(str(exc), JadyErrorCodes.ENETWORK, config, original_error=exc) from exc
    finally:
        duration = int((time.perf_counter() - start) * 1000)

    return _build_response(config, response, duration)


def _send_with_urllib(opener: urllib.request.OpenerDirector, request_kwargs: dict[str, Any]) -> UrllibResponse:
    request = urllib.request.Request(
        url=request_kwargs["url"],
        data=request_kwargs.get("data"),
        headers=request_kwargs["headers"],
        method=request_kwargs["method"],
    )

    try:
        raw_response = opener.open(request, timeout=request_kwargs.get("timeout"))
    except urllib.error.HTTPError as exc:
        raw_response = exc

    status_code = getattr(raw_response, "status", None) or raw_response.getcode()
    reason = getattr(raw_response, "reason", "") or ""

    return UrllibResponse(
        status_code=status_code,
        headers=raw_response.headers,
        content=None,
        url=raw_response.geturl(),
        reason=reason,
        request=UrllibPreparedRequest(
            method=request.get_method(),
            url=request.full_url,
            headers={key.lower(): value for key, value in request.header_items()},
        ),
        raw=raw_response,
    )


def _apply_auth(headers: dict[str, str], config: JadyConfig) -> None:
    auth = config.get("auth")
    if not auth or headers.get("authorization"):
        return
    username = auth.get("username")
    bearer = auth.get("bearer")
    if username is not None:
        password = auth.get("password") or ""
        token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
        headers["authorization"] = f"Basic {token}"
    elif bearer is not None:
        headers["authorization"] = f"Bearer {bearer}"


def _build_request_kwargs(config: JadyConfig, headers: dict[str, str]) -> dict[str, Any]:
    method = (config.get("method") or "GET").upper()
    body_allowed = method not in {"GET", "HEAD"}
    data = config.get("data") if body_allowed else None
    files = config.get("files") if body_allowed else None

    request_kwargs: dict[str, Any] = {
        "method": method,
        "url": config["url"],
        "headers": headers,
        "timeout": _build_timeout(config),
    }

    _apply_cache_headers(headers, config)
    _apply_priority_header(headers, config)

    if files is not None:
        multipart_body, boundary = _build_multipart_payload(config, data, files)
        request_kwargs["data"] = multipart_body
        headers.pop("content-type", None)
        headers["content-type"] = f"multipart/form-data; boundary={boundary}"
    elif data is not None:
        body, content_type = _serialize_body(config, data, headers)
        request_kwargs["data"] = body
        if content_type and "content-type" not in headers:
            headers["content-type"] = content_type

    return request_kwargs


def _build_timeout(config: JadyConfig) -> float | None:
    timeout_ms = config.get("timeout")
    if timeout_ms and timeout_ms > 0:
        return timeout_ms / 1000
    return None


def _serialize_body(config: JadyConfig, data: Any, headers: dict[str, str]) -> tuple[Any, str | None]:
    if isinstance(data, (str, bytes, bytearray)):
        if isinstance(data, str):
            return data.encode("utf-8"), "text/plain; charset=utf-8"
        return bytes(data), "application/octet-stream"

    if hasattr(data, "read"):
        content = data.read()
        return content if isinstance(content, bytes) else str(content).encode("utf-8"), "application/octet-stream"

    if isinstance(data, Mapping):
        content_type = headers.get("content-type", "")
        if "application/x-www-form-urlencoded" in content_type.lower():
            from ..utils import build_url

            encoded = build_url("", data, config.get("paramsSerializer"), config.get("paramsArrayFormat"))
            return encoded.lstrip("?").encode("utf-8"), None
        return to_json_body(data, config.get("jsonReplacer")).encode("utf-8"), "application/json"

    return data, None


def _build_multipart_payload(config: JadyConfig, data: Any, files: Any) -> tuple[bytes, str]:
    if data is not None and not isinstance(data, Mapping):
        raise create_error("data must be a plain object when using files", JadyErrorCodes.ENETWORK, config)

    boundary = f"jady-{int(time.time() * 1000)}"
    body_parts: list[bytes] = []

    if isinstance(data, Mapping):
        for key, value in data.items():
            if value is None:
                continue
            values = value if isinstance(value, (list, tuple)) else [value]
            for item in compact_iterable(values):
                body_parts.append(_encode_form_field(boundary, key, _stringify_form_value(item)))

    for key, value in dict(files).items():
        items = value if isinstance(value, (list, tuple)) else [value]
        for item in compact_iterable(items):
            filename, content, content_type = _normalize_file(item)
            body_parts.append(_encode_file_field(boundary, key, filename, content, content_type))

    body_parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(body_parts), boundary


def _encode_form_field(boundary: str, key: str, value: str) -> bytes:
    return (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{key}"\r\n\r\n'
        f"{value}\r\n"
    ).encode("utf-8")


def _encode_file_field(boundary: str, key: str, filename: str, content: bytes, content_type: str) -> bytes:
    return (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{key}"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8") + content + b"\r\n"


def _stringify_form_value(value: Any) -> str:
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, Mapping):
        return json.dumps(value)
    return stringify_query_value(value, "form")


def _normalize_file(file_value: Any) -> Any:
    if isinstance(file_value, dict) and "file" in file_value:
        raw_file = file_value["file"]
        filename = file_value.get("filename") or _default_filename(raw_file)
        content_type = file_value.get("contentType") or _guess_content_type(filename)
        return (filename, _coerce_file_body(raw_file), content_type)

    if isinstance(file_value, str):
        filename = _default_filename(file_value)
        with open(file_value, "rb") as file_handle:
            return filename, file_handle.read(), _guess_content_type(filename)
    filename = _default_filename(file_value)
    return filename, _coerce_file_body(file_value), _guess_content_type(filename)


def _coerce_file_body(file_value: Any) -> bytes:
    if isinstance(file_value, (bytes, bytearray)):
        return bytes(file_value)
    if hasattr(file_value, "read"):
        content = file_value.read()
        return content if isinstance(content, bytes) else str(content).encode("utf-8")
    if isinstance(file_value, io.BytesIO):
        return file_value.getvalue()
    return str(file_value).encode("utf-8")


def _guess_content_type(filename: str) -> str:
    guessed = mimetypes.guess_type(filename)[0]
    return guessed or "application/octet-stream"


def _default_filename(file_value: Any) -> str:
    name = getattr(file_value, "name", None)
    if isinstance(name, str) and name:
        return name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    if isinstance(file_value, str) and file_value:
        return file_value.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    return "blob"


def _build_response(config: JadyConfig, response: UrllibResponse, duration: int) -> JadyResponse[Any]:
    status = response.status_code
    status_text = response.reason or ""
    response_headers = _normalize_response_headers(response)
    total = _extract_content_length(response_headers.get("content-length"))
    max_body_length = _extract_max_body_length(config)
    integrity_state = _create_integrity_state(config)
    if total is not None:
        _check_max_body_length(total, max_body_length, config)
    raw_content = b""

    body: Any
    raw_body: str | bytes | None = None
    response_type = config.get("responseType", "auto")
    encoding = config.get("responseEncoding") or _extract_charset(response_headers.get("content-type")) or "utf-8"

    if status == 204 or config.get("method", "GET").upper() == "HEAD":
        body = None
    elif response_type == "stream":
        body = ProgressReader(response.raw, config.get("onDownloadProgress"), total, max_body_length, config, integrity_state)
    elif response_type == "blob":
        raw_content = _read_response_bytes(response.raw, config.get("onDownloadProgress"), total, max_body_length, config, integrity_state)
        body = raw_content
        if config.get("saveRawBody"):
            raw_body = raw_content
    elif response_type in {"bytes", "arraybuffer"}:
        raw_content = _read_response_bytes(response.raw, config.get("onDownloadProgress"), total, max_body_length, config, integrity_state)
        body = raw_content
        if config.get("saveRawBody"):
            raw_body = raw_content
    elif response_type == "document":
        raise create_error("document responseType is not supported in Python", JadyErrorCodes.EUNKNOWN, config)
    else:
        raw_content = _read_response_bytes(response.raw, config.get("onDownloadProgress"), total, max_body_length, config, integrity_state)
        text = raw_content.decode(encoding, errors="replace")
        should_store_raw = bool(config.get("saveRawBody") or config.get("jsonReviver") or response_type in {"json", "text"})
        if should_store_raw:
            raw_body = text
        body = _parse_body(config, text, raw_content, response_type, response_headers)

    ok = config.get("validateStatus", lambda current: 200 <= current < 300)(status)
    return JadyResponse(
        status=status,
        statusText=status_text,
        headers=response_headers,
        body=body,
        rawBody=raw_body,
        config=config,
        duration=duration,
        totalDuration=duration,
        url=response.url,
        ok=ok,
        attempts=[],
        request=response.request,
    )


def _read_response_bytes(raw: Any, callback: Any, total: int | None, max_body_length: int | None, config: JadyConfig, integrity_state: list[tuple[str, Any, bytes]] | None = None) -> bytes:
    loaded = 0
    chunks: list[bytes] = []
    while True:
        chunk = raw.read(8192)
        if not chunk:
            break
        loaded += len(chunk)
        _check_max_body_length(loaded, max_body_length, config)
        _update_integrity(integrity_state, chunk)
        chunks.append(chunk)
        _notify_progress(callback, loaded, total)
    _finalize_integrity(integrity_state, config)
    return b"".join(chunks)


def _apply_cache_headers(headers: dict[str, str], config: JadyConfig) -> None:
    cache_mode = str(config.get("cache") or "default")
    if cache_mode == "default":
        return
    if cache_mode == "no-store":
        headers.setdefault("cache-control", "no-store")
        return
    if cache_mode == "reload":
        headers.setdefault("cache-control", "no-cache")
        headers.setdefault("pragma", "no-cache")
        return
    if cache_mode == "no-cache":
        headers.setdefault("cache-control", "no-cache")
        return
    if cache_mode == "force-cache":
        headers.setdefault("cache-control", "max-stale=2147483647")
        return
    if cache_mode == "only-if-cached":
        headers.setdefault("cache-control", "only-if-cached")
        return
    raise ValueError(f"Unsupported cache mode: {cache_mode}")


def _apply_priority_header(headers: dict[str, str], config: JadyConfig) -> None:
    priority = str(config.get("priority") or "auto")
    if priority == "auto":
        return
    if "priority" in headers:
        return
    if priority == "high":
        headers["priority"] = "u=0, i"
        return
    if priority == "low":
        headers["priority"] = "u=7"
        return
    raise ValueError(f"Unsupported priority: {priority}")


def _notify_progress(callback: Any, loaded: int, total: int | None) -> None:
    if not callable(callback):
        return
    try:
        callback({"loaded": loaded, "total": total})
    except Exception:
        return


def _extract_content_length(header_value: Any) -> int | None:
    if header_value is None:
        return None
    try:
        parsed = int(str(header_value))
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _extract_max_body_length(config: JadyConfig) -> int | None:
    platform = config.get("platform") or {}
    raw_value = platform.get("maxBodyLength")
    if raw_value is None:
        return None
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _check_max_body_length(current_size: int, max_body_length: int | None, config: JadyConfig) -> None:
    if max_body_length is not None and current_size > max_body_length:
        raise create_error(
            f"Content-Length {current_size} exceeds maxBodyLength {max_body_length}",
            JadyErrorCodes.ENETWORK,
            config,
        )


def _create_integrity_state(config: JadyConfig) -> list[tuple[str, Any, bytes]] | None:
    integrity = config.get("integrity")
    if not integrity:
        return None
    state: list[tuple[str, Any, bytes]] = []
    for token in str(integrity).split():
        if "-" not in token:
            continue
        algorithm, encoded_digest = token.split("-", 1)
        algorithm = algorithm.lower()
        if algorithm not in {"sha256", "sha384", "sha512"}:
            continue
        try:
            expected_digest = base64.b64decode(encoded_digest, validate=True)
        except (ValueError, binascii.Error):
            continue
        state.append((algorithm, hashlib.new(algorithm), expected_digest))
    if state:
        return state
    raise ValueError("Unsupported integrity metadata")


def _update_integrity(integrity_state: list[tuple[str, Any, bytes]] | None, chunk: bytes) -> None:
    if not integrity_state:
        return
    for _, hasher, _ in integrity_state:
        hasher.update(chunk)


def _finalize_integrity(integrity_state: list[tuple[str, Any, bytes]] | None, config: JadyConfig) -> None:
    if not integrity_state:
        return
    for _, hasher, expected_digest in integrity_state:
        if hasher.digest() == expected_digest:
            return
    raise create_error("Integrity check failed", JadyErrorCodes.ENETWORK, config)


def _parse_body(
    config: JadyConfig,
    text: str,
    raw_content: bytes,
    response_type: str,
    headers: Mapping[str, Any],
) -> Any:
    content_type = str(headers.get("content-type", ""))
    clean_text = text.lstrip("\ufeff").strip()

    if response_type == "json":
        return _parse_json(config, clean_text)
    if response_type == "text":
        return text
    if response_type == "auto":
        if "application/json" in content_type or "+json" in content_type:
            return _parse_json(config, clean_text)
        if any(content_type.startswith(prefix) or prefix in content_type for prefix in TEXT_CONTENT_TYPES):
            return text
        return raw_content
    return text


def _parse_json(config: JadyConfig, clean_text: str) -> Any:
    if clean_text == "":
        return None
    try:
        object_hook = config.get("jsonReviver") if callable(config.get("jsonReviver")) else None
        return json.loads(clean_text, object_hook=object_hook)
    except json.JSONDecodeError as exc:
        raise create_error("JSON Parse Error", JadyErrorCodes.EPARSE, config, original_error=exc) from exc


def _normalize_response_headers(response: UrllibResponse) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    header_items = response.headers.items() if hasattr(response.headers, "items") else []
    for key, value in header_items:
        lower_key = key.lower()
        headers[lower_key] = value
    if hasattr(response.headers, "get_all"):
        set_cookies = response.headers.get_all("Set-Cookie")
        if set_cookies:
            headers["set-cookie"] = set_cookies
    return headers


def _extract_charset(content_type: Any) -> str | None:
    if not content_type:
        return None
    for part in str(content_type).split(";"):
        segment = part.strip()
        if segment.lower().startswith("charset="):
            return segment.split("=", 1)[1].strip()
    return None
