---
name: gt-image-qa
description: "Run technical and visual QA after image translation: validate no-API built-in imagegen multi-candidate provenance, source protection, original Korean visual feel, source-text removal, canvas, alpha, anchors, atlases, preserved pixels, hashes, and injection readiness. Use after gt-image-translate."
---

# gt-image-qa — 이미지 브랜치 I3: 이미지 기술 QA

번역 이미지가 통합 빌드에 안전하게 들어갈 수 있는지 전수 검사한다. 기술 통과를 사용자 승인이나
런타임 PASS로 승격하지 않는다.

## 입력 조건

- `PROJECT.md`, `gt-image-analyze` 산출물, `gt-image-translate` 후보
- 원본·후보·staging의 exact path, stable key, 수량, SHA-256
- canvas/format/alpha/atlas/import 계약
- `$GT_HOME/common/image-translation-contract.md`, `IMAGE_GENERATION_MANIFEST.tsv`,
  prompt·schema 3 receipt 또는 검증된 size-normalization schema 4 receipt·모든 시도 output·decoded RGBA probe

`hold-for-imagegen-review`, 누락·추가·중복 후보, 원본 hash 변경은 `BLOCKED`다.
`image_scope=N/A`이면 가짜 행을 만들지 않고 `image_status=skipped`로 기록한다.

## 절차

1. 계획·원본·reference·후보·모든 attempt·prompt·receipt·probe의 귀속과 수량·hash를 확인한다.
2. **내장 imagegen provenance 게이트**를 적용한다. agent-generated 행은 receipt schema 3 또는
   크기 정규화 provenance가 연결된 schema 4의
   `tool=image_gen.imagegen`, `execution_surface=chatgpt-built-in`, `model=provider-selected`,
   `quality=provider-managed`, `candidate_policy=best-of-3-fail-closed`, `minimum_candidates=3`,
   `operation=edit`만 허용한다. 3–4개 물리적으로 다른 output과 정확히 하나의 합격
   `selected_attempt`가 있어야 한다.
3. API/CLI, Python/Pillow/OpenCV/임의 스크립트 raster provenance, text-to-image 재생성,
   복사본을 독립 호출로 센 receipt, source/reference/candidate 경로 충돌을 즉시 실패시킨다.
   schema 4는 PNG/RGBA8·동일 종횡비·`canvas-size-only`·고정 bilinear 알고리즘과 원본 schema 3
   receipt/raw candidate/probe hash가 모두 연결된 경우만 허용한다. 정규화가 다른 QA 실패를
   가리거나 crop/pad/atlas 변경을 포함하면 즉시 실패시킨다.
4. canvas, format, color mode, alpha, compression, mip, atlas page/rect, padding, UV origin,
   sprite ID, clear bbox와 보존 영역을 전수 비교한다.
5. 다음 기계 검증을 독립 실행한다.

   ```bash
   node "$GT_HOME/scripts/validate-image-translation.mjs" \
     --project-root "<프로젝트 루트>" \
     --manifest "<프로젝트 루트>/30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv"
   ```

   기본 alpha는 전 픽셀 exact다. 분석에서 증명한 글자 alpha 자산만 edit region 안 변경을
   허용한다. 영역 밖 decoded RGBA는 diff 0이고 source/candidate anchor와 atlas rect가 exact여야
   한다. `Issues: 0`이 아니면 `BLOCKED`다.
6. **후보별 시각·문자 전수 검사**를 수행한다. 각 attempt의 before/after를 열어 다음을 판정한다.
   - 원문 glyph·외곽선·그림자·발광·안티앨리어싱 흔적 완전 제거와 no-overlay
   - 정확한 한글, 오탈자·추가 문자·중복 렌더링 없음
   - 원본 분위기, 서체 인상·굵기·획 끝·크기, 색/그라데이션, 외곽선/그림자/발광,
     질감/재질/광원, 자간/행간/baseline/정렬 보존
   - canvas/layout/alpha/atlas와 비대상 영역 보존

   선택 후보가 읽히기만 하고 원어의 시각적 정체성과 어울리지 않으면
   `original_feel_status=fail` 및 `BLOCKED`다. 탈락 사유가 없는 rejected 후보나 QA 실패를
   숨긴 selected 후보도 실패시킨다.
7. 후보를 새 canonical staging에 주입하고 재추출해 계획표와 exact 비교한다. 원본은 덮어쓰지
   않는다.
8. `IMAGE_QA_REPORT.md`와 `IMAGE_BUILD_MANIFEST.tsv`에 모든 attempt의 결과, 선택 근거,
   input/output/staging hash, pixel/metadata diff와 실패 행을 기록한다.
9. 전 항목 통과 시 `image_status=qa_ready`를 기록하고 `gt-image-review`로 진행한다.

## 산출물

- `30_translation/image_translation/reports/IMAGE_QA_REPORT.md`
- `30_translation/image_translation/reports/IMAGE_BUILD_MANIFEST.tsv`
- canonical image staging과 원본/후보/staging hash

## 완료 기준

- [ ] required stable key, 3–4개 attempt, 선택 후보의 수량·path·hash가 일치함
- [ ] 내장 imagegen best-of-3 provenance와 원본 비덮어쓰기 검증 통과
- [ ] 원문 흔적·겹쳐쓰기 0건과 원본 느낌 보존 검증 통과
- [ ] canvas·format·alpha policy·atlas·anchor·padding·보존 영역 검증 통과
- [ ] 현재 manifest validator 결과 `Issues: 0`, hold·미확인 항목 0건
- [ ] `image_status=qa_ready`가 기록되고 `gt-image-review`로 진행 가능함
