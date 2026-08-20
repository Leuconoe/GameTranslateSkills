# 타이틀 작업공간·기능 경계 계약

모든 생성·수정·임시 출력은 플랫폼 원본(NSW의 NSP/XCI 또는 Steam/PC의 실제 게임 EXE)이 직접 있는 타이틀 루트의
`<TITLE_ROOT>/_work/<PROJECT_ID>/` 안에서만 이루어진다. 저장소, `$GT_TOOLS`, OS 임시 폴더, 공용 MCP
폴더, 타이틀 루트 직속 위치나 다른 `_work` 프로젝트는 출력 경로가 아니다.

## 기능별 write root

| stage | 허용 출력 root |
|---|---|
| `source` | `00_source/` |
| `extract` | `10_extract/`, `90_tools/work/extract/` |
| `reference` | `20_reference/` |
| `translation` | `30_translation/`, `90_tools/work/translation/` |
| `build` | `40_build/`, `90_tools/work/build/` |
| `test` | `50_test/`, `90_tools/scripts/test/`, `90_tools/work/test/` |
| `tools` | `90_tools/` |

한 기능의 출력물을 다른 단계 root에 편의상 두지 않는다. export·번역 중간물·테스트
산출물/스크립트는 이 경계에 더해 `artifact-layout-contract.md`의 세부 class root와
`PROJECT_ARTIFACT_MANIFEST.tsv` 계약도 통과해야 한다.

## 실행 전 출력 경로 assertion

파일을 쓰는 명령을 실행하기 전에 모든 output/temp/cache 경로를 반복해서 검사한다.

```text
npm run project:boundary -- --project-root "<타이틀 루트>/_work/<PROJECT_ID>" \
  --stage <stage> --assert-output "<출력 경로>" [--assert-output "<추가 경로>"]
```

- project root는 real directory여야 하고 NSW는 `_work/<16-hex>`, Steam은
  `_work/steam-<APP_ID>`, 다른 PC 배포판은 `_work/pc-<safe-slug>` 형태여야 한다.
- 상대 출력은 project root 기준으로 해석한다.
- 절대·상대 경로 모두 resolve 후 project root 안이고 해당 stage root 아래여야 한다.
- 존재하는 어느 ancestor에도 symlink/junction/reparse point가 없어야 한다.
- 도구의 기본 출력 위치가 불명확하면 실행하지 않고 명시적 output 옵션을 먼저 찾는다.
- `%TEMP%`가 필요한 도구에는 프로젝트 내부 `90_tools/work/<stage>/tmp-*`를 명시적으로
  전달한다. 환경변수나 CWD fallback에 의존하지 않는다.

## 기존 구조 감사

NSW 검증기는 타이틀 루트의 원본 NSP/XCI·`_work`·기존 `HANDOFF.md` 외 항목을 엄격히
검사한다. Steam/PC 설치 루트는 배포처가 관리하는 게임 파일을 허용하되 그 경로를 output으로
사용하지 않는다. 모든 플랫폼에서 `_work`의 미분류 파일, 프로젝트 root의 비표준 단계 폴더,
프로젝트 내부 link를 fail-closed로
보고한다. 기존 legacy 경로는 자동 이동·rename·삭제하지 않는다. exact child inventory와
manifest 등록·hash 검증을 완료한 후 별도 마이그레이션한다.
