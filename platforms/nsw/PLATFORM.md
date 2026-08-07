# NSW (Nintendo Switch) 플랫폼 개요

> 출처: 실전 한글화 작업 노하우에서 일반화 이식 (2026-08)

## 전제

- 이 문서의 모든 절차는 **사용자가 합법적으로 보유한 게임의 개인 번역 패치** 제작을 전제로 한다.
- 배포물은 원본 게임 데이터를 포함하지 않는 **LayeredFS 패치 형태**로만 만든다. 원본 NSP/XCI, 복호화된 RomFS, 게임 키를 산출물이나 배포물에 포함하지 않는다.
- 게임마다 엔진과 파일 형식은 달라도 **원본 보존, 번역 데이터 관리, 빌드 격리, 실기 검증** 원칙은 동일하게 적용한다.

## 도구 체인

공용 도구는 워크스페이스 공용 폴더(`$GT_TOOLS`)에만 두고, 게임별 스크립트·캐시는 각 프로젝트의 `90_tools/`에 둔다.

| 도구 | 경로 규약 | 용도 |
|---|---|---|
| nstool | `$GT_TOOLS/nstool-<버전>/nstool.exe` | NSP/XCI/NCA 언팩·검증의 표준 CLI. 재현 가능한 추출은 반드시 이 도구로 수행 |
| 시스템 키 | `$GT_TOOLS/system/prod.keys` | nstool 복호화 키. 모든 nstool 명령에 `-k`로 명시 (extract.md 키 파일 규약) |
| NxFileViewer | `$GT_TOOLS/NxFileViewer/` | 패키지 검사 보조 유틸리티. GUI 추출을 재현 가능한 빌드 단계로 사용하지 않음 |
| Eden | `$GT_TOOLS/Eden/<version>/eden.exe` | 실기 전 표준 에뮬레이터 테스트 환경. 사용 가능한 경우 `eden-mcp` 실행·상태·캡처 경로를 권장 (emucap 대상 아님) |
| Ryujinx 호환 런타임 | `$GT_TOOLS/<배포 폴더>/` (예: `Ryubing/`) | 보조 에뮬레이터 스모크 테스트. 포터블 프로파일은 도구 폴더 안에 유지하고 프로젝트 트리로 복사 금지 |
| 공용 한글 폰트 | `$GT_TOOLS/_fonts/` | 기본 본문 폰트. **실제 폴더의 파일을 확인**해 선택한 파일명·SHA-256을 프로젝트 시작 시 기록 |
| 프로젝트 스캐폴드 | `npm run project:new` | 격리된 프로젝트 폴더 생성 |
| 구조 검증기 | `npm run project:validate` | 폴더 구조·Title ID 격리·루트 누수 검사 (`--strict`) |

### Eden·Ryubing 격리 프로파일 필수 로캘

Eden 또는 Ryubing을 포터블/격리 프로파일로 실행할 때는 에뮬레이터가 실제로 읽는
프로파일의 시스템 설정을 다음처럼 고정한다.

- 시스템 지역: `한국`/`대한민국`
- 시스템 언어: `한국어`
- Windows 호스트의 현재 지역·언어 환경변수나 게임 메뉴에 표시된 언어만으로 대체하지
  않는다. 실행 직전 유효 프로파일 설정 또는 시작 로그에서 두 값을 확인한다.
- baseline과 번역 후보는 같은 프로파일과 같은 두 값을 사용한다. 프로파일 경로, 에뮬레이터
  버전, 시스템 지역, 시스템 언어, 확인 근거를 `WORK_LOG.md`와 `50_test/TEST_LOG.md`에
  기록한다.
- 두 값을 확인할 수 없으면 격리 실행을 PASS로 판정하지 말고 `PENDING_RUNTIME`으로 남긴다.

Eden 실행은 `eden-mcp`가 연결 가능하고 대상 작업을 지원하면 이를 우선한다. 직접
`eden.exe` 실행은 MCP 미설치·미지원 또는 장애 시의 fallback으로 사용하고 사유를 로그에
남긴다. 어느 경로도 `PASS (hardware)`를 대신하지 않는다.

**도구 경로 탐색 규칙**: 배포 압축본을 그대로 푼 도구 폴더에는 버전·플랫폼 접미가 붙는다(예: `nstool-v*-win_x64/`). 문서의 고정 경로를 그대로 가정하지 말고 디렉터리 목록에서 **이름 접두로 탐색**한다. 폰트 폴더 이름은 `fonts/`가 아니라 `_fonts/`다. 실제로 사용한 절대 경로와 버전은 `WORK_LOG.md`에 기록한다.

엔진별 도구(Unity, 비주얼노벨 계열, LUCA System 등)는 `engines/` 하위 문서를 참조한다.

### 공용 도구 보관 원칙

- 여러 게임에서 재사용하는 실행 파일·CLI 도구와 배포 압축본은 `$GT_TOOLS`에만 둔다.
- `$GT_TOOLS`에는 도구 자체만 두고 게임 추출물·번역표·빌드 파일을 만들지 않는다. 도구의 모든 출력은 명령줄에서 프로젝트별 `10_extract`, `30_translation`, `40_build`, `50_test` 경로로 명시한다.
- 공용 도구를 게임 프로젝트 안에 복제하지 않는다. 게임별 조사 스크립트, 설정, 로그, 일회성 캐시는 해당 프로젝트의 `90_tools/`에 둔다.
- 공용 도구를 이동하거나 릴리스 폴더명을 바꾸면 기존 보고서·로그의 절대 경로가 무효화될 수 있다. 이전 보고서는 증거로 보관하되 새 분석·병합 보고서는 현재 경로에서 다시 생성한다.

## 표준 작업 폴더 구조

프로젝트의 식별자는 **베이스 Title ID**다. 모든 생성물은 다음 경로에만 둔다.

```text
<titles 루트>/<게임 릴리스 폴더>/_work/<베이스 Title ID>/
  PROJECT.md               타이틀·버전·엔진·원본 파일명·정책 기록
  WORK_LOG.md              모든 명령·오류·검증 결과의 작업 로그
  00_source/
    SOURCE_INVENTORY.tsv   원본 파일명·크기·SHA-256
  10_extract/
    romfs_original/        유효 RomFS 추출본 (읽기 전용 취급)
    decompiled/            디컴파일 결과
  20_reference/
    REFERENCE_INDEX.tsv
    external_patches/      참고용 외부 패치 (읽기 전용)
    fonts/                 원본 폰트·라이선스 정보 사본
    documents/
  30_translation/
    ANALYSIS.md            분석 단계 산출물: 엔진·언어 슬롯·번역 대상 분류·추출 재현 명령
    text/
      glossary.tsv
      translation_manifest.tsv
      translation_batches/
      reports/
    image_translation/
      for_translation/     작업자가 직접 수정하는 이미지
      reference/
        image_manifest.tsv
  40_build/
    BUILD_MANIFEST.tsv
    staging/               깨끗한 원본 기반 빌드 작업장
    layeredfs/<TITLE_ID>/romfs/
    releases/              단일 정식 <BASE_TITLE_ID>.zip 및 릴리스 기록
  50_test/
    TEST_LOG.md
    screenshots/
    logs/
  90_tools/
    scripts/               게임별 조사·주입 스크립트
    environment/           프로젝트 전용 실행 환경
```

- `20_reference`는 읽기 전용 원본과 재조립 정보만 보관한다. 직접 수정하는 이미지는 `for_translation`에만 둔다.
- 실패한 빌드나 조사용 출력물을 최종 `layeredfs`에 섞지 않는다.
- 원본 NSP/XCI는 릴리스 폴더에 유지하고, 추출 이후의 모든 결과만 `_work/<Title ID>`에 둔다.

## 프로젝트 격리 원칙

- 워크스페이스 루트는 항상 깨끗하게 유지한다. 타이틀별 실제 작업물(추출물, 참고 자료, 번역 배치, 빌드, 시험 증거, 보고서, 로그, 캐시, 임시 파일)은 전부 해당 타이틀의 `_work/<베이스 Title ID>/` 하위에 생성한다.
- 워크스페이스 루트나 타이틀 루트에 `data`, `output`, `temp`, `romfs` 같은 공용 작업 폴더를 만들지 않는다. 도구가 현재 디렉터리에 기본 출력한다면 실행 전에 단계별 폴더나 `90_tools/tmp-<purpose>`로 출력 경로를 명시한다.
- 같은 게임이라도 베이스 Title ID, 플랫폼 이식 방식, 지역, 엔진이 다르면 **별도 프로젝트**로 취급한다. 한 릴리스 폴더에 이식판과 네이티브판이 함께 있으면 Title ID별 `_work`를 각각 만든다.
- 다른 프로젝트의 추출물, 번역표, 폰트, 아틀라스, LayeredFS 폴더를 복사해서 시작하지 않는다.
- **다른 게임에서 성공한 주입 방식, 언어 슬롯, 폰트 이름을 새 게임에 그대로 적용하지 않는다.** 반드시 게임별로 재검증한다.
- 폴더명에 대괄호(`[...]`)가 있으면 PowerShell `-Path`가 wildcard로 해석할 수 있다. 경로 탐색·검증·스크립트 인자는 `-LiteralPath` 또는 Title ID로 확정한 절대 경로를 사용한다.
- 유사한 타이틀 폴더가 여러 개일 때 `startswith()`나 부분 glob으로 프로젝트를 고르지 않는다. 전체 폴더명과 베이스 Title ID를 literal로 지정한다. CP949 터미널에서 한자 폴더명이 깨져 보여도 경로가 바뀐 것으로 단정하지 말고 절대 경로·파일 해시로 재확인한다.

## 게임 등록 (GAME_REGISTRY 방식)

1. 베이스와 업데이트 패키지의 파일명, Title ID, 버전, 지역, 크기를 확인한다.
2. 타이틀 루트의 `GAME_REGISTRY.tsv`에 한 행을 추가한다.

### GAME_REGISTRY.tsv 스키마

탭 구분, 첫 행은 헤더. 컬럼은 다음과 같다.

| 컬럼 | 내용 |
|---|---|
| `game_name` | 게임명 |
| `base_title_id` | 16자리 베이스 Title ID (대문자) |
| `update_title_id` | 업데이트 Title ID. 없거나 미확인이면 `unknown` |
| `release_folder` | 타이틀 루트 기준 릴리스 폴더의 **실제 상대 경로** (대기 폴더 하위면 대기 폴더 포함) |
| `project_path` | 릴리스 폴더 기준 프로젝트 상대 경로 (`_work/<베이스 Title ID>`) |
| `engine_or_format` | 확인된 엔진·포맷. 미확인이면 `unknown` |
| `status` | 진행 상태 (`registered` 등, 상태값 규약은 build-test.md §7 참조) |

### 대기 폴더 (`_waitng` / `_hold` / `_complete`) 규약

- 타이틀 루트에는 상태별 대기 폴더가 있을 수 있다: `_waitng`(작업 대기), `_hold`(보류), `_complete`(완료).
- 타이틀이 대기 폴더 하위에 있어도 **그 자리에서 그대로 작업할 수 있다.** 등록이나 작업을 위해 릴리스 폴더를 타이틀 루트로 옮기지 않는다.
- 레지스트리 `release_folder`와 스캐폴드 `-GameFolder`에는 대기 폴더를 포함한 **실제 상대 경로**를 그대로 기록한다 (예: `_waitng\<게임 릴리스 폴더명>`).
- 상태 전이에 따른 폴더 이동(`_waitng` → 루트, → `_complete` 등)은 **사용자 승인 후에만** 수행하고, 이동 후 레지스트리·`PROJECT.md`·보고서의 경로 참조를 재대조한다 (common/project-structure.md §1 경로 취급 주의).

### 프로젝트 스캐폴드

3. 워크스페이스 루트에서 스캐폴드 스크립트로 프로젝트를 생성한다.

```text
npm run project:new -- --game-folder "<게임 릴리스 폴더명 (대기 폴더 하위면 예: _waitng/<폴더명>)>" --title-id "<16자리 베이스 Title ID>" --game-name "<게임명>" --titles-root "$GT_WORKSPACE/_titles"
```

명령은 `package.json`이 있는 플러그인 루트에서 실행한다. `--game-folder`에는 대기 폴더를 포함한 상대 경로를 지정한다.

4. `PROJECT.md`에 업데이트 Title ID, 버전, 엔진, 원본 파일명을 기록한다.
5. `00_source/SOURCE_INVENTORY.tsv`에 원본 크기와 SHA-256을 기록한다.
6. 베이스와 업데이트 중 **실제로 적용되는 RomFS가 어느 쪽인지** 확인한다.

스캐폴드 스크립트는 이미 다른 게임에 등록된 Title ID를 거부해야 한다. 원본 게임 폴더는 자동 생성하지 않으므로 잘못된 경로를 새 프로젝트로 오인하지 않는다.

## 구조 검증

폴더 이동, 새 게임 등록, 빌드 완료 후 다음을 실행한다.

```text
npm run project:validate -- --titles-root "$GT_WORKSPACE/_titles" --strict
```

이 검사는 필수 폴더·매니페스트 누락, Title ID 중복, 다른 게임의 LayeredFS ID 혼입, 루트에 생성된 공용 작업 폴더를 오류로 보고해야 한다.

## Python 의존성과 실행 환경

- 여러 게임 공통의 핵심 의존성은 `$GT_TOOLS/requirements.txt`에만 추가하고, 유지보수는 `$GT_TOOLS/.venv`에서 수행한다.
- 진행 중인 게임의 실제 작업은 그 프로젝트의 `90_tools/scripts`와 기존 실행 환경을 계속 사용한다. 기존 환경을 새 venv로 임의 교체하거나 스크립트를 공용 폴더로 복제하지 않는다. 환경을 바꿔야 하면 별도 staging에서 먼저 결과와 해시를 비교한다.
- GPU·OCR처럼 게임별로만 필요한 패키지는 해당 프로젝트의 기존 환경과 충돌 여부를 먼저 확인한다.
- 패키지 디렉터리와 가상환경 실행 파일을 구분한다. project-local 의존성 폴더가 `PYTHONPATH`로 쓰인다고 그 안에 인터프리터가 있다고 가정하지 않는다. 단일 테스트를 통과시키려고 전역 Python을 임의 변경하지 않는다.

## 관련 문서

- 추출·엔진 분석·언어 슬롯: [extract.md](./extract.md)
- 빌드·LayeredFS·실기 시험·실패 복구: [build-test.md](./build-test.md)
- 최종 산출물·배포 패키징·완료 기준: [release.md](./release.md)
- 격리·폴더 구조·동시 작업·커밋 규칙: [../../common/project-structure.md](../../common/project-structure.md)
