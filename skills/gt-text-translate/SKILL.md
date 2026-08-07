---
name: gt-text-translate
description: "Stage 2 of game localization - batch-translate extracted game text (JA/EN/ZH to Korean) with glossary accumulation, tone consistency, structure validation, explicit batch-policy checks, and fail-closed warnings. Use when translating game text/텍스트 번역/대사 번역."
---

# gt-text-translate — 2단계: 텍스트 번역

추출된 텍스트를 배치 단위로 일→한(또는 영/중→한) 번역하고 용어집·말투를 누적 관리한다.

> `$GT_HOME` = 지식 베이스 루트. Codex에서는 이 스킬이 설치된 플러그인 루트(상위에 `.codex-plugin/`, `skills/`, `common/`이 있는 디렉터리)로 해석하고, Claude Code 플러그인에서는 `${CLAUDE_PLUGIN_ROOT}`를 사용한다. 플러그인 외 수동 설치는 지원하지 않는다.
> 시작 전에 `$GT_HOME/common/preflight-checks.md`를 읽고 `batch_size`, 용어집 경로, manifest 해시와 타이틀별 override를 확인한다.
> 작업 중 문서와 실제의 괴리·막힌 지점·우회법을 발견하면 **즉시** 프로젝트 `HANDOFF.md`에 기록한다 (`$GT_HOME/common/handoff-rules.md`).

## 입력 조건

- `gt-analyze` 산출물: `ANALYSIS.md`의 텍스트 대상 목록
- 상세 규칙 로드: `$GT_HOME/common/glossary-rules.md` (배치 구성·용어집·검증 규칙의 원본)
- `PROJECT.md`의 유효 배치 크기와 `30_translation/text/glossary.tsv` 경로 선언

## 절차

0. **배치·경로 사전 점검**: 공통 기본 배치는 편집 대상 80행이다. 40행 등 다른 크기는
   `PROJECT.md`의 명시적 override와 근거가 있을 때만 사용하고, 중앙 지침·title-local workflow·
   manifest가 같은 값을 쓰는지 확인한다. 문서가 충돌하거나 override가 없으면 임의로 축소하지
   말고 `WARN`/`BLOCKED`와 `HANDOFF.md` 기록 후 읽기 전용 조사만 한다. 용어집은 오직
   `30_translation/text/glossary.tsv`를 사용한다.

1. **기준 언어 결정**: 원문 품질이 가장 좋은 언어를 기준 언어로, 나머지를 참고 언어로.
   중의적 표현은 참고 언어와 교차 확인 (`glossary-rules.md` §기준 언어).
2. **텍스트 → TSV 변환**: 게임 포맷의 텍스트를 `30_translation/text/*.tsv`로 변환.
   컬럼: `id │ 원문 │ 번역 │ 상태 │ 비고`. 변환 스크립트는 `90_tools/`에 보관하고
   **역변환(TSV→게임 포맷)이 무손실임을 왕복 테스트로 먼저 증명**한다.
3. **배치 구성**: `glossary-rules.md`의 chunk 전략에 따라 배치 분할.
   여러 에이전트가 같은 파일을 동시에 쓰지 않도록 단일 메인 에이전트가 chunk를 처리하고,
   서브에이전트는 읽기 전용 조사만 담당.
4. **1차 번역·윤문**: 배치별 번역. 규칙:
   - 인게임 텍스트·UI 우선 (시스템 메시지보다 사용자가 보는 텍스트 먼저)
   - 플레이스홀더(`%s`, `{0}`, 제어코드, 태그, 개행)는 **원문 그대로 보존**
   - 말투(존댓말/반말, 캐릭터별 어투)는 `STYLE.md`에 캐릭터별로 정의하고 일관 적용
   - UI 텍스트는 표시 폭 제한 고려 (원문보다 과도하게 길어지지 않게)
5. **용어집 누적**: 고유명사(인명·지명·아이템·스킬명)는 첫 등장 시
   `30_translation/text/glossary.tsv`에
   `원문 │ 번역 │ 유형 │ 근거` 로 등록하고 이후 배치에서 강제 준수. 배치 시작 전
   용어집을 프롬프트에 주입.
6. **배치별 구조 검증**: 번역 완료 배치마다 즉시 검증 (병합 게이트):
   - 행 수/ID 일치, 플레이스홀더·태그·개행 보존, 빈 번역 없음, 미번역 원문 잔존 없음
   - 검증 실패 배치는 병합 금지, 해당 배치만 수정 후 재검증
7. **작업 로그**: 배치별 상태(완료/실패/재실행)를 `30_translation/WORKLOG.md`에 기록.
   실패 배치는 원인과 함께 기록하고 재실행 시 실패분만 처리.

## 산출물

| 파일 | 내용 |
|-----|------|
| `30_translation/text/*.tsv` | 번역 시트 (전 행 상태 표시) |
| `30_translation/text/glossary.tsv` | 누적 용어집 |
| `30_translation/STYLE.md` | 말투·문체 규칙 (캐릭터별) |
| `30_translation/WORKLOG.md` | 배치 작업 로그 |

## 완료 기준

- [ ] 대상 텍스트 100% 번역 (상태=translated), 구조 검증 전 배치 통과
- [ ] 용어집 위반 0건 (전 배치 대상 용어집 대조 스캔)
- [ ] 왕복 변환(TSV→게임 포맷→TSV) 무손실 확인
- [ ] 배치 크기·용어집 경로·입력 manifest 해시가 `PROJECT.md`와 일치함

완료 시 `gt-text-review`(사용자 검수 게이트)로 진행한다. **검수 없이 4단계 진행 금지.**
