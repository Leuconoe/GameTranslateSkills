---
name: gt-image-review
description: "Image branch review handoff after technical QA: prepare a complete before/after comparison and atlas/style risk report, mark image review ready by default without waiting for user approval, and honor an explicit user-gate policy when configured. Use after gt-image-qa."
---

# gt-image-review — 이미지 브랜치 I4: 이미지 검수 handoff

이미지 검수는 기술 QA 결과와 before/after 비교 자료를 통합 QA에 넘길 수 있도록 정리하는
단계다. 기본 `image_review_policy=prepare-only`에서는 중단하지 않는다. `user-gate`를
명시한 프로젝트만 사용자 승인 대기를 활성화한다.

## 입력 조건

- 시작 전에 `PROJECT.md`, `WORK_LOG.md`, `HANDOFF.md`, `preflight-checks.md`와 현재 manifest/hash를 읽는다. 경로·수량·소유권을 증명하지 못하면 `BLOCKED`로 유지한다.
- `image_scope=required`, `image_status=qa_ready`, `IMAGE_QA_REPORT.md`,
  `IMAGE_BUILD_MANIFEST.tsv`
- `IMAGE_PLAN.tsv`와 실제 후보의 stable key·canvas·format·alpha·atlas·hash
- text branch handoff와 glossary/style hash
- `image_scope=N/A`이면 이 스킬을 실행하지 않고 `image_status=skipped` 근거를 확인해
  `gt-qa`로 이동한다.

## 절차

1. 원본·후보·staging의 현재 hash와 계획 행을 exact 대조한다. 다른 세션·다른 candidate의
   comparison을 재사용하지 않는다.
2. `30_translation/image_translation/reports/REVIEW_IMAGE.tsv`에 모든 이미지와 atlas
   region을 행으로 만든다. 최소 컬럼은 `id`, before/after 경로, stable key, 원문, 번역,
   canvas, alpha, atlas rect, style 상태, `layout_risk`, `사용자의견`, `상태`다.
3. `IMAGE_REVIEW_HANDOFF.md`에 전체 수량·변경/no-op·보존 영역 diff·스타일 위험·후보/
   QA/build manifest hash·다음 단계·제한을 기록한다.
4. 정책을 적용한다.
   - `prepare-only`: `image_status=review_ready`, `image_review_approval=not_required`,
     `image_review_result=prepared`로 기록하고 즉시 `gt-qa`로 진행한다.
   - `user-gate`: `image_review_approval=pending`, `image_status=review_waiting`으로
     기록하고 사용자가 PROJECT.md의 approval을 `approved`로 명시적으로 변경하기 전에는
     `review_ready`나 통합 QA로 진행하지 않는다. 재작업 후 `gt-image-qa`부터 다시 실행한다.
5. `review_ready`는 사용자 승인·runtime PASS·release readiness가 아님을 handoff에 명시한다.

입력 hash, atlas rect, canvas/alpha, 정책 또는 산출물 수가 서로 다르면 review sheet를
완료 처리하지 않고 `PROJECT.md`에 `image_status=blocked`와 Handoff 근거를 기록한다.

## 산출물

- `30_translation/image_translation/reports/REVIEW_IMAGE.tsv`
- `30_translation/image_translation/reports/IMAGE_REVIEW_HANDOFF.md`
- candidate·QA/build manifest hash와 PROJECT 상태

## 완료 기준

- [ ] 모든 이미지·atlas region의 before/after 비교 행이 있음
- [ ] 기술 QA·스타일·보존 영역·hash 증거가 handoff에 연결됨
- [ ] `prepare-only`면 중단 없이 `review_ready`와 `gt-qa` 전달이 완료됨
- [ ] `user-gate`면 명시적 승인 전 통합 QA로 진행하지 않음
