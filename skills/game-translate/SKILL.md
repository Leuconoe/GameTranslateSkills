---
name: game-translate
description: "Orchestrates the full 7-stage game Korean-localization workflow (analyze, translate text, user text review, translate images, user image review, QA, release) for NSW/SFC/PS1/PS2/Steam games with PDCA loop. Use when starting or resuming a game translation/localization/한글화 project."
---

# game-translate — 게임 한글화 오케스트레이터

사용자가 합법적으로 보유한 게임의 **개인 번역 패치** 제작을 7단계로 지휘하는 스킬입니다.
배포물은 원본 게임 데이터를 포함하지 않는 패치 형태여야 합니다.

## 0. 환경 규약

| 변수 | 의미 | 해석 규칙 |
|-----|------|-------|
| `GT_HOME` | 지식 베이스 루트 (platforms/, engines/, common/, setup/) | **Codex 플러그인**: `.codex-plugin/`, `skills/`, `common/`이 함께 있는 설치된 플러그인 루트 → **Claude Code 플러그인**: `${CLAUDE_PLUGIN_ROOT}`. 플러그인 외 수동 설치는 지원하지 않음 |
| `GT_WORKSPACE` | 게임 번역 작업 루트 (게임 데이터·산출물 위치) | 환경변수 또는 현재 작업 디렉터리 |
| `GT_TOOLS` | 공용 도구 폴더 | `$GT_WORKSPACE/_tools` |

- 시작 전 **반드시 읽기**: `$GT_HOME/common/SAFETY.md` (안전 규칙 — 모든 단계에 적용),
  `$GT_HOME/common/project-structure.md` (표준 폴더 구조)
- 작업 중 생성하는 모든 임시 파일·중간 아티팩트·도구 출력은 현재 타이틀의
  `_work/<프로젝트 ID>/` 아래에만 둔다. 삭제 가능한 항목은 `tmp-<단계>-<목적>` 또는
  `tmp_<단계>_<목적>`/`*.tmp`로 명명하고 저장소 루트·OS 임시 폴더·공용 MCP 디렉터리를
  출력 경로로 사용하지 않는다.
- emucap을 사용하는 6단계에서는 `$GT_HOME/common/emucap-integration.md`를 추가로 읽는다.
  emucap은 선택적 런타임 QA 백엔드이며 번역·추출 단계에서 호출하지 않는다.
- 플랫폼 판별 후 해당 어댑터 로드: `$GT_HOME/platforms/<platform>/PLATFORM.md`
  (지원: `nsw`(완전), `sfc`/`ps1`/`ps2`/`steam`(골격 — 부족한 부분은 `_template` 양식에 맞춰 조사·보강 후 진행))
- 엔진 판별 후(1단계에서) 해당 모듈 로드: `$GT_HOME/engines/<engine>/ENGINE.md`

### 이미지 범위 판정

- 1단계 분석이 끝나기 전에 프로젝트 정책 필드 `image_scope`를 `required` 또는 `N/A`로
  확정하고 `PROJECT.md`와 `30_translation/ANALYSIS.md`에 근거를 기록한다.
- `required`는 번역 대상에 문자 포함 이미지·텍스처·아틀라스가 하나라도 있는 경우다.
  이 경우 4단계와 5단계, 이미지별 사용자 승인 게이트를 생략하지 않는다.
- `N/A`는 전수 inventory와 시각 확인 결과 **번역 범위에 해당하는 문자 포함 이미지가
  없거나 게임별 분석상 이미지 번역이 적용되지 않는 경우**에만 사용한다. 이미지 목록이
  비어 있다는 사실만으로 추정하지 말고 0건과 판정 근거를 남긴다.
- `image_scope`가 비어 있거나 근거가 불충분하면 `required`로 취급해 임의 생략하지 않는다.

## 1. 7단계 파이프라인

| # | 단계 | 스킬 | 게이트 |
|---|------|------|-------|
| 1 | 파일 분석 | `gt-analyze` | 산출물 검증 |
| 2 | 텍스트 번역 | `gt-text-translate` | 구조 검증 |
| 3 | 텍스트 검수 | `gt-text-review` | **사용자 승인 필수** |
| 4 | 이미지 번역 | `gt-image-translate` | `image_scope=required`일 때만 실행; `N/A`면 명시적 생략 |
| 5 | 이미지 검수 | `gt-image-review` | `required`일 때 전 행 **사용자 승인 필수**; `N/A`면 생략 |
| 6 | 전체 검수 | `gt-qa` | 빌드+실행시험 통과 |
| 7 | 배포 파일 생성 | `gt-release` | 완료 기준 체크리스트 |

각 단계는 해당 스킬의 SKILL.md 절차를 따른다. 단계별 산출물이 다음 단계의 입력 조건이며,
입력 조건 미충족 시 이전 단계로 돌아간다.

### 이미지 단계 생략 경로

- `image_scope=N/A`가 승인 기록되면 정상 경로는 **1 분석 → 2 텍스트 번역 → 3 텍스트
  사용자 검수 → 6 전체 QA → 7 릴리즈**다.
- 4·5단계는 빈 `IMAGE_PLAN.tsv`나 가짜 번역 이미지를 만들지 않고, `PROJECT.md` 단계
  상태와 `WORK_LOG.md`에 `skipped (image_scope=N/A)`, 0건 inventory, 판정 근거를 기록한다.
- `N/A`는 이미지 자산을 런타임에서 무시한다는 뜻이 아니다. QA에서는 원본 이미지·아틀라스가
  깨지지 않고 화면에 정상 표시되는지 확인한다. 다만 이미지 번역 결과에 대한 5단계
  사용자 승인 시트는 만들지 않는다.
- 텍스트 번역·텍스트 검수가 완료된 뒤에도 `image_scope` 근거가 바뀌면 4단계를 다시
  판정하고, `required`로 바뀐 경우 이미지를 생략한 채 QA나 릴리즈로 진행하지 않는다.

## 2. PDCA 루프 운영

- **Plan**: 단계 시작 시 대상 범위(배치 목록·이미지 목록)와 완료 기준을 `PROJECT.md`에 기록
- **Do**: 스킬 절차 실행. 병렬 서브에이전트 사용 시 `common/glossary-rules.md`의
  동시 작업 게이트(읽기 전용 서브에이전트, 단일 메인 에이전트 chunk 처리) 준수
- **Check**: 단계 산출물을 완료 기준과 대조. 구조 검증(플레이스홀더·태그·개행 보존) 실행
- **Act**: 갭 발견 시 해당 배치만 재작업 후 재검증. 동일 실패 2회 반복 시 접근을 바꾸고
  원인 분석을 `PROJECT.md` 작업 로그에 기록
- **Handoff (모든 단계 공통)**: 문서와 실제가 다르거나, 문서에 없는 절차가 필요했거나,
  우회법으로 해결한 순간 **즉시** 프로젝트 루트 `HANDOFF.md`에 기록한다
  — 형식·유형·반영 절차는 `$GT_HOME/common/handoff-rules.md`

## 3. 진행 상태 관리

- 프로젝트 루트의 `PROJECT.md`에 단계별 상태 테이블 유지:
  `단계 | 상태(pending/in-progress/blocked/done) | 산출물 경로 | 완료일 | 비고`
- 세션 재개 시 `PROJECT.md`부터 읽고 마지막 미완료 단계부터 재개
- 사용자 검수 게이트(3단계와 `image_scope=required`일 때의 5단계)에서는 **작업을
  중단하고 명시적 승인을 기다린다**. `image_scope=N/A`일 때는 5단계 승인을 요구하지
  않고 3단계 승인 후 6단계 QA로 이동한다.

## 4. 중단·재개 규칙

- 사용자가 중단을 요청하기 전까지 임의로 작업을 중단하지 않는다 (검수 게이트 제외)
- 중단 시 진행 중 배치의 상태를 `PROJECT.md`에 기록한다. 재개에 필요한 부분 산출물은
  정규 산출물 경로에 `status=partial`을 표시하고, 폐기 가능한 보조 파일은 프로젝트
  `_work` 아래 `tmp-<단계>-<목적>`으로 만든다.
- 재개 시 실패/부분 배치만 재실행 (전체 재실행 금지)

## 5. 스킬 개선 루프 (프로젝트 완료 시)

7단계 완료(또는 사용자 요청) 시 `HANDOFF.md`의 `open` 엔트리를 수집해
`$GT_HOME/common/handoff-rules.md` §3 절차로 지식 베이스에 반영한다:
특정 게임 정보 제거 → 대상 문서 수정 → 가능하면 수정 절차 재실행 검증 →
엔트리 `applied` 마킹 → 저장소 커밋/PR 제안. 골격 어댑터(SFC/PS1/PS2/Steam)의
`⚠️ 미검증` 항목은 이 루프로만 해제된다.

### 완료 후 임시 파일 정리

- 7단계 릴리즈와 `PROJECT.md` 완료 상태를 확정한 뒤 `npm run project:clean --
  --project-root "<타이틀 루트>/_work/<프로젝트 ID>"`로 먼저 dry-run한다.
- exact allowlist의 `tmp-*`, `tmp_*`, `*.tmp`만 검토하고, Git 추적·manifest 참조·활성
  프로세스·릴리스/QA 증거·링크/reparse point가 있는 항목은 보존한다.
- 정리 승인 후에만 같은 명령에 `--apply`를 붙여 제거하고, 경로·개수·시각을
  `WORK_LOG.md`에 기록한다. dry-run 후보 0건과 `project:validate -- --strict` 재실행까지
  완료해야 정리 게이트가 통과한다.

## 6. 신규 프로젝트 시작 절차

1. 플랫폼 확인 → 어댑터 존재 확인 (`$GT_HOME/platforms/`)
2. 플러그인 루트(`package.json`이 있는 디렉터리)에서 npm 명령으로 프로젝트 생성:
   `npm run project:new -- --game-folder "<게임 릴리스 폴더명>" --title-id "<16자리 베이스 Title ID>" --game-name "<게임명>" --titles-root "$GT_WORKSPACE/_titles"`
   대기 폴더(`_waitng` 등) 하위 타이틀은 `--game-folder`에 대기 폴더 포함 상대 경로를 그대로 지정한다.
   명령 실패 시 `common/project-structure.md`의 표준 구조를 수동 생성하지 말고 원인을 먼저 기록·해결한다.
3. 게임 레지스트리(`GAME_REGISTRY.tsv`)에 등록 (워크스페이스에 있는 경우)
4. `gt-analyze` 호출로 1단계 시작
