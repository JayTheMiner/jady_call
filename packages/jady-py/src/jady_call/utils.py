from __future__ import annotations

import copy
import json
import math
import re
import uuid
from datetime import date, datetime, timezone
from email.utils import format_datetime, parsedate_to_datetime
from typing import Any, Iterable, Mapping
from urllib.parse import quote, quote_plus

from .types import JadyConfig, JadyError, JadyErrorCodes, JadyResponse


def is_date(value: Any) -> bool:
    return isinstance(value, (datetime, date))


def is_plain_object(value: Any) -> bool:
    return isinstance(value, dict)


def combine_urls(base_url: str, relative_url: str) -> str:
    if not relative_url:
        return base_url
    return base_url.rstrip("/") + "/" + relative_url.lstrip("/")


def is_absolute_url(url: str) -> bool:
    return bool(re.match(r"^([a-z][a-z\d+\-.]*:)?//", url, re.IGNORECASE))


def build_full_path(base_url: str | None, requested_url: str | None) -> str:
    if base_url and not is_absolute_url(requested_url or ""):
        return combine_urls(base_url, requested_url or "")
    return requested_url or ""


def merge_config(config1: Mapping[str, Any] | None, config2: Mapping[str, Any] | None) -> dict[str, Any]:
    result = copy.deepcopy(dict(config1 or {}))
    for key, value in dict(config2 or {}).items():
        if is_plain_object(value) and is_plain_object(result.get(key)):
            result[key] = merge_config(result[key], value)
        else:
            result[key] = value
    return result


def encode_component(value: str) -> str:
    return quote_plus(value, safe=":$,[]")


def substitute_path(url: str, path_params: Mapping[str, Any] | None) -> str:
    if not path_params:
        return url
    new_url = url
    for key, value in path_params.items():
        encoded = quote(str(value), safe="")
        new_url = re.sub(rf"\{{{re.escape(key)}\}}|:{re.escape(key)}\b", encoded, new_url)
    return new_url


def stringify_query_value(value: Any, key: str) -> str:
    if is_date(value):
        if isinstance(value, date) and not isinstance(value, datetime):
            value = datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
        if isinstance(value, datetime) and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, dict):
        raise ValueError(f"Nested object in params is not supported: {key}")
    return str(value).lower() if isinstance(value, bool) else str(value)


def build_url(
    url: str,
    params: Any = None,
    params_serializer: Any = None,
    params_array_format: str | None = None,
) -> str:
    if params is None:
        return url

    serialized: str | None
    if params_serializer is not None:
        serialized = params_serializer(params)
        if serialized.startswith("?"):
            serialized = serialized[1:]
    elif isinstance(params, str):
        serialized = params.lstrip("?")
    else:
        if not isinstance(params, Mapping):
            raise ValueError("params must be a mapping, string, or serializer-supported object")
        parts: list[str] = []
        for key, raw_value in params.items():
            if raw_value is None:
                continue
            if isinstance(raw_value, (list, tuple)):
                values = [item for item in raw_value if item is not None]
                if not values:
                    continue
                format_name = params_array_format or "repeat"
                if format_name == "comma":
                    serialized_values = [stringify_query_value(item, key) for item in values]
                    parts.append(f"{encode_component(str(key))}={encode_component(','.join(serialized_values))}")
                    continue
                index_counter = 0
                for item in values:
                    current_key = str(key)
                    if format_name == "brackets":
                        current_key = f"{key}[]"
                    elif format_name == "index":
                        current_key = f"{key}[{index_counter}]"
                        index_counter += 1
                    stringified = stringify_query_value(item, key)
                    parts.append(f"{encode_component(current_key)}={encode_component(stringified)}")
                continue
            stringified = stringify_query_value(raw_value, str(key))
            parts.append(f"{encode_component(str(key))}={encode_component(stringified)}")
        serialized = "&".join(parts)

    if not serialized:
        return url

    hash_part = ""
    if "#" in url:
        url, hash_part = url.split("#", 1)
        hash_part = "#" + hash_part

    separator = "&" if "?" in url else "?"
    return f"{url}{separator}{serialized}{hash_part}"


def _http_date(value: datetime | date) -> str:
    if isinstance(value, date) and not isinstance(value, datetime):
        value = datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return format_datetime(value.astimezone(timezone.utc), usegmt=True)


def process_headers(headers: Mapping[str, Any] | None) -> dict[str, str]:
    normalized: dict[str, str] = {}
    if not headers:
        return normalized

    token_pattern = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
    for key, value in headers.items():
        if not key:
            continue
        if not token_pattern.match(key):
            raise ValueError(f'Invalid header name: "{key}"')
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            separator = "; " if key.lower() == "cookie" else ","
            string_value = separator.join(_stringify_header_value(item) for item in value)
        else:
            string_value = _stringify_header_value(value)
        if "\r" in string_value or "\n" in string_value:
            raise ValueError(f'Invalid header value for "{key}"')
        normalized[key.lower()] = string_value
    return normalized


def _stringify_header_value(value: Any) -> str:
    if isinstance(value, bool):
        return str(value).lower()
    if is_date(value):
        return _http_date(value)
    return str(value)


def parse_cookie(cookie_string: str, name: str) -> str | None:
    if not cookie_string:
        return None
    match = re.search(rf"(^|;\s*){re.escape(name)}=([^;]*)", cookie_string)
    return match.group(2) if match else None


def parse_retry_after(value: str | None) -> int | None:
    if not value:
        return None
    value = value.strip()
    if value.isdigit():
        return int(value) * 1000
    try:
        target = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return None
    if target.tzinfo is None:
        target = target.replace(tzinfo=timezone.utc)
    delta = int((target - datetime.now(timezone.utc)).total_seconds() * 1000)
    return max(delta, 0)


def generate_request_id() -> str:
    return str(uuid.uuid4())


def create_error(
    message: str,
    code: str,
    config: JadyConfig,
    response: JadyResponse[Any] | None = None,
    original_error: BaseException | None = None,
) -> JadyError:
    return JadyError(message, code, config, response=response, cause=original_error)


def to_json_body(value: Any, json_replacer: Any = None) -> str:
    def default_handler(item: Any) -> Any:
        if isinstance(item, float) and (math.isnan(item) or math.isinf(item)):
            return None
        if is_date(item):
            return stringify_query_value(item, "json")
        if callable(json_replacer):
            return json_replacer(item)
        raise TypeError(f"Object of type {type(item).__name__} is not JSON serializable")

    return json.dumps(value, default=default_handler, allow_nan=False)


def compact_iterable(values: Iterable[Any]) -> list[Any]:
    return [value for value in values if value is not None]


def is_signal_aborted(signal: Any) -> bool:
    if signal is None:
        return False
    aborted = getattr(signal, "aborted", None)
    if isinstance(aborted, bool):
        return aborted
    is_set = getattr(signal, "is_set", None)
    if callable(is_set):
        try:
            return bool(is_set())
        except TypeError:
            return False
    cancelled = getattr(signal, "cancelled", None)
    if callable(cancelled):
        return bool(cancelled())
    if isinstance(cancelled, bool):
        return cancelled
    return False
