---
name: gt-image-qa
description: "Image branch technical QA after image translation: validate every texture and atlas candidate for canvas, alpha, format, coordinates, style, preserved pixels, hashes, and injection readiness before image review. Use after gt-image-translate."
---

# gt-image-qa — 이미지 브랜치 I3: 이미지 기술 QA

사용자 시각 검수와 별개로, 번역 이미지가 통합 빌드에 안전하게 들어갈 수 있는지 전수
검사한다. 기술적으로 통과해도 사용자 검수나 런타임 PASS로 승격하지 않는다.

## 입력 조건

- `gt-image-analyze`의 세 산출물과 `gt-image-translate`의 for_translation 후보
- `PROJECT.md`의 `image_scope`, `image_status`, text handoff·glossary hash
- 원본·후보·staging의 exact path, stable key, 수량, SHA-256
- 플랫폼·엔진의 canvas/format/alpha/atlas/import 계약

Claude의 `hold-for-generation`, 누락·추가·중복 후보, 원본 hash 변경은 `BLOCKED`다.
`image_scope=N/A`면 가짜 후보·검수 행을 만들지 않고 `image_status=skipped`로 기록한다.

## 절차

1. 계획·원본·후보의 1:1 귀속과 수량·hash를 확인한다. 같은 파일명이라도 stable key와
   runtime consumer가 다르면 별도 행으로 처리한다.
2. **기술 전수 검사**: canvas, format, color mode, alpha, compression, mip, atlas page,
   x/y/width/height, padding, UV origin, sprite ID, clear bbox, 보존 영역을 비교한다.
   rect 경계 밖·겹침·좌표계 변환·metadata 누락은 즉시 실패다.
3. **시각·문자 검사**: 오탈자·glossary·style·폰트·색·외곽선·여백·active/inactive와
   원본/후보의 decoded RGBA 차이를 확인한다. 보존 영역 차이는 허용 목록 밖이면 실패다.
4. **왕복 검사**: 후보를 canonical staging에 주입하고 독립 추출해 계획표와 exact 비교한다.
   staging은 원본을 덮어쓰지 않으며, 임의 경로·복사본을 만들지 않는다.
5. `IMAGE_QA_REPORT.md`와 `IMAGE_BUILD_MANIFEST.tsv`에 입력·출력·staging hash,
   pixel/metadata diff, 허용 변경과 실패 행을 기록한다.
6. 전 항목 통과 시 `image_status=qa_ready`를 기록하고 `gt-image-review`로 진행한다.
   기술 QA는 사용자 승인이나 runtime PASS가 아니다.

## 산출물

- `30_translation/image_translation/reports/IMAGE_QA_REPORT.md`
- `30_translation/image_translation/reports/IMAGE_BUILD_MANIFEST.tsv`
- canonical image staging과 원본/후보/staging hash

## 완료 기준

- [ ] required 모든 stable key가 1:1이며 수량·hash가 일치함
- [ ] canvas·format·alpha·atlas·좌표·padding·보존 영역 검증 통과
- [ ] style/decoded RGBA/왕복 검증 결과가 행별로 있음
- [ ] hold·누락·추가·중복·미확인 항목이 없음
- [ ] `image_status=qa_ready`가 기록되고 review로 자동 진행 가능함
