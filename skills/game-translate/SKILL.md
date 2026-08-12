---
name: game-translate
description: "Orchestrate a fail-closed Korean game-localization workflow across overall analysis, text analyze/translate/QA/review, conditional image analyze/translate/QA/review, integrated QA, and release. Review stages prepare emulator-ready handoffs by default and wait for user approval only when the project explicitly sets user-gate. Use when starting, resuming, or reconciling a NSW/SFC/PS1/PS2/Steam game translation project."
---

# game-translate — 게임 한글화 오케스트레이터

사용자가 합법적으로 보유한 게임의 개인 번역 패치를 지휘한다. 원본 게임 데이터·콘솔 키·
펌웨어는 작업·배포 산출물에 포함하지 않는다. 단계·상태·정리 규칙은
`$GT_HOME/common/pipeline-contract.json`과 `pipeline-contract.md`를 기준으로 한다.

## 0. 환경과 안전

| 변수 | 의미 |
|---|---|
| `GT_HOME` | `.codex-plugin/`, `skills/`, `common/`이 함께 있는 설치 플러그인 루트 또는 Claude의 `${CLAUDE_PLUGIN_ROOT}` |
| `GT_WORKSPACE` | 게임 데이터·타이틀 작업장 루트 |
| `GT_TOOLS` | 공용 도구 폴더. 게임 산출물은 만들지 않음 |

시작 전에 다음을 읽는다.

1. `$GT_HOME/common/SAFETY.md`
2. `$GT_HOME/common/project-structure.md`
3. `$GT_HOME/common/preflight-checks.md`
4. `$GT_HOME/common/pipeline-contract.md`와 `pipeline-contract.json`
5. 플랫폼 어댑터 `platforms/<platform>/PLATFORM.md`와 현재 단계 문서
6. 엔진을 식별한 뒤 `engines/<engine>/ENGINE.md`

타이틀 루트는 원본 `.nsp`/`.xci`가 직접 있는 실제 폴더다. 작업물·임시 파일·staging·
런타임 증거는 그 폴더의 `_work/<프로젝트 ID>/` 아래에만 둔다. `GT_HOME`, 저장소 루트,
OS 임시 폴더, 공용 MCP 디렉터리, 임의 `title`/`output`/`temp` 폴더를 출력 경로로 쓰지
않는다. 프로젝트·플랫폼·엔진·Title ID·정책을 확정하지 못하면 변경·삭제·런타임을 하지
않고 `WARN`/`BLOCKED`와 Handoff만 기록한다.

## 1. 실제 단계 흐름

| 순서 | 단계 | 스킬 | 완료 상태 |
|---:|---|---|---|
| 1 | 공통 파일·엔진·언어 슬롯 분석 | `gt-analyze` | `project_status=analyzed` |
| 2 | 텍스트 대상·왕복 계약 분석 | `gt-text-analyze` | text `analyzed` |
| 3 | 텍스트 번역·용어집 누적 | `gt-text-translate` | text `translated` |
| 4 | 텍스트·폰트 기술 QA·후보 생성 | `gt-text-qa` | text `qa_ready`, `font_status=verified` |
| 5 | 텍스트 검수 handoff·에뮬레이터 준비 | `gt-text-review` | text `review_ready` |
| 6 | 이미지 대상·atlas 계약 분석 | `gt-image-analyze` | image `analyzed` |
| 7 | 이미지·텍스처 번역 | `gt-image-translate` | image `translated` |
| 8 | 이미지 기술 QA·주입 후보 생성 | `gt-image-qa` | image `qa_ready` |
| 9 | 이미지 비교·검수 handoff | `gt-image-review` | image `review_ready` |
| 10 | 텍스트·폰트·이미지 통합 빌드·실행 QA | `gt-qa` | `qa_status=passed` |
| 11 | 플랫폼 배포 패키징 | `gt-release` | `release_status=released` |

기본 실행 순서는 표와 같으며, 공통 분석 뒤 텍스트 브랜치를 먼저 끝내 이미지 안의
문자에 glossary·STYLE을 공급한다. 프로젝트가 읽기 전용 병렬 분석을 허용해도 같은
manifest·번역표·staging을 동시에 쓰지 않는다.

## 2. 검수·사용자 대기 정책

`text-review`와 `image-review`의 “검수”는 기술 QA 결과, 전체 시트, 비교 자료, hash,
canonical staging, handoff를 만들어 다음 단계가 실행 가능하게 준비하는 뜻이다.

- 기본 `text_review_policy=prepare-only`, `image_review_policy=prepare-only`: 산출물을
  완성하고 `review_ready`로 자동 진행한다. 사용자 허락을 묻거나 대기하지 않는다.
- 프로젝트에 `text_review_policy=user-gate` 또는 `image_review_policy=user-gate`가
  명시된 경우에만 해당 시트를 제출하고 사용자의 명시적 완료를 기다린다.
- `review_ready`는 사용자 승인·`PASS (runtime)`·릴리스 완료가 아니다.
- 사용자가 나중에 수정안을 제공하면 해당 행/이미지만 branch QA부터 다시 실행한다.

`runtime_policy`는 review policy와 별개다. `static-first`에서는 사용자의 명시적 실행
요청 전까지 bench와 `PENDING_RUNTIME`만 기록한다. 이 정책은 중간 실행 빈도만 조절하며,
릴리스 전 공식 배포용 릴리즈 에뮬레이터의 non-MCP 직접 실행을 생략하지 않는다.

## 3. 이미지 범위

- `image_scope=pending`이면 이미지 단계를 생략하지 않는다.
- `gt-image-analyze`가 전수 inventory·시각/metadata 근거를 남긴 뒤 `required` 또는
  `N/A`로 확정한다.
- `required`면 이미지 4단계를 모두 실행한다. `N/A`면 계획·가짜 이미지·검수 행을 만들지
  않고 `image_status=skipped`, 0건 근거, 생략 사유를 기록한 뒤 `gt-qa`로 이동한다.
- `N/A`여도 통합 QA에서 원본 이미지·atlas가 정상 표시되는지는 확인한다.

## 4. 공통 preflight와 상태

각 단계를 직접 호출할 때도 `PROJECT.md`, `WORK_LOG.md`, `HANDOFF.md`, 입력 manifest·
출력 경로의 수정 시각/크기/SHA-256/`git status`를 읽는다. 정책 필수값은
`batch_size`, `glossary_path`, `runtime_policy`, `runtime_authorization`,
`basic_test_backend=eden-mcp`, `mcp_session_scope=one-per-title`,
`final_qa_runtime=official-distribution-release`, `final_qa_mcp_allowed=false`,
`target_language_slot`, `image_scope`, `image_model=provider-selected`,
`image_quality=provider-managed`, `image_input_fidelity=provider-managed`,
`text_review_policy`, `image_review_policy`,
`text_review_approval`, `image_review_approval`, `font_status`, `release_contract`다.

행 상태, 브랜치 상태, QA 상태, 사용자 승인, 런타임 상태, 릴리스 상태를 한 값으로 합치지
않는다. `qa_ready ≠ review_ready ≠ user-approved ≠ PASS (runtime) ≠ released`다.

문서·manifest·세션·파일 해시가 충돌하면 추측하지 않는다. `HANDOFF.md`에 append-only로
관찰·영향·결정·증거·상태를 기록하고 현재 branch를 `blocked`로 유지한다.

## 5. 폰트와 런타임 안전 게이트

`gt-text-qa`는 `$GT_HOME/common/font-atlas-contract.md`에 따라 전체 가시 코드포인트,
실제 font consumer/fallback, glyph ID·atlas rect·UV 원점·padding·bearing·advance·
baseline·line metrics, 기존 glyph 보존, 왕복 추출, render probe를 증명한다. 이 증거가
없거나 `font_status=verified`가 아니면 text review-ready나 통합 QA로 진행하지 않는다.

`gt-qa`는 깨끗한 원본에서 한 번만 통합한다. 기본 smoke는 Eden-MCP의 단일 title 세션을
재사용하지만 그 결과를 최종 PASS로 쓰지 않는다. 최종 QA는 플랫폼 allowlist의 공식 사이트
배포 릴리즈를 별도로 받아 MCP 없이 직접 실행하고 입력 경로·Title ID·active mod 전수 hash·
binary/build hash·화면 전이·로그/캡처를 `RELEASE_RUNTIME_QA.json`에 귀속한다. 로더 생존·
종료 코드·패치 적용 로그만으로 PASS하지 않는다.

이미지 branch는 `$GT_HOME/common/image-translation-contract.md`를 적용한다. 에이전트가
만든 raster 후보는 API 키 없는 `$imagegen` 내장 `image_gen.imagegen`을 같은 byte-exact
reference·prompt로 최소 3회 독립 호출한 schema 3 receipt와 정확히 하나의 합격 선택 후보가
있어야 하고,
`IMAGE_GENERATION_MANIFEST.tsv`에 대해 `validate-image-translation.mjs`가 source/reference
비덮어쓰기, 원문 완전 제거와 no-overlay, 원어의 서체 인상·색·외곽선·질감·재질·광원·
자간/baseline·분위기, anchor/atlas rect·canvas/format, 선언된 alpha policy, edit region 밖
decoded RGBA diff 0을 증명해야 한다. 내장 surface가 노출하지 않는 모델/quality를 주장하거나
API/CLI, Python/Pillow/OpenCV/임의 스크립트 raster 생성물, 검증기 `Issues: 0`이 없는 후보는
이미지 번역·QA 완료로 승격하지 않는다. 합격 후보가 없으면 `hold-for-imagegen-review`로 멈춘다.

## 6. 세션·중복 파일 방지

NSW 기본 smoke는 Eden-MCP다. Eden-MCP와 Ryubing-MCP는 프로젝트당
`50_test/eden/SESSION.json`과 `ARTIFACT_MANIFEST.tsv` 하나를 공유한다. 실행 전에 양쪽
capability와 같은 Title ID의 remote session 목록/status를 조회한다.

- 같은 session key면 새 세션을 만들지 않고 재사용한다.
- 양쪽을 합쳐 active/pending 세션이 둘 이상이면 `BLOCKED`다. Ryubing이나 두 번째 generation은
  구체적 예외 사유와 이전 exact close 증거가 있을 때만 허용한다.
- `pending` 상태에서 create를 재호출하지 않는다. remote를 재조회하고 `BLOCKED`로 조정한다.
- 이전 `last_session_id`가 있으면 exact remote close와 local `close` 기록을 먼저 증명하고,
  새 prepare에는 `--previous-session-id <동일 ID>`를 전달한다.
- 세션·런 폴더, timestamp/session/copy 파일, 다른 Title ID의 staging·로그를 만들지 않는다.
- create/launch 실패 후 status 재조회 전 재호출하지 않는다. 종료 시 현재 ID만 close한다.
- 동일 `artifact_key`·canonical path가 있으면 hash를 비교해 재사용/원자 교체하고 복사본을
  만들지 않는다.

`qa-session` guard는 원격 MCP 세션을 직접 삭제하지 않는다. remote close 성공을 확인한 뒤에만
local `--action close --remote-closed`를 실행한다. 소유권을 증명할 수 없는 세션은 삭제하지
않고 `BLOCKED`다.

## 7. PDCA와 재개

- **Plan**: 단계 입력 범위·정책·완료 기준·artifact key를 `PROJECT.md`에 기록
- **Do**: 해당 스킬 실행. 번역 manifest는 단일 메인 에이전트가 직렬 갱신
- **Check**: 전수 구조·hash·왕복·폰트/이미지/런타임 증거를 완료 기준과 대조
- **Act**: 실패한 배치·행·폰트 asset·이미지만 깨끗한 원본에서 재작업하고 해당 branch부터 반복
- **Handoff**: 문서 drift·우회·미해결 제한·세션 문제를 즉시 append-only 기록

재개 시 `PROJECT.md`의 마지막 미완료 단계와 실제 manifest/hash를 다시 읽는다. 완료된
단계를 의도 없이 전체 재실행하거나, 이전 candidate·이전 세션을 새 산출물로 복제하지 않는다.

## 8. 작업장·타이틀 정리

정리는 `tmp` glob 삭제가 아니다. `$GT_HOME/common/cleanup-contract.md`와 다음 스킬을
사용한다.

- `gt-project-cleanup`: 하나의 타이틀 `_work/<ID>`에 대해 Handoff·manifest·세션·참조를
  추론해 `CLEANUP_PLAN.json`과 `CLEANUP_INSTRUCTIONS.md` 생성
- `gt-workspace-cleanup`: 작업장 루트의 타이틀 중복·미등록 폴더·세션 잔재를 Handoff와
  프로젝트 상태로 대조해 외부 보고서/계획 생성

기본은 이동·삭제하지 않는다. `approved=true`인 exact 파일과 현재 plan SHA-256을 명시한
`--apply --plan`은 후보를 cleanup archive로 옮길 뿐 영구 삭제하지 않는다. 이어서 모든
아카이브 파일과 root/project·Handoff·세션·문서 해시를 다시 검사한
`CLEANUP_ARCHIVE_REVIEW.md`를 사용자에게 상세히 보고하고 그 turn을 종료한다.

휴지통 이동은 사용자가 보고 이후 별도 요청으로 명시적으로 승인한 경우에만
`TRASH_PLAN.json`의 보고·사용자·항목별 승인과 현재 SHA-256을 기록해
`--trash --user-confirmed-trash`로 아카이브 exact 파일에 수행한다. 운영체제 휴지통이
지원되지 않거나 실패하면 영구 삭제로 폴백하지 않고 `BLOCKED`로 중단한다. 보고 이후
상태가 바뀌면 `--review-archive`로 재검토하고 모든 승인을 초기화한다. active 세션·보존
anchor·link/reparse point·계획 밖 경로는 항상 거부한다.

## 9. 신규 프로젝트·완료

신규 프로젝트는 플랫폼 어댑터가 지정한 `project:new`를 사용해 실제 NSP/XCI 보유 폴더
아래에 생성한다. 수동 generic `title` 폴더를 만들지 않는다.

완료는 `gt-qa`의 bench와 공식 배포 릴리즈 non-MCP runtime receipt, 별도 hardware 상태,
`gt-release`의 exact package 계약이 모두 충족될 때만 선언한다. 릴리스 후에도
`gt-project-cleanup`으로 정리 계획을
생성하고, Handoff·manifest·QA·release anchor를 보존한다.

## 10. 빌드·패치 생성 요청의 의미

사용자가 **“빌드 생성”** 또는 **“패치 생성”**이라고 요청하면 이를 중간 staging이나
진단 후보 생성으로 해석하지 않는다. 플랫폼 어댑터의 canonical 배포 패키지를 생성하는
요청으로 라우팅한다. NSW에서는 `gt-release`와 `platforms/nsw/release.md`를 적용하여
`40_build/layeredfs/<BASE_TITLE_ID>/romfs/`의 검증된 패치 파일만 입력하고,
`40_build/releases/<BASE_TITLE_ID>.zip` 안에
`<BASE_TITLE_ID>/romfs/<패치파일>` 구조를 만든다. 별도 Python 적용기, `*.gldelta`,
버전/candidate 하위 폴더, 게임명 ZIP은 허용하지 않는다. 릴리스 완료 게이트가 아직
충족되지 않았다면 같은 canonical 형식의 `review_candidate`로 만들 수 있지만 경로·이름·
ZIP root 계약은 완화하지 않고 `release_status`도 `released`로 올리지 않는다.
