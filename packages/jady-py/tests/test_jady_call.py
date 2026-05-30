from __future__ import annotations

import base64
import hashlib
import io
from dataclasses import dataclass
from email.message import Message
from threading import Event
from typing import Any
from unittest.mock import patch
import urllib.error

import pytest

from jady_call import JadyError, call, create


@dataclass
class MockPreparedRequest:
    method: str
    url: str = ""
    headers: dict[str, str] | None = None


class MockResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        headers: dict[str, Any] | None = None,
        content: bytes = b"",
        url: str = "https://api.example.com/resource",
        reason: str = "OK",
        request: MockPreparedRequest | None = None,
    ) -> None:
        self.status = status_code
        self.headers = Message()
        for key, value in (headers or {}).items():
            self.headers[key] = value
        self.content = content
        self.url = url
        self.reason = reason
        self.request = request or MockPreparedRequest(method="GET", url=url, headers={})
        self.raw = io.BytesIO(content)

    def read(self, size: int = -1) -> bytes:
        return self.raw.read(size)

    def geturl(self) -> str:
        return self.url

    def getcode(self) -> int:
        return self.status

    def close(self) -> None:
        return None


def capture_request(request: Any) -> dict[str, Any]:
    headers: dict[str, str] = {}
    for source in (getattr(request, "headers", {}), getattr(request, "unredirected_hdrs", {})):
        for key, value in source.items():
            headers[str(key).lower()] = value
    return {
        "full_url": request.full_url,
        "method": request.get_method(),
        "headers": headers,
        "data": request.data,
    }


def test_basic_get_request() -> None:
    captured: dict[str, Any] = {}

    def fake_request(request: Any, timeout: float | None = None) -> MockResponse:
        captured.update(capture_request(request))
        captured["timeout"] = timeout
        return MockResponse(
            headers={"content-type": "application/json"},
            content=b'{"data":"success"}',
            url=request.full_url,
        )

    with patch("urllib.request.OpenerDirector.open", side_effect=fake_request):
        response = call({"url": "https://api.example.com/users"})

    assert response.status == 200
    assert response.body == {"data": "success"}
    assert response.data == response.body
    assert captured["method"] == "GET"
    assert captured["full_url"] == "https://api.example.com/users"


def test_post_json_body() -> None:
    captured: dict[str, Any] = {}

    def fake_request(request: Any, timeout: float | None = None) -> MockResponse:
        captured.update(capture_request(request))
        captured["timeout"] = timeout
        return MockResponse(
            status_code=201,
            headers={"content-type": "application/json"},
            content=b'{"created":true}',
            url=request.full_url,
            reason="Created",
            request=MockPreparedRequest(method="POST", url=request.full_url, headers=captured["headers"]),
        )

    with patch("urllib.request.OpenerDirector.open", side_effect=fake_request):
        response = call(
            {
                "url": "https://api.example.com/users",
                "method": "POST",
                "data": {"name": "jady", "version": 1},
            }
        )

    assert response.status == 201
    assert captured["headers"]["content-type"] == "application/json"
    assert captured["data"] == b'{"name": "jady", "version": 1}'


def test_path_and_query_params() -> None:
    captured: dict[str, Any] = {}

    def fake_request(request: Any, timeout: float | None = None) -> MockResponse:
        captured.update(capture_request(request))
        return MockResponse(url=request.full_url)

    with patch("urllib.request.OpenerDirector.open", side_effect=fake_request):
        call(
            {
                "url": "https://api.example.com/users/{id}/posts/:postId",
                "path": {"id": 123, "postId": "abc"},
                "params": {"q": "hello world", "filters": ["a", None, "b"]},
                "paramsArrayFormat": "comma",
            }
        )

    assert captured["full_url"] == "https://api.example.com/users/123/posts/abc?q=hello+world&filters=a,b"


def test_create_instance_with_defaults_and_auth() -> None:
    captured: dict[str, Any] = {}

    def fake_request(request: Any, timeout: float | None = None) -> MockResponse:
        captured.update(capture_request(request))
        return MockResponse(url=request.full_url)

    api = create({"baseUrl": "https://api.base.com", "headers": {"Authorization": "Bearer token"}})
    with patch("urllib.request.OpenerDirector.open", side_effect=fake_request):
        api.get("/endpoint")

    assert captured["full_url"] == "https://api.base.com/endpoint"
    assert captured["headers"]["authorization"] == "Bearer token"


def test_retry_on_500() -> None:
    calls = 0

    def fake_request(request: Any, timeout: float | None = None) -> MockResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            return MockResponse(
                status_code=500,
                headers={"content-type": "text/plain"},
                content=b"Server Error",
                url=request.full_url,
                reason="Server Error",
            )
        return MockResponse(
            headers={"content-type": "application/json"},
            content=b'{"success":true}',
            url=request.full_url,
        )

    with patch("urllib.request.OpenerDirector.open", side_effect=fake_request):
        response = call({"url": "https://api.example.com/flaky", "retry": 1, "retryDelay": 0})

    assert response.status == 200
    assert calls == 2


def test_redirect_changes_post_to_get() -> None:
    urls: list[tuple[str, str, Any]] = []
    calls = 0

    def fake_request(request: Any, timeout: float | None = None) -> MockResponse:
        nonlocal calls
        calls += 1
        urls.append((request.full_url, request.get_method(), request.data))
        if calls == 1:
            redirect_response = MockResponse(
                status_code=301,
                headers={"location": "https://api.example.com/new-location"},
                url=request.full_url,
                reason="Moved Permanently",
                request=MockPreparedRequest(method="POST", url=request.full_url, headers=dict(request.header_items())),
            )
            raise urllib.error.HTTPError(request.full_url, 301, "Moved Permanently", redirect_response.headers, redirect_response)
        return MockResponse(
            headers={"content-type": "application/json"},
            content=b'{"success":true}',
            url=request.full_url,
        )

    with patch("urllib.request.OpenerDirector.open", side_effect=fake_request):
        response = call(
            {
                "url": "https://api.example.com/create",
                "method": "POST",
                "data": {"some": "data"},
            }
        )

    assert response.body == {"success": True}
    assert urls[1][0] == "https://api.example.com/new-location"
    assert urls[1][1] == "GET"
    assert urls[1][2] is None


def test_timeout_maps_to_standard_error() -> None:
    with patch("urllib.request.OpenerDirector.open", side_effect=TimeoutError("boom")):
        with pytest.raises(JadyError) as exc:
            call({"url": "https://timeout.test", "timeout": 1000})

    assert exc.value.code == "ETIMEDOUT"


def test_signal_cancellation_before_request() -> None:
    signal = Event()
    signal.set()

    with pytest.raises(JadyError) as exc:
        call({"url": "https://api.example.com/cancel", "signal": signal})

    assert exc.value.code == "ECANCELED"


def test_save_raw_body() -> None:
    def fake_request(request: Any, timeout: float | None = None) -> MockResponse:
        return MockResponse(
            headers={"content-type": "application/json"},
            content=b'{"data":"raw"}',
            url=request.full_url,
        )

    with patch("urllib.request.OpenerDirector.open", side_effect=fake_request):
        response = call({"url": "https://api.example.com/raw", "saveRawBody": True, "responseType": "json"})

    assert response.body == {"data": "raw"}
    assert response.rawBody == '{"data":"raw"}'


def test_stream_response_keeps_readable_body() -> None:
    def fake_request(request: Any, timeout: float | None = None) -> MockResponse:
        return MockResponse(
            headers={"content-type": "application/octet-stream"},
            content=b"stream-data",
            url=request.full_url,
        )

    with patch("urllib.request.OpenerDirector.open", side_effect=fake_request):
        response = call({"url": "https://api.example.com/stream", "responseType": "stream"})

    assert response.body.read() == b"stream-data"


def test_download_progress_and_max_body_length() -> None:
    progress_events: list[dict[str, int | None]] = []

    def fake_request(request: Any, timeout: float | None = None) -> MockResponse:
        return MockResponse(
            headers={"content-type": "application/octet-stream", "content-length": "4"},
            content=b"data",
            url=request.full_url,
        )

    with patch("urllib.request.OpenerDirector.open", side_effect=fake_request):
        response = call(
            {
                "url": "https://api.example.com/progress",
                "responseType": "bytes",
                "onDownloadProgress": progress_events.append,
            }
        )

    assert response.body == b"data"
    assert progress_events[-1] == {"loaded": 4, "total": 4}

    with patch("urllib.request.OpenerDirector.open", side_effect=fake_request):
        with pytest.raises(JadyError) as exc:
            call(
                {
                    "url": "https://api.example.com/progress",
                    "responseType": "bytes",
                    "platform": {"maxBodyLength": 3},
                }
            )

    assert exc.value.code == "ENETWORK"


def test_xsrf_cache_and_priority_headers() -> None:
    captured: dict[str, Any] = {}

    def fake_request(request: Any, timeout: float | None = None) -> MockResponse:
        captured.update(capture_request(request))
        return MockResponse(url=request.full_url)

    with patch("urllib.request.OpenerDirector.open", side_effect=fake_request):
        call(
            {
                "url": "https://api.example.com/protected",
                "method": "POST",
                "cookieMode": "manual",
                "platform": {"cookies": {"XSRF-TOKEN": "csrf-token"}},
                "cache": "reload",
                "priority": "high",
            }
        )

    assert captured["headers"]["x-xsrf-token"] == "csrf-token"
    assert captured["headers"]["cache-control"] == "no-cache"
    assert captured["headers"]["pragma"] == "no-cache"
    assert captured["headers"]["priority"] == "u=0, i"


def test_integrity_verification() -> None:
    body = b"integrity-body"
    digest = base64.b64encode(hashlib.sha256(body).digest()).decode("ascii")

    def fake_request(request: Any, timeout: float | None = None) -> MockResponse:
        return MockResponse(
            headers={"content-type": "application/octet-stream", "content-length": str(len(body))},
            content=body,
            url=request.full_url,
        )

    with patch("urllib.request.OpenerDirector.open", side_effect=fake_request):
        response = call(
            {
                "url": "https://api.example.com/integrity",
                "responseType": "bytes",
                "integrity": f"sha256-{digest}",
            }
        )

    assert response.body == body

    with patch("urllib.request.OpenerDirector.open", side_effect=fake_request):
        with pytest.raises(JadyError) as exc:
            call(
                {
                    "url": "https://api.example.com/integrity",
                    "responseType": "bytes",
                    "integrity": "sha256-AAAAAAAAAAAAAAAAAAAAAA==",
                }
            )

    assert exc.value.code == "ENETWORK"


def test_save_raw_body_for_binary_response() -> None:
    body = b"\x00\x01\x02binary"

    def fake_request(request: Any, timeout: float | None = None) -> MockResponse:
        return MockResponse(
            headers={"content-type": "application/octet-stream", "content-length": str(len(body))},
            content=body,
            url=request.full_url,
        )

    with patch("urllib.request.OpenerDirector.open", side_effect=fake_request):
        response = call(
            {
                "url": "https://api.example.com/binary",
                "responseType": "bytes",
                "saveRawBody": True,
            }
        )

    assert response.body == body
    assert response.rawBody == body
