---
name: gt-analyze
description: "Overall analysis entry stage for game localization: extract game files, identify platform/engine/text/image/font formats and language slots, build source inventory, and fail closed on unverifiable extraction or coverage. Use when starting or resuming a game translation project or analyzing ROM/game files."
---

# gt-analyze — 공통 분석: 파일·엔진·언어 슬롯 분석

게임 파일을 추출하고 엔진·포맷·언어 구조를 식별하여 번역 대상 인벤토리를 만든다.

> `$GT_HOME` = 지식 베이스 루트. Codex에서는 이 스킬이 설치된 플러그인 루트(상위에 `.codex-plugin/`, `skills/`, `common/`이 있는 디렉터리)로 해석하고, Claude Code 플러그인에서는 `${CLAUDE_PLUGIN_ROOT}`를 사용한다. 플러그인 외 수동 설치는 지원하지 않는다.
> 시작 전에 `$GT_HOME/common/preflight-checks.md`를 읽고 프로젝트·경로·입력 해시·정책 불일치를 점검한다.
> 작업 중 문서와 실제의 괴리·막힌 지점·우회법을 발견하면 **즉시** 프로젝트 `HANDOFF.md`에 기록한다 (`$GT_HOME/common/handoff-rules.md`).

## 입력 조건

- 프로젝트 폴더가 표준 구조(`$GT_HOME/common/project-structure.md`)로 존재
- 원본 게임 파일의 **위치가 확인**되고 사용자가 합법 보유를 확인
  (원본은 릴리스 폴더 원위치에 읽기 전용으로 유지 — `00_source/`로 복사하지 않는다.
  `00_source/`에는 인벤토리와 메타데이터만 둔다)
- `PROJECT.md`와 `preflight-checks.md`의 현재 프로젝트 루트·Title ID·출력 경로 정책
- 플랫폼 어댑터 로드: `$GT_HOME/platforms/<platform>/PLATFORM.md` + `extract.md`

## 절차

0. **사전 경고 게이트**: `PROJECT.md`, 최근 로그, `git status`, 입력 원본의 절대경로·크기·SHA-256을
   확인한다. 종료 코드 0만으로 추출 성공을 선언하지 않으며, 빈 출력·예상보다 적은 파일·파싱 실패·
   선언 크기와 실제 크기 불일치가 하나라도 있으면 `BLOCKED`로 기록한다. 경로·Title ID·키 조건을
   확정하지 못하면 GUI나 임의 입력으로 우회하지 않는다.

1. **원본 인벤토리**: 원본 파일의 절대경로·크기·해시를 `00_source/SOURCE_INVENTORY.tsv`로
   기록 (컬럼: `path │ size │ sha256 │ 비고`). 원본은 이후 절대 수정·이동하지 않는다.
2. **추출**: 플랫폼 어댑터의 추출 절차 수행 → `10_extract/` (커밋 제외 대상).
   명령줄 도구 우선, GUI 도구는 어댑터가 지정한 경우만.
3. **엔진 식별**: 추출물의 파일 시그니처·폴더 패턴으로 엔진 판별
   (Unity, VN엔진 계열, LucaSystem 등) → 해당 `$GT_HOME/engines/<engine>/ENGINE.md` 로드.
   식별 근거를 `ANALYSIS.md`에 기록.
4. **언어 슬롯 분석**: 게임이 지원하는 언어 목록과 텍스트가 언어별로 어떻게 분리되어
   있는지 확인 (플랫폼 어댑터의 언어 슬롯 절차). 교체 대상 슬롯을 결정하고 근거 기록.
5. **번역 대상 분류**: 추출물에서 다음을 식별하여 `ANALYSIS.md`에 목록화:
   - 텍스트: 대사/UI/시스템 텍스트 파일과 포맷 (인코딩, 제어코드, 플레이스홀더 규칙)
   - 이미지: 문자가 그려진 텍스처/아틀라스 (경로, 포맷, 크기)
   - 폰트: 폰트 파일/아틀라스와 한글 글리프 포함 여부
   - 매뉴얼/기타: 별도 처리 필요 항목
   - 이미지 후보 inventory: 컨테이너 엔트리와 파일명·메타데이터 후보를 전수 기록한다.
     새 프로젝트의 `image_scope`는 `pending`으로 유지하고, 상세 시각 선별과 `required`/
     `N/A` 확정은 텍스트 브랜치 handoff 뒤 `gt-image-analyze`에서 수행한다. 이미 권위 있는
     분석 증거가 있는 재개 프로젝트는 그 값과 근거를 대조하며, 이미지를 열어보지 않은 채
     `N/A`로 추론하지 않는다.
6. **실패 재점검**: 과거 같은 엔진/포맷에서 실패한 기록이 `PROJECT.md`에 있으면
   당시 도구 버전·방법과 현재의 차이를 확인 후 재시도 여부 판단.

## 산출물

| 파일 | 내용 |
|-----|------|
| `00_source/SOURCE_INVENTORY.tsv` | 원본 파일 목록·크기·해시 |
| `10_extract/` | 추출물 (재현 가능해야 함 — 추출 명령을 ANALYSIS.md에 기록) |
| `30_translation/ANALYSIS.md` | 엔진·포맷·언어슬롯·번역 대상 목록·추출 명령 |

## 완료 기준

- [ ] 엔진과 텍스트 포맷이 식별되고 근거가 기록됨
- [ ] 대상 언어 슬롯이 결정됨
- [ ] 텍스트/이미지/폰트 대상 목록이 빠짐없이 작성됨 (전수 조사 — 샘플링 금지).
  이미지의 "전수"는 **컨테이너 엔트리 수준 전수 목록 + 파일명 기반 번역 후보 표시**까지가
 공통 분석 소관이다. `image_scope` 판정에 필요한 시각 선별을 마친 뒤, 상세 이미지 계획과
 스타일 분석은 `gt-image-analyze`의 입력으로 넘긴다.
- [ ] 이미지 후보 inventory가 전수 작성되고, `image_scope=pending` 또는 기존 확정값의
  근거가 명시됨 (`required`/`N/A` 확정과 0건 근거는 `gt-image-analyze` 완료 조건)
- [ ] 추출이 명령 재실행으로 재현 가능
- [ ] 읽지 못한 컨테이너·불명확한 언어 슬롯·추론한 커버리지는 `coverage unknown` 또는 `blocked`로
  남았고, 전수 커버리지로 과장되지 않음

미충족 항목이 있으면 다음 단계로 진행하지 않는다.

완료 시 `gt-text-analyze`로 진행한다. 사용자 승인을 기다리는 단계가 아니다.
