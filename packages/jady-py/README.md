# jady-call (Python)

Official Python implementation of `jady.call`.

This package keeps the same config surface as `jady-js`, but it is implemented on Python's standard library `urllib` stack instead of a third-party HTTP client.

It is intended for teams that want the same request config shape and response contract across JavaScript and Python without introducing language-specific HTTP client APIs.

## Installation

```bash
pip install jady-call
```

## Basic Usage

```python
from jady_call import call

response = call({
    "url": "https://api.example.com/users/1",
    "timeout": 5000,
})

print(response.status)
print(response.body)
print(response.data)
```

## Error Handling

```python
from jady_call import JadyError, call

try:
    response = call({
        "url": "https://api.example.com/users/1",
        "timeout": 3000,
        "retry": 1,
    })

    if response.ok:
        print(response.body)
    else:
        print(response.status, response.statusText)
except JadyError as error:
    print(error.code)
    print(str(error))
```

## Instance Usage

```python
from jady_call import create

api = create({
    "baseUrl": "https://api.example.com",
    "headers": {"Authorization": "Bearer token"},
})

response = api.get("/users")
```

## Advanced Examples

### Path Params And Query Params

```python
from jady_call import call

response = call({
    "baseUrl": "https://api.example.com",
    "url": "/users/{userId}/posts/:postId",
    "path": {"userId": 123, "postId": "abc"},
    "params": {"expand": ["author", "comments"]},
    "paramsArrayFormat": "comma",
})
```

### Stream Response

```python
from jady_call import call

response = call({
    "url": "https://example.com/archive.tar",
    "responseType": "stream",
})

with open("archive.tar", "wb") as file_handle:
    while True:
        chunk = response.body.read(8192)
        if not chunk:
            break
        file_handle.write(chunk)

response.body.close()
```

### Integrity And Progress

```python
from jady_call import call

def on_progress(event: dict) -> None:
    print(event["loaded"], event.get("total"))

response = call({
    "url": "https://example.com/file.bin",
    "responseType": "bytes",
    "integrity": "sha256-<base64-digest>",
    "onDownloadProgress": on_progress,
    "platform": {"maxBodyLength": 5 * 1024 * 1024},
})
```

### Manual Cookies And XSRF

```python
from jady_call import call

response = call({
    "url": "https://api.example.com/protected",
    "method": "POST",
    "cookieMode": "manual",
    "platform": {
        "cookies": {
            "session": "abc123",
            "XSRF-TOKEN": "csrf-token",
        }
    },
})
```

## Supported Parity

- Same public API shape as `jady-js`: `call`, `create`, and method helpers.
- Standard request building: `baseUrl`, `path`, `params`, `paramsArrayFormat`, `paramsSerializer`, auth, headers, timeout, redirect, retry.
- Standard response shape: `status`, `statusText`, `duration`, `totalDuration`, `url`, `attempts`, `headers`, `body`, `rawBody`, `ok`, `request`.
- Response handling: `json`, `text`, `bytes`, `arraybuffer`, `stream`, `blob` aliases.
- Best-effort fetch option support: `cache`, `priority`, `integrity`, `xsrfCookieName`, `xsrfHeaderName`.
- Progress and limits: `onDownloadProgress`, `platform.maxBodyLength`.

## Packaging Notes

- Distribution name: `jady-call`
- Import name: `jady_call`
- Python requirement: `>=3.10`
- Runtime dependency policy: standard library only

## Stdlib Notes

- `cache` is translated to request cache headers. Python stdlib does not provide a fetch-style HTTP cache.
- `priority` is translated to a `Priority` request header when set to `high` or `low`. Runtime scheduling semantics are not controlled by `urllib`.
- `integrity` verifies response bytes for `sha256`, `sha384`, and `sha512` metadata.
- XSRF support is applied on unsafe methods by reading from the existing `cookie` header or `platform.cookies` in manual-cookie flows.
- `saveRawBody` preserves original bytes for binary response types and original text for text-decoded response types.

## Current Limitations

- `responseType: "document"` is not supported and raises an error.
- `timings` phase breakdown (`dns`, `connect`, `send`, `wait`, `receive`) is not exposed by `urllib`, so it is not populated.
- `onUploadProgress` is not currently available with the stdlib adapter.
- Browser-only semantics such as `cookieMode: "browser"` and full fetch cache behavior cannot be reproduced exactly in Python stdlib.

## Development

```bash
python -m pip install -e .[dev]
python -m pytest
python -m build
```

See the repository `specs/` directory for the standard interface documents.
