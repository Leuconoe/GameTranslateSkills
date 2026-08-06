---
name: gt-text-review
description: "Stage 3 of game localization - generate a TSV review sheet, detect translation/manifest/glossary problems, and STOP for mandatory explicit user review/approval before applying corrections. Use when user reviews translations/텍스트 검수/번역 검토."
---

# gt-text-review — 3단계: 사용자 텍스트 검수 게이트

번역 결과를 검수 시트로 정리해 사용자에게 제출하고, **승인까지 작업을 중단**한다.

> `$GT_HOME` = 지식 베이스 루트. Codex에서는 이 스킬이 설치된 플러그인 루트(상위에 `.codex-plugin/`, `skills/`, `common/`이 있는 디렉터리)로 해석하고, Claude Code 플러그인에서는 `${CLAUDE_PLUGIN_ROOT}`를 사용한다. 플러그인 외 수동 설치는 지원하지 않는다.
> 시작 전에 `$GT_HOME/common/preflight-checks.md`를 읽고 입력 manifest·용어집·상태값·승인 게이트를 확인한다.
> 작업 중 문서와 실제의 괴리·막힌 지점·우회법을 발견하면 **즉시** 프로젝트 `HANDOFF.md`에 기록한다 (`$GT_HOME/common/handoff-rules.md`).

## 입력 조건

- `gt-text-translate` 완료 (전 배치 구조 검증 통과, 용어집 위반 0건)
- `30_translation/text/glossary.tsv`와 입력 manifest의 최신 해시·행 수 확인

## 절차

0. **검수 입력 경고 게이트**: 번역 결과의 행 수·안정 ID·원문·제어 토큰이 manifest와
   exact로 맞는지 확인한다. 누락·중복·상태 불일치·용어집 경로 불일치가 있으면 검수 시트를
   승인 가능한 것으로 만들지 말고 `BLOCKED`와 원인을 기록한다.

1. **자체 2차 검수 (제출 전)**: `$GT_HOME/common/glossary-rules.md`의 독립 2차 검수
   절차 수행 — 번역을 수행하지 않은 시각(새 컨텍스트/서브에이전트)으로 오역·누락·
   말투 불일치·용어집 위반을 스캔하고 수정. 발견·수정 내역을 기록.
2. **검수 시트 생성**: `30_translation/REVIEW_TEXT.tsv` 생성.
   - 컬럼: `id │ 파일 │ 원문 │ 번역 │ 상태 │ 사용자수정 │ 비고`
   - 전체 행 포함 (샘플링 금지). 행이 많으면 파일별/챕터별로 분할 시트 생성
   - `비고`에 번역 시 판단이 필요했던 항목(중의적 표현, 용어 선택 근거) 표시
3. **요약 리포트**: 시트와 함께 통계 제시 — 총 행수, 용어집 항목 수, 캐릭터별 말투 요약,
   자체 검수에서 수정된 건수, 특히 사용자 판단이 필요한 항목 목록.
4. **⛔ 중단**: 사용자에게 시트 경로와 검수 방법을 안내하고 **작업을 완전히 중단**한다.
   - 안내문 예: "검수 시트: `<경로>` — `사용자수정` 컬럼에 수정안을 적거나 `번역` 컬럼을
     직접 고친 뒤 '검수 완료'라고 알려주세요."
   - 승인 전에 4단계 이후를 진행하는 것은 금지. 대기 중 다른 준비 작업(이미지 목록
     정리 등 읽기 전용)만 허용.
5. **수정 반영**: 사용자가 검수 완료를 알리면:
   - 시트의 수정분을 diff로 확인하고 `30_translation/text/*.tsv` 원본 시트에 반영
   - 수정된 용어가 있으면 `30_translation/text/glossary.tsv` 갱신 + 동일 용어 사용처 전체 일괄 수정
   - 수정 반영 후 구조 검증 재실행
6. **승인 기록**: 사용자가 명시적으로 검수 완료를 선언한 뒤에만 `PROJECT.md`에 검수 완료
   일시·수정 건수·검수 시트 해시·승인 근거를 기록하고 상태를 `approved`로 바꾼다.
   Codex의 자체 2차 검수나 사용자가 파일을 열어 본 사실만으로 `approved`로 바꾸지 않는다.

## 산출물

- `30_translation/REVIEW_TEXT.tsv` (사용자 수정 반영 완료본)
- 갱신된 `text/*.tsv`, `30_translation/text/glossary.tsv`
- `PROJECT.md` 승인 기록

## 완료 기준

- [ ] 사용자가 명시적으로 검수 완료를 선언함
- [ ] 사용자 수정분이 원본 시트와 용어집에 반영되고 구조 검증 통과
- [ ] 사용자 승인 전에는 이미지 번역·QA·릴리스로 진행하지 않음
