# jady.call Standard Interface

이 문서는 `jady.call`의 표준 인터페이스를 정의합니다. 모든 언어의 구현체는 이 문서에 정의된 이름과 구조를 엄격히 준수해야 합니다.

## 0. 기본 원칙 (General Principles)

- **Asynchronous**: 모든 구현체는 기본적으로 **비동기(Async)** 동작을 지향해야 합니다. (Return Promise, Future, Coroutine, etc.)
- **Stateless**: `jady.call`은 상태를 가지지 않는 순수 함수(Pure Function) 혹은 정적 메서드(Static Method)처럼 동작해야 합니다.
    - **No Cookie Jar**: 이전 요청의 `Set-Cookie`를 저장하거나 다음 요청에 자동으로 포함하지 않습니다. (브라우저의 기본 동작은 예외)

## 1. 필수로 포함되어야 할 파라미터 (The Input)

어떤 언어의 `jady.call()`이든 다음 인자들은 동일한 이름으로 존재해야 합니다.

- **baseUrl**: (Optional) 기본 URL (String).
    - `url`이 상대 경로일 경우, `baseUrl`과 결합됩니다.
    - `url`이 절대 경로(`http://...`)일 경우, `baseUrl`은 무시됩니다.
- **url**: 대상 주소 (String)
- **method**: HTTP 메서드 (String). (기본값: `GET`. 입력은 대소문자를 구분하지 않으나, 전송 시 **대문자**로 정규화됩니다.)
- **params**: (Optional) Query Parameter (Object/Dict). 표준 URL Encoding (`application/x-www-form-urlencoded`)으로 변환. (공백은 `+`로 인코딩)
    - **배열(Array/List)** 값은 키 반복(`key=v1&key=v2`) 형태로 직렬화합니다.
    - **중첩 객체(Nested Object)**는 지원하지 않습니다. (필요 시 사용자가 JSON 문자열 등으로 변환하여 전달)
    - `url`에 이미 쿼리 스트링이 존재하는 경우, `&`로 연결하여 병합합니다.
    - **Hash(#) 처리**: URL에 Hash(Fragment)가 포함된 경우, Query String은 반드시 **Hash(#) 앞**에 삽입되어야 합니다.
    - **String / Native**: 문자열이나 `URLSearchParams` 등 네이티브 객체가 전달되면, 별도 변환 없이 그대로 쿼리 스트링으로 사용합니다.
- **paramsArrayFormat**: (Optional) 배열 파라미터 직렬화 방식 (String, 기본값: `'repeat'`).
    - `'repeat'`: `key=v1&key=v2` (기본값)
    - `'brackets'`: `key[]=v1&key[]=v2`
    - `'comma'`: `key=v1,v2`
    - `'index'`: `key[0]=v1&key[1]=v2`
- **cookies**: (Optional) 요청과 함께 전송할 쿠키 객체 (Object/Dict).
    - `headers`의 `Cookie` 값과 병합됩니다.
- **data**: (Optional) Request Body (Object/Dict, String, Byte Array, Stream).
    - **GET, HEAD 메서드**: `data` 및 `files` 값이 존재하더라도 **무시(Ignored)**하고 전송하지 않습니다. (JS Fetch API 등과의 호환성 유지)
    - **Object/Dict**: 기본적으로 **JSON 직렬화** (`Content-Type: application/json` 자동 추가).
        - 예외: 헤더에 `application/x-www-form-urlencoded`가 명시된 경우, **Query String** 형태로 변환하여 전송합니다.
    - **String**: 그대로 전송 (`Content-Type` 미지정 시 `text/plain; charset=utf-8` 자동 추가).
    - **Byte Array/Buffer**: 그대로 전송 (`Content-Type` 미지정 시 `application/octet-stream` 자동 추가).
    - **Stream**: (Readable Stream, File-like Object) 메모리에 적재하지 않고 스트리밍 전송 (`Content-Type` 미지정 시 `application/octet-stream` 자동 추가).
    - **Native Objects**: `FormData`, `URLSearchParams` (JS) 등 언어별 네이티브 객체가 전달되면, 별도 변환 없이 그대로 전송하며 적절한 `Content-Type`을 자동으로 설정합니다.
- **files**: (Optional) 파일 업로드 객체 (Multipart/form-data).
    - Key: Field Name, Value: File Object / Blob / Stream / Path(Server-side only) **또는 그 배열(Array)**.
    - **고급 설정**: Value를 `{ file: ..., filename?: string, contentType?: string }` 객체로 전달하여 파일명과 타입을 명시할 수 있습니다.
    - 이 값이 존재하면 `Content-Type` 헤더는 **사용자 설정 값을 무시하고** 자동으로 `multipart/form-data; boundary=...`로 설정됩니다.
- **headers**: (Optional) HTTP 헤더 (Object/Dict).
- **timeout**: (Optional) 요청 타임아웃 (Number, ms 단위, 기본값: 5000 등 언어별 적절한 값). **(시간 초과 시 예외 발생, 0 설정 시 무제한)**
- **maxBodyLength**: (Optional) 응답 본문의 최대 크기 제한 (Number, bytes 단위). 초과 시 예외 발생. (기본값: 무제한)
- **auth**: (Optional) 인증 정보 객체.
    - Basic Auth: `{ username: 'user', password: 'pw' }`
    - Bearer Token: `{ bearer: 'token_string' }` (헤더에 `Authorization: Bearer ...` 자동 추가)
    - 주의: `headers`에 `Authorization` 값이 이미 존재하면, 이 옵션은 **무시**됩니다.
- **withCredentials**: (Optional) Cross-Origin 요청 시 쿠키/인증 헤더 포함 여부 (Boolean, 기본값: `false`). (주로 브라우저 환경용)
- **verify**: (Optional) SSL/TLS 인증서 검증 여부 (Boolean, 기본값: `true`).
- **redirect**: (Optional) 리다이렉션 처리 방식 (String, 기본값: `'follow'`).
    - `'follow'`: 3xx 응답을 자동으로 따라갑니다. (최대 10회)
    - `'error'`: 3xx 응답을 네트워크 오류로 처리합니다.
    - `'manual'`: 3xx 응답을 그대로 반환합니다. (상태 코드 확인 필요)
- **maxRedirects**: (Optional) 리다이렉트 최대 허용 횟수 (Number, 기본값: 10). (`redirect: 'follow'`일 때만 적용)
- **retry**: (Optional) 실패 시 재시도 횟수 (Number, 기본값: 0).
    - 네트워크 오류 및 5xx 응답 시 재시도합니다.
- **retryDelay**: (Optional) 재시도 간 대기 시간 (Number, ms 단위, 기본값: 0).
- **socketPath**: (Optional) Unix Domain Socket 경로 (String). (설정 시 `url`의 호스트 부분은 무시됨. 예: `/var/run/docker.sock`)
- **proxy**: (Optional) 프록시 서버 주소 (String). (예: `http://user:pass@proxy.com:8080`)
    - 주의: 브라우저 환경에서는 보안 정책상 무시될 수 있습니다.
- **ssl**: (Optional) SSL/TLS 설정 객체 (Browser 환경에서는 무시됨).
    - `ca`: 커스텀 CA 인증서 (String/Buffer).
    - `cert`: 클라이언트 인증서 (String/Buffer).
    - `key`: 클라이언트 개인키 (String/Buffer).
    - `passphrase`: 개인키 비밀번호 (String).
- **responseType**: (Optional) 응답 데이터의 타입 지정 (String, 기본값: `'auto'`).
    - `'auto'`: `Content-Type`에 따라 JSON, Text, Binary 자동 처리.
    - `'json'`: 강제로 JSON 파싱 시도.
    - `'text'`: 강제로 텍스트로 반환.
    - `'bytes'`: Binary Data (Buffer/Bytes)로 반환.
    - `'stream'`: 스트림(Stream) 객체로 반환. (대용량 파일 처리 시 필수)
- **responseEncoding**: (Optional) 응답 텍스트 디코딩 시 사용할 인코딩 (String, 기본값: `'utf-8'`).
    - `responseType`이 `'text'`이거나 `'auto'`(텍스트로 판별됨)일 때 적용됩니다.
    - 예: `'euc-kr'`, `'windows-1252'`
- **decompress**: (Optional) 응답 본문 자동 압축 해제 여부 (Boolean, 기본값: `true`).
    - `false`로 설정 시, 압축된 바이너리 데이터가 그대로 `body`에 반환됩니다. (다운로드 등에 사용)
- **xsrfCookieName**: (Optional) CSRF 토큰을 읽어올 쿠키 이름 (String, 기본값: `'XSRF-TOKEN'`). (브라우저 환경 전용)
- **xsrfHeaderName**: (Optional) CSRF 토큰을 담을 헤더 이름 (String, 기본값: `'X-XSRF-TOKEN'`). (브라우저 환경 전용)
- **validateStatus**: (Optional) 성공(`ok: true`)으로 간주할 상태 코드 범위 지정 함수.
    - 기본값: `(status) => status >= 200 && status < 300`
- **keepAlive**: (Optional) HTTP Keep-Alive 활성화 여부 (Boolean, 기본값: `true`). (성능 최적화)
- **cache**: (Optional) 캐시 정책 (String, 기본값: `'default'`).
    - `'default'`, `'no-store'`, `'reload'`, `'no-cache'`, `'force-cache'`, `'only-if-cached'` (Fetch API 표준 준수)
- **signal**: (Optional) 요청 취소를 위한 시그널 객체. (JS: `AbortSignal`, Python/Java: Cancellation Token/Context 등 언어별 표준 취소 메커니즘 매핑)
- **onUploadProgress**: (Optional) 업로드 진행률 콜백 함수. `(progressEvent) => void`
    - `progressEvent`: `{ loaded: number, total?: number }`
- **onDownloadProgress**: (Optional) 다운로드 진행률 콜백 함수. `(progressEvent) => void`

## 2. 표준 응답 구조 (The Output)

반환값 역시 언어에 상관없이 동일한 객체 구조를 가져야 합니다.

- **status**: HTTP 상태 코드 (Number)
- **statusText**: HTTP 상태 메시지 (String). (예: "OK", "Not Found")
- **url**: 최종 응답 URL (String). (리다이렉트가 발생한 경우 리다이렉트 된 최종 주소)
- **body**: 실제 응답 데이터.
    - `responseType` 설정이 최우선으로 적용됩니다.
    - **HEAD 요청**: `body`는 항상 **`null`**입니다.
    - **자동 압축 해제(Decompression)**: `decompress: true`(기본값)일 경우, Gzip, Deflate, Brotli 등으로 압축된 응답은 자동으로 해제된 후 처리됩니다.
    - JSON 응답 (`application/json`): **Object/Dict**로 자동 파싱. **(파싱 실패 시 Raw String 반환)**
    - 텍스트 응답 (`text/*`): **String**. (인코딩은 `Content-Type` 헤더를 따르며, 명시되지 않은 경우 **UTF-8**을 기본으로 사용)
    - 상태 코드 204 (No Content): **null**.
    - Stream 응답 (`responseType: 'stream'`): 언어별 **Readable Stream** 객체. (사용자가 직접 스트림을 닫거나 소비해야 합니다)
    - 그 외 (이미지, 바이너리 등): **Byte Array / Buffer**.
- **headers**: 응답 헤더 (Object). **모든 Key는 소문자(lowercase)로 정규화**됩니다.
    - 기본값: **String** (여러 값인 경우 `, `로 결합).
    - 예외: **`set-cookie`**는 **String[] (배열)** 형태로 반환해야 합니다. (쿠키 파싱 및 세션 관리를 위함. 단, 브라우저 환경에서는 보안상 접근 불가할 수 있음)
- **ok**: 성공 여부 (Boolean, 200~299 사이면 true)

## 3. 에러 처리 (Error Handling)

- **네트워크 오류**: DNS 조회 실패, 연결 거부 등 아예 응답을 받지 못한 경우는 **예외(Exception)**를 발생시켜야 합니다.
- **HTTP 오류**: 4xx, 5xx 응답은 예외가 아니라 정상 응답으로 간주하며, `ok: false`와 해당 `status`를 반환합니다.

## 4. 타입 지원 (Type Support - 권장사항)

- **Generics**: TypeScript, Java, Go 등 정적 타입 언어에서는 `body`의 타입을 추론할 수 있도록 제네릭(Generics) 인터페이스를 제공하는 것을 권장합니다.
  - 예: `jady.call<MyResponse>(...)`

## 5. 데이터 처리 규칙 (Data Handling Rules)

- **Query Parameters (`params`)**:
    - `null`, `undefined`: **제외(Omit)**합니다.
    - **빈 배열(`[]`)**: **제외(Omit)**합니다.
    - **배열 내부**의 `null`, `undefined` 값도 **제외**합니다. (예: `[1, null, 2]` -> `key=1&key=2`)
    - **Date 객체**: **ISO 8601** 문자열로 변환합니다.
    - **Number**: 문자열로 변환합니다. (예: `123` -> `"123"`)
    - `true`, `false`: 문자열 `"true"`, `"false"`로 변환합니다.
- **JSON Body (`data`)**:
    - `undefined`: **제외(Omit)**합니다.
    - `null`: **`null` 값 그대로 전송**합니다. (DB 필드 초기화 등의 목적)
    - **Large Integer (JS)**: JavaScript 환경에서 64-bit 정수(BigInt)는 `JSON.parse` 시 정밀도 손실이 발생할 수 있습니다. 이 경우 `responseType: 'text'` 사용을 권장합니다.
- **Headers (`headers`)**:
    - `null`, `undefined`: **제외(Omit)**합니다.
    - **배열(Array)** 값: 쉼표(`,`)로 이어 붙여 하나의 문자열로 만듭니다. (예: `['a', 'b']` -> `"a,b"`)
    - **Boolean 값**: 소문자 문자열 `"true"`, `"false"`로 변환합니다. (언어별 `True`/`true` 차이 제거)
    - 그 외의 값: **문자열(String)**로 변환하여 전송합니다.
    - **Key 매칭**: 내부 로직에서 헤더를 확인할 때(예: `Content-Type`), **대소문자를 구분하지 않고(Case-insensitive)** 처리해야 합니다.

- **Multipart Body (`data` + `files`)**:
    - `files`가 존재하여 `multipart/form-data`로 전송되는 경우, `data` 필드의 처리 규칙:
        - **배열(Array)**: 동일한 Key로 여러 필드를 전송합니다. (예: `tags: ['a', 'b']` -> `tags=a`, `tags=b`)
        - **Date 객체**: **ISO 8601** 문자열로 변환하여 전송합니다.
        - **Boolean 값**: 소문자 문자열 `"true"`, `"false"`로 변환하여 전송합니다.
        - **객체(Object)**: JSON 문자열로 변환하여 전송합니다.
        - 그 외: 문자열로 변환하여 전송합니다.

## 6. 환경 및 기본값 (Environment & Defaults)

- **System Proxy**: `proxy` 옵션이 지정되지 않은 경우, 시스템 환경 변수(`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`)를 자동으로 감지하여 적용해야 합니다. (브라우저 환경 제외)
- **Default Headers**:
    - **Accept**: 명시되지 않은 경우 `application/json, text/plain, */*`을 기본으로 전송합니다. (브라우저 환경 제외)
    - **User-Agent**: `jady-call` 식별자를 포함하는 것을 권장합니다. (브라우저 환경 제외)