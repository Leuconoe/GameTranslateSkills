---
name: gt-image-qa
description: "Image branch technical QA after image translation: validate imagegen provenance, source protection, atmosphere, canvas, alpha policy, format, anchors, atlas coordinates, preserved pixels, hashes, and injection readiness before image review. Use after gt-image-translate."
---

# gt-image-qa — 이미지 브랜치 I3: 이미지 기술 QA

사용자 시각 검수와 별개로, 번역 이미지가 통합 빌드에 안전하게 들어갈 수 있는지 전수
검사한다. 기술적으로 통과해도 사용자 검수나 런타임 PASS로 승격하지 않는다.

## 입력 조건

- `gt-image-analyze`의 세 산출물과 `gt-image-translate`의 for_translation 후보
- `PROJECT.md`의 `image_scope`, `image_status`, text handoff·glossary hash
- 원본·후보·staging의 exact path, stable key, 수량, SHA-256
- 플랫폼·엔진의 canvas/format/alpha/atlas/import 계약
- `$GT_HOME/common/image-translation-contract.md`, `IMAGE_GENERATION_MANIFEST.tsv`,
  stable key별 prompt·receipt·decoded RGBA probe

Claude의 `hold-for-imagegen`, 누락·추가·중복 후보, 원본 hash 변경은 `BLOCKED`다.
`image_scope=N/A`면 가짜 후보·검수 행을 만들지 않고 `image_status=skipped`로 기록한다.

## 절차

1. 계획·원본·reference·후보·prompt·receipt·probe의 1:1 귀속과 수량·hash를 확인한다.
   같은 파일명이라도 stable key와 runtime consumer가 다르면 별도 행으로 처리한다.
2. **imagegen provenance 게이트**: agent-generated 행은 `image_gen.imagegen` edit receipt만
   허용한다. Python/Pillow/OpenCV/임의 스크립트 provenance, text-to-image 재생성,
   source/reference/candidate 경로 충돌은 즉시 실패다.
3. **기술 전수 검사**: canvas, format, color mode, alpha, compression, mip, atlas page,
   x/y/width/height, padding, UV origin, sprite ID, clear bbox, 보존 영역을 비교한다.
   rect 경계 밖·겹침·좌표계 변환·metadata 누락은 즉시 실패다.
4. **기계 보존 검사**: 다음 명령을 독립 실행한다.

   ```bash
   node "$GT_HOME/scripts/validate-image-translation.mjs" \
     --project-root "<프로젝트 루트>" \
     --manifest "<프로젝트 루트>/30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv"
   ```

   alpha는 분석에서 선언한 policy를 따른다. 기본은 전 픽셀 exact이고 글자 alpha 자산만
   edit region 안 변경을 허용한다. 영역 밖 decoded RGBA는 diff 0, source/candidate anchor와
   atlas rect는 exact여야 한다. `Issues: 0`이 아니면 `BLOCKED`다.
5. **시각·문자 검사**: 오탈자·glossary·분위기·style·폰트·색·외곽선·여백·정렬·
   active/inactive를 원본/후보 before-after로 확인한다. 편집 영역 안도 원어의 재질·광원·
   감정과 어울리지 않거나 한글이 읽히지 않으면 기계 검사 통과와 무관하게 실패다.
6. **왕복 검사**: 후보를 canonical staging에 주입하고 독립 추출해 계획표와 exact 비교한다.
   staging은 원본을 덮어쓰지 않으며, 임의 경로·복사본을 만들지 않는다.
7. `IMAGE_QA_REPORT.md`와 `IMAGE_BUILD_MANIFEST.tsv`에 입력·출력·staging hash,
   pixel/metadata diff, 허용 변경과 실패 행을 기록한다.
8. 전 항목 통과 시 `image_status=qa_ready`를 기록하고 `gt-image-review`로 진행한다.
   기술 QA는 사용자 승인이나 runtime PASS가 아니다.

## 산출물

- `30_translation/image_translation/reports/IMAGE_QA_REPORT.md`
- `30_translation/image_translation/reports/IMAGE_BUILD_MANIFEST.tsv`
- canonical image staging과 원본/후보/staging hash

## 완료 기준

- [ ] required 모든 stable key가 1:1이며 수량·hash가 일치함
- [ ] imagegen/edit provenance와 원본 비덮어쓰기 검증 통과
- [ ] canvas·format·선언된 alpha policy·atlas·좌표·anchor·padding·보존 영역 검증 통과
- [ ] 분위기/style/decoded RGBA/왕복 검증 결과가 행별로 있음
- [ ] 현재 manifest에 대한 validator 결과가 `Issues: 0`
- [ ] hold·누락·추가·중복·미확인 항목이 없음
- [ ] `image_status=qa_ready`가 기록되고 review로 자동 진행 가능함
