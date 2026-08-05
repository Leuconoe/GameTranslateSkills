---
name: gt-image-review
description: "Stage 5 of game localization - present before/after image comparison sheet and STOP for mandatory user approval of translated images. Use when user reviews translated images/이미지 검수."
---

# gt-image-review — 5단계: 사용자 이미지 검수 게이트

번역 이미지를 원본과 비교 가능한 형태로 정리해 사용자에게 제출하고, **승인까지 중단**한다.

> `$GT_HOME` = 지식 베이스 루트. Codex에서는 이 스킬이 설치된 플러그인 루트(상위에 `.codex-plugin/`, `skills/`, `common/`이 있는 디렉터리)로 해석하고, Claude Code 플러그인에서는 `${CLAUDE_PLUGIN_ROOT}`를 사용한다. 플러그인 외 수동 설치는 지원하지 않는다.
> 작업 중 문서와 실제의 괴리·막힌 지점·우회법을 발견하면 **즉시** 프로젝트 `HANDOFF.md`에 기록한다 (`$GT_HOME/common/handoff-rules.md`).

## 입력 조건

- `gt-image-translate` 완료: `translated/`에 번역 이미지 존재
  (Claude 보류 상태였다면 사용자/Codex가 이미지를 공급한 뒤 이 단계 진행)

## 절차

1. **검수 시트 생성**: `30_translation/images/REVIEW_IMAGE.tsv`
   - 컬럼: `id │ 원본 경로(before) │ 번역 경로(after) │ 원문 │ 번역 │ 상태 │ 사용자의견`
   - 전 이미지 포함. 아틀라스는 영역별로 행 분리
2. **자체 사전 점검**: 제출 전 각 이미지를 확인 —
   - 오탈자, 용어집 불일치, 원본 대비 스타일 이질감(폰트·색·외곽선)
   - 규격 불일치 (크기·포맷·알파채널)
   - 발견 항목은 수정(Codex) 또는 시트 비고에 표시(Claude)
3. **⛔ 중단**: 시트 경로와 이미지 폴더 경로를 안내하고 **작업을 완전히 중단**한다.
   - 안내문 예: "이미지 검수 시트: `<경로>`. before/after를 비교한 뒤 재작업이 필요한
     행에 `사용자의견`을 적고 '검수 완료'라고 알려주세요."
4. **재작업 반영**: 사용자 의견이 있는 항목은 재생성/수정 후 해당 행만 재검수 요청.
   전 행 승인될 때까지 반복.
5. **승인 기록**: `PROJECT.md`에 검수 완료 일시·재작업 건수 기록.

## 산출물

- `30_translation/images/REVIEW_IMAGE.tsv` (전 행 approved)
- 최종 확정된 `translated/` 이미지 세트

## 완료 기준

- [ ] 사용자가 명시적으로 검수 완료를 선언함
- [ ] 재작업 요청 항목이 모두 반영되고 전 행 `approved`
