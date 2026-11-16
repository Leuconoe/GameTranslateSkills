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

## 워크스페이스 최상위 구역

프로젝트 내부 경계와 별개로, `$GT_WORKSPACE` 최상위도 구역이 고정되어 있다. 파일을 쓰기 전에 출력 경로를
절대 경로로 확정하고 아래 구역 중 하나인지 확인한다.

| 구역 | 경로 | 넣는 것 |
|---|---|---|
| 타이틀 작업 | `_titles/<상태 폴더>/<타이틀 루트>/_work/<PROJECT_ID>/` (상태 폴더는 아래 **타이틀 상태 폴더** 참고) | 위 기능별 write root 산출물. 런타임 캡처는 `50_test/` 아래 |
| 공용 도구 | `_tools/` | 여러 타이틀이 함께 쓰는 도구·에뮬레이터·MCP 세션. 게임 산출물은 두지 않음 |
| 업로드본 | `_upload/<게임명> [<Title ID>]/` | 사용자가 요청한 배포 ZIP 사본·README·대표 스크린샷 |
| 보관 | `_tools/_archive/<YYYYMMDD>/` | 끝난 정리·감사 기록, 타이틀을 특정할 수 없는 과거 자료 |

금지:

- 워크스페이스 루트에 캡처·로그·JSON·DLL 등 파일을 쓰지 않는다. CWD가 루트인 상태에서 상대 경로나
  도구의 기본 출력 위치로 저장하지 않는다.
- `titles/`, `-/`, `undefined/`처럼 `_titles`와 비슷하거나 경로 변수가 해석되지 않아 생긴 최상위
  폴더를 만들지 않는다. 경로를 조합한 변수가 비어 있거나 `undefined`면 쓰기 전에 중단한다.
- 여러 타이틀이 함께 쓰는 임시 폴더(`.codex-tmp` 등)에 타이틀 산출물을 남기지 않는다. 섞이면 나중에
  귀속할 수 없다. 에이전트 스크래치는 세션 임시로만 쓰고, 남길 결과는 해당 타이틀 구역으로 옮긴다.

## 타이틀 폴더 중복 방지

- 타이틀 루트를 새로 만들기 전에 `_titles` 전체(상태 폴더 포함)를 **Title ID로** 검색해 기존 루트를
  재사용한다. 손으로 입력한 이름 문자열로 찾지 않는다.
- `’`(U+2019)/`'`, `꞉`/`:`, 전각/반각, 연속 공백 차이로 같은 게임의 루트가 둘 생기지 않게 한다. 경로는
  직접 타이핑하지 않고 디렉터리 열거 결과의 실제 이름을 그대로 쓴다.
- PowerShell은 `’`를 작은따옴표로 해석한다. 이런 이름은 열거된 `FullName`, .NET IO API, 또는 큰따옴표와
  `-LiteralPath`로 다룬다.
- Title ID가 없는 다운로드·압축 해제 폴더를 따로 두지 않는다. 받은 원본은 바로 해당 Title ID 타이틀
  루트에 넣고, 해제 기록은 그 루트의 Handoff에 남긴다.
- 상태 폴더 간 이동(`_waitng` → `_complete` 등)은 타이틀 루트 전체를 같은 볼륨에서 한 번에 이동하고
  이전 위치에 잔재를 남기지 않는다.

## 타이틀 상태 폴더와 `_working` 이동

`_titles/` 아래 타이틀 루트(NSW의 NSP/XCI 폴더 등)는 진행 상태에 따라 다음 폴더 중 한 곳에 둔다.
Steam/PC처럼 설치 폴더 자체가 타이틀 루트인 경우는 옮기지 않는다.

| 상태 폴더 | 의미 |
|---|---|
| `_waitng` | 받아 두었지만 아직 시작하지 않은 타이틀(대기열) |
| `_working` | **지금 작업 중인 타이틀** |
| `_hold` | 사용자 보류·외부 원인 차단으로 멈춘 타이틀 |
| `_complete` | 릴리스까지 끝난 타이틀 |

- **작업을 시작하거나 재개할 때** 타이틀 루트가 `_working` 밖에 있으면, 파일을 쓰기 전에 루트 전체를
  `_titles/_working/`으로 옮긴 뒤 작업한다. 프로젝트 생성(`project:new`)도 이동한 뒤
  `--game-folder _working/<타이틀 폴더>`로 실행한다.
- **작업을 끝내면** 상태에 맞게 다시 옮긴다: 릴리스 완료는 `_complete`, 사용자 보류·차단은 `_hold`.
  세션만 끝나고 작업이 이어질 예정이면 `_working`에 그대로 둔다.
- 이동 전 확인(하나라도 걸리면 옮기지 않고 `BLOCKED`와 Handoff 기록):
  - 실행 중인 에뮬레이터·MCP 세션이나 다른 에이전트가 그 타이틀을 쓰고 있지 않은지
  - Eden load 폴더 등 junction/symlink가 타이틀 경로 안을 가리키지 않는지(가리키면 링크를 먼저 정리)
  - 대상 위치에 같은 Title ID의 루트가 이미 없는지(있으면 중복 폴더 방지 절차로 합친다)
- 이동은 같은 볼륨에서 폴더 rename 한 번으로 하고, 복사 후 삭제하지 않는다. 이동 후 `PROJECT.md`의
  타이틀 루트 경로와 `WORK_LOG.md`에 이전·새 위치와 날짜를 기록한다. 프로젝트 문서와 스크립트는
  절대 경로 대신 프로젝트 루트 기준 상대 경로를 써서 이동해도 깨지지 않게 한다.
- 사용자가 다른 타이틀을 특정해 작업을 지시하지 않는 한, `_working`에는 실제로 진행 중인 타이틀만 둔다.

## 종료 시 최상위 점검

단계나 세션을 끝내기 전에 워크스페이스 루트와 `_titles/` 최상위에 새로 생긴 파일·폴더가 없는지
확인한다. 생겼다면 원인을 Handoff에 기록하고, 위 구역 규칙과 `cleanup-contract.md` 절차에 따라
사용자 승인 후 정리한다.

## 기존 구조 감사

NSW 검증기는 타이틀 루트의 원본 NSP/XCI·`_work`·기존 `HANDOFF.md` 외 항목을 엄격히
검사한다. Steam/PC 설치 루트는 배포처가 관리하는 게임 파일을 허용하되 그 경로를 output으로
사용하지 않는다. 모든 플랫폼에서 `_work`의 미분류 파일, 프로젝트 root의 비표준 단계 폴더,
프로젝트 내부 link를 fail-closed로
보고한다. 기존 legacy 경로는 자동 이동·rename·삭제하지 않는다. exact child inventory와
manifest 등록·hash 검증을 완료한 후 별도 마이그레이션한다.
