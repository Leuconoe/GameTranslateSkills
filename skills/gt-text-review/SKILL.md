---
name: gt-text-review
description: "Text branch review handoff after technical QA: inspect the complete translated text sheet and emulator-ready candidate, record unresolved issues and optional user review materials, and continue automatically by default. Use after gt-text-qa when text review preparation, font/layout evidence, or an explicit user-gate policy must be handled."
---

# gt-text-review — 텍스트 브랜치 T4: 검수 handoff

이 단계의 검수는 번역·폰트·구조 QA가 끝난 결과를 에뮬레이터/통합 QA에 넘길 수 있도록
검수 시트와 준비 자료를 정리하는 것이다. `text_review_policy=prepare-only`가 기본이며,
이 경우 사용자에게 허락을 묻거나 작업을 중단하지 않는다. `user-gate`를 프로젝트에
명시한 경우에만 아래 산출물을 제출하고 명시적 승인을 기다린다.

## 입력 조건

- `gt-text-qa` 완료: `text_status=qa_ready`, `font_status=verified`
- `TEXT_QA_REPORT.md`, `TEXT_BUILD_MANIFEST.tsv`, `FONT_ATLAS_MANIFEST.tsv`,
  `FONT_COVERAGE.tsv`의 최신 해시
- canonical `translation_manifest.tsv`, `glossary.tsv`, `STYLE.md`
- `PROJECT.md`의 `text_review_policy`와 현재 text staging 경로

font manifest·render probe·왕복 보고서가 없거나 현재 입력 해시와 다르면 검수 시트를
만들어 완료 처리하지 말고 `BLOCKED`로 돌린다. 이 단계에서 폰트 위치 문제를 시각적으로
발견하면 `gt-text-qa`로 되돌려 원인(좌표계·padding·metrics·consumer·fallback)을 고친다.

## 절차

1. **입력 재확인**: 행 수·안정 ID·원문·target_ko·제어 토큰·용어집·폰트 manifest와
   text candidate의 해시를 exact 비교한다. 다른 candidate·Title ID·세션의 증거는 현재
   결과로 승격하지 않는다.
2. **전체 검수 시트 생성**: `30_translation/text/reviews/REVIEW_TEXT.tsv`에 모든
   텍스트 행을 넣는다. 최소 컬럼은 `id`, `source_file`, `source_key`, `원문`, `번역`,
   `상태`, `font_status`, `layout_risk`, `사용자의견`, `비고`다. 샘플링하지 않는다.
   `layout_risk`에는 표시 폭·줄 수·baseline·루비·제어 토큰·폰트 의존성 위험을 적는다.
3. **검수 요약**: `TEXT_REVIEW_HANDOFF.md`에 총 행·실제 변경 행·no-op·blocked/low
   confidence·폰트 probe 범위·candidate/build/font manifest 해시·다음 단계와 알려진
   제한을 기록한다. 검수 시트와 handoff는 `artifact_key` 하나로 manifest에 등록한다.
4. **정책 분기**:
   - `prepare-only`: 시트·handoff·candidate가 완성되면 `text_status=review_ready`,
     `text_review_approval=not_required`, `text_review_result=prepared`를 기록하고 즉시
     `gt-image-analyze` 또는 `gt-qa`로 진행한다. 사용자 응답을 기다리지 않는다.
   - `user-gate`: `text_review_approval=pending`, `text_status=review_waiting`으로
     기록하고 중단한다. 사용자가 PROJECT.md의 approval을 `approved`로 명시적으로
     변경하기 전에는 `review_ready`로 바꾸지 않는다. 수정이 들어오면 해당 행만 반영하고
     `gt-text-qa`의 폰트·왕복 검사를 다시 수행한다.
5. **상태 분리**: `review_ready`는 사용자 승인, 런타임 PASS, 릴리스 준비를 의미하지
   않는다. `PASS (bench)`, `PASS (runtime)`, `user-approved`를 각각 별도 증거로 둔다.

## 산출물

- `30_translation/text/reviews/REVIEW_TEXT.tsv`
- `30_translation/text/reviews/TEXT_REVIEW_HANDOFF.md`
- candidate·font·coverage·QA manifest 해시와 `PROJECT.md` 상태 기록

## 완료 기준

- [ ] `text_status=qa_ready`와 `font_status=verified`가 현재 입력에 귀속됨
- [ ] 전체 행 검수 시트와 폰트/레이아웃 위험 정보가 생성됨
- [ ] handoff에 candidate·font manifest·왕복·probe 증거가 연결됨
- [ ] `prepare-only`면 중단 없이 `text_status=review_ready`로 전달됨
- [ ] `user-gate`면 명시적 승인 전 `review_ready`·통합 QA로 진행하지 않음
