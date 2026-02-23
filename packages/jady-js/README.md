# jady-call (JavaScript/TypeScript)

[![npm version](https://badge.fury.io/js/jady-call.svg)](https://badge.fury.io/js/jady-call)

`jady.call`의 공식 JavaScript/TypeScript 구현체입니다. 이 라이브러리는 `jady_call` 표준 인터페이스를 준수하여, 어떤 환경에서든 일관된 HTTP 클라이언트 경험을 제공하는 것을 목표로 합니다.

## 주요 요구사항 (Prerequisites)

### Node.js

**Node.js `v18.0.0` 이상이 필요합니다.**

이 라이브러리는 `node-fetch`와 같은 별도 의존성 없이 Node.js에 내장된 `fetch` API를 사용합니다. `fetch` API는 Node.js v18부터 안정적으로 기본 제공되므로, 하위 버전에서는 런타임 오류가 발생할 수 있습니다.

`package.json`의 `engines` 필드에도 이 요구사항이 명시되어 있습니다.

### TypeScript

이 패키지는 TypeScript로 작성되었으며 `ES2020`을 타겟으로 컴파일됩니다. 패키지를 사용하는 입장에서는 TypeScript 설치가 필요 없지만, 프로젝트에 기여하거나 소스 코드를 직접 빌드하는 경우에는 최신 버전의 TypeScript 환경이 권장됩니다.

## 설치 (Installation)

```bash
npm install jady-call
```

## 기본 사용법 (Basic Usage)

```typescript
import jadyCall, { JadyResponse } from 'jady-call';

interface User {
  id: number;
  name: string;
}

async function getUser() {
  try {
    const response: JadyResponse<User> = await jadyCall({
      url: 'https://api.example.com/users/1',
      method: 'GET',
      timeout: 5000
    });

    if (response.ok) {
      console.log('User data:', response.body); // response.body is typed as User
    } else {
      console.error(`Request failed with status: ${response.status}`);
    }
  } catch (error: any) {
    console.error('An error occurred:', error.message);
  }
}

getUser();
```

## 더 알아보기

모든 기능과 설정 옵션에 대한 자세한 내용은 프로젝트 루트의 specs 디렉토리에 있는 표준 문서를 참조하세요.