# jady_call
make all REST API integrated

## Project Structure (Monorepo)

이 레포지토리는 여러 언어의 `jady.call` 라이브러리를 관리하는 모노레포 구조를 따릅니다.

```plaintext
jady_call/
├── specs/              # [중요] 모든 언어가 준수해야 할 표준 문서
│   └── interface.md    
├── packages/           # 언어별 실제 구현체
│   ├── jady-js/        # JavaScript/TypeScript용 jady.call
│   ├── jady-py/        # Python용 jady.call
│   └── jady-java/      # Java용 jady.call
└── README.md
```
