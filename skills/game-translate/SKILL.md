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
- emucap을 사용하는 6단계에서는 `$GT_HOME/common/emucap-integration.md`를 추가로 읽는다.
  emucap은 선택적 런타임 QA 백엔드이며 번역·추출 단계에서 호출하지 않는다.
- 플랫폼 판별 후 해당 어댑터 로드: `$GT_HOME/platforms/<platform>/PLATFORM.md`
  (지원: `nsw`(완전), `sfc`/`ps1`/`ps2`/`steam`(골격 — 부족한 부분은 `_template` 양식에 맞춰 조사·보강 후 진행))
- 엔진 판별 후(1단계에서) 해당 모듈 로드: `$GT_HOME/engines/<engine>/ENGINE.md`

## 1. 7단계 파이프라인

| # | 단계 | 스킬 | 게이트 |
|---|------|------|-------|
| 1 | 파일 분석 | `gt-analyze` | 산출물 검증 |
| 2 | 텍스트 번역 | `gt-text-translate` | 구조 검증 |
| 3 | 텍스트 검수 | `gt-text-review` | **사용자 승인 필수** |
| 4 | 이미지 번역 | `gt-image-translate` | 에이전트별 분기 |
| 5 | 이미지 검수 | `gt-image-review` | **사용자 승인 필수** |
| 6 | 전체 검수 | `gt-qa` | 빌드+실행시험 통과 |
| 7 | 배포 파일 생성 | `gt-release` | 완료 기준 체크리스트 |

각 단계는 해당 스킬의 SKILL.md 절차를 따른다. 단계별 산출물이 다음 단계의 입력 조건이며,
입력 조건 미충족 시 이전 단계로 돌아간다.

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
- 사용자 검수 게이트(3·5단계)에서는 **작업을 중단하고 명시적 승인을 기다린다**.
  승인 없이 6단계 이후로 진행하는 것은 금지

## 4. 중단·재개 규칙

- 사용자가 중단을 요청하기 전까지 임의로 작업을 중단하지 않는다 (검수 게이트 제외)
- 중단 시 진행 중 배치의 상태를 `PROJECT.md`에 기록하고, 부분 산출물은 `_tmp/`가 아닌
  정규 산출물 경로에 상태 표시(`status=partial`)와 함께 저장
- 재개 시 실패/부분 배치만 재실행 (전체 재실행 금지)

## 5. 스킬 개선 루프 (프로젝트 완료 시)

7단계 완료(또는 사용자 요청) 시 `HANDOFF.md`의 `open` 엔트리를 수집해
`$GT_HOME/common/handoff-rules.md` §3 절차로 지식 베이스에 반영한다:
특정 게임 정보 제거 → 대상 문서 수정 → 가능하면 수정 절차 재실행 검증 →
엔트리 `applied` 마킹 → 저장소 커밋/PR 제안. 골격 어댑터(SFC/PS1/PS2/Steam)의
`⚠️ 미검증` 항목은 이 루프로만 해제된다.

## 6. 신규 프로젝트 시작 절차

1. 플랫폼 확인 → 어댑터 존재 확인 (`$GT_HOME/platforms/`)
2. 플러그인 루트(`package.json`이 있는 디렉터리)에서 npm 명령으로 프로젝트 생성:
   `npm run project:new -- --game-folder "<게임 릴리스 폴더명>" --title-id "<16자리 베이스 Title ID>" --game-name "<게임명>" --titles-root "$GT_WORKSPACE/_titles"`
   대기 폴더(`_waitng` 등) 하위 타이틀은 `--game-folder`에 대기 폴더 포함 상대 경로를 그대로 지정한다.
   명령 실패 시 `common/project-structure.md`의 표준 구조를 수동 생성하지 말고 원인을 먼저 기록·해결한다.
3. 게임 레지스트리(`GAME_REGISTRY.tsv`)에 등록 (워크스페이스에 있는 경우)
4. `gt-analyze` 호출로 1단계 시작
