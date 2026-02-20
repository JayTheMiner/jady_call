# jady_call
**Standardized HTTP Client Interface for Polyglot Environments**

`jady.call`은 언어와 플랫폼에 상관없이 동일한 설정(Config)으로 동일한 동작과 결과를 보장하는 것을 목표로 하는 HTTP 클라이언트 표준 인터페이스 및 구현체입니다.

## Core Principles

*   **Semantic Consistency**: 모든 언어에서 동일한 Input/Output 구조 보장
*   **Stateless**: 쿠키 저장소 등을 내부적으로 유지하지 않는 순수 함수 지향
*   **Fail Fast**: 잘못된 설정에 대해 즉시 예외 발생
*   **Developer Experience**: 직관적인 API와 명확한 에러 처리

## Project Structure (Monorepo)

이 레포지토리는 여러 언어의 `jady.call` 라이브러리를 관리하는 모노레포 구조를 따릅니다.

```plaintext
jady_call/
├── specs/                  # [중요] 모든 언어가 준수해야 할 표준 문서
│   ├── 0.GeneralPrinciples.md
│   ├── 1.TheInput.md
│   ├── 2.TheOutput.md
│   ├── 3.ErrorHandling.md
│   ├── 4.TypeSupport.md
│   ├── 5.DataHandlingRules.md
│   └── interface.md
├── packages/           # 언어별 실제 구현체
│   ├── jady-js/        # JavaScript/TypeScript용 jady.call
│   ├── jady-py/        # Python용 jady.call
│   └── jady-java/      # Java용 jady.call
└── README.md
```
