# game-translate-skills Design (PDCA: Design)

> **Superseded design note (2026-08-07):** The 7-stage tables in this historical document are
> retained as source history. Implementations must follow `common/pipeline-contract.json` and
> `common/pipeline-contract.md`, which split text and image work into analyze → translate → QA →
> review-handoff stages and make user approval conditional on explicit project policy.

> 작성일: 2026-08-04 | 상태: v1.0 | Plan: docs/01-plan/game-translate-skills.plan.md (D1-D10)

## 1. 저장소 레이아웃

```
E:\GameTranslateSkills\
├── .codex-plugin/plugin.json   # Codex 플러그인 manifest
├── .agents/plugins/marketplace.json # Codex repo marketplace
├── skills/                      # Codex/Claude Code 공용 스킬 (플러그인 배포)
│   ├── game-translate/SKILL.md  # 오케스트레이터
│   ├── gt-analyze/SKILL.md
│   ├── gt-text-translate/SKILL.md
│   ├── gt-text-review/SKILL.md
│   ├── gt-image-translate/SKILL.md
│   ├── gt-image-review/SKILL.md
│   ├── gt-qa/SKILL.md
│   └── gt-release/SKILL.md
├── platforms/                   # 플랫폼 어댑터 (스킬이 참조하는 지식 베이스)
│   ├── _template/PLATFORM.md    # 어댑터 양식 (신규 플랫폼 확장용)
│   ├── nsw/                     # 완전 이식 (1차)
│   │   ├── PLATFORM.md          # 개요·도구 체인·폴더 구조
│   │   ├── extract.md           # 추출·엔진분석·언어슬롯
│   │   ├── build-test.md        # 빌드·에뮬레이터 실기시험
│   │   └── release.md           # LayeredFS 배포 패키징
│   ├── sfc/PLATFORM.md          # 골격
│   ├── ps1/PLATFORM.md          # 골격
│   ├── ps2/PLATFORM.md          # 골격
│   └── steam/PLATFORM.md        # 골격
├── engines/                     # 엔진 모듈 (플랫폼과 직교)
│   ├── unity/ENGINE.md          # UABEA·Il2Cpp·TMP/SDF 한글 폰트
│   ├── vn-common/ENGINE.md      # GARbro·msg-tool·pfs-rs
│   └── lucasystem/ENGINE.md     # LuckSystem
├── common/
│   ├── SAFETY.md                # 안전 규칙 (AGENTS.md에서 일반화 추출)
│   ├── emucap-integration.md    # 선택적 런타임 QA MCP 연동 계약
│   ├── glossary-rules.md        # 용어집·말투 누적 규칙
│   └── project-structure.md     # 표준 작업 폴더 구조 (00_source~90_tools)
├── package.json                 # 크로스플랫폼 npm 명령
├── setup/
│   ├── install-tools.mjs        # 도구 자동 다운로드/배치 (공식 릴리스 URL만)
│   └── tools.manifest.json      # 도구별 이름·버전·URL·용도·배치 경로
├── scripts/
│   ├── new-translation-project.mjs   # 원본 작업장에서 범용화 이식
│   ├── validate-translation-projects.mjs
│   └── clean-translation-project.mjs # tmp-* / *.tmp dry-run·allowlist 정리
├── docs/                        # PDCA 문서
└── README.md
```

## 2. 스킬 공통 규격

- frontmatter: `name`, `description` (영어, 트리거 키워드 포함), 본문 한국어
- 각 단계 스킬 공통 골격:
  1. **입력 조건** — 이전 단계 산출물 확인 (없으면 이전 스킬 안내)
  2. **플랫폼 어댑터 로드** — `<repo>/platforms/<platform>/` 문서 읽기 지시
  3. **절차** — 플랫폼 무관 공통 절차
  4. **산출물** — 다음 단계가 소비하는 파일 계약
  5. **완료 기준·중단 조건** — 게이트 규칙
- 스킬은 게임 데이터 경로를 `GT_WORKSPACE`(작업 루트) 기준 상대 규약으로만 다룸

## 3. 단계 간 산출물 계약 (파이프라인 인터페이스)

| 단계 | 스킬 | 산출물 (다음 단계 입력) |
|-----|------|----------------------|
| 1 | gt-analyze | `SOURCE_INVENTORY.tsv`, `ANALYSIS.md` (엔진·포맷·언어슬롯·폰트·이미지 목록) |
| 2 | gt-text-translate | `30_translation/text/*.tsv` (원문│번역│상태), `GLOSSARY.tsv`, `STYLE.md` |
| 3 | gt-text-review | `REVIEW_TEXT.tsv` 검수 시트 → 사용자 수정 반영 후 `approved` 마킹 |
| 4 | gt-image-translate | `image_scope=required`일 때 codex: 번역 이미지 파일 / claude: `IMAGE_PLAN.tsv` (분석·보류); `N/A`면 생략 기록 |
| 5 | gt-image-review | `required`일 때 `REVIEW_IMAGE.tsv` (before/after 경로) → 사용자 승인; `N/A`면 생략 |
| 6 | gt-qa | 구조 무결성 리포트, 빌드 산출물, 실행시험 로그·캡처 |
| 7 | gt-release | 배포 패키지 (플랫폼별: LayeredFS ZIP 등) + `RELEASE_NOTES.md` |

## 4. 사용자 검수 게이트 (3단계 + `image_scope=required`일 때 5단계)

- 검수 시트(TSV) 생성 후 **작업을 명시적으로 중단**하고 사용자에게 시트 경로 안내
- 사용자가 시트 수정 → "검수 완료" 응답 시 수정분 diff 반영 후 다음 단계
- 게이트 통과 없이 다음 단계 진행 금지 (오케스트레이터가 강제). `image_scope=N/A`면
  0건 inventory·근거를 기록하고 5단계 게이트 없이 QA로 이동한다.

## 5. 에이전트별 분기 (4단계)

- SKILL.md에 명문화: **Codex 환경**이면 imagegen 스킬로 이미지 생성, **Claude 환경**이면
  이미지 분석(`IMAGE_PLAN.tsv` 작성)까지만 하고 생성은 보류 상태로 사용자에게 이관

## 6. 플랫폼 어댑터 인터페이스 (PLATFORM.md 필수 섹션)

1. 플랫폼 개요·전제 (필요 파일, 합법적 개인 사용 전제)
2. 도구 체인 (추출/리팩/실행)
3. 추출 절차
4. 빌드/패치 방식 (예: NSW LayeredFS, SFC IPS/BPS, PS1/PS2 ISO 리빌드, Steam 파일 교체)
5. 실행 시험 (에뮬레이터/실기)
6. 배포 패키징 규격

## 7. 구현 순서 (Do)

1. 소스 노하우 증류 (병렬 에이전트): NSW 지침 → platforms/nsw/ + engines/, Codex 워크플로우 + AGENTS.md → common/
2. 스킬 8종 작성 (본인)
3. 플러그인 manifest/marketplace + setup 도구 + README
4. Check: 스킬 문서 상호 참조 무결성 + 기존 타이틀 워크플로우와 대조 갭 분석
