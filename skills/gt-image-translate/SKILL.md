---
name: gt-image-translate
description: "Image branch translation after image analysis: translate text-bearing textures, atlases, and raster labels through imagegen-only edits with fail-closed provenance, source protection, and atmosphere, layout, alpha, pixel, and style preservation. Use when translating game images or textures."
---

# gt-image-translate — 이미지 브랜치 I2: 이미지 번역

`gt-image-analyze`가 확정한 대상만 처리한다. 이미지 안의 텍스트는 text branch의 glossary와
STYLE을 따르며, `$GT_HOME/common/image-translation-contract.md`를 적용한다. 원어의 분위기·
스타일·위치·canvas·alpha·atlas·보존 픽셀 계약을 깨는 생성물은 완료로 처리하지 않는다.

## 입력 조건

- `IMAGE_ANALYSIS.md`, `IMAGE_SOURCE_INVENTORY.tsv`, `IMAGE_PLAN.tsv`
- `gt-text-review` handoff, `text_status=review_ready`, `font_status=verified`
- 엔진·플랫폼의 texture/atlas import contract와 원본 이미지 hash
- `PROJECT.md`의 `image_scope`와 실행 환경(Codex/imagegen 또는 Claude)
- stable key별 atmosphere/style, exact edit region·anchor, byte-exact reference

`image_scope=N/A`이면 계획·가짜 이미지·검수 행을 만들지 않고 0건 근거와
`image_status=skipped`를 기록한 뒤 `gt-qa`로 이동한다. `required`인데 분석·text handoff·
원본 hash가 없으면 `BLOCKED`다.

## 에이전트별 처리

| 환경 | 동작 |
|---|---|
| Codex + imagegen | local reference를 `view_image`로 확인한 뒤 `$imagegen`과 내장 `image_gen.imagegen`의 edit로만 생성 |
| Claude 또는 imagegen 불가 | 계획·분석까지만 하고 `hold-for-imagegen`; Python 등 대체 생성기를 실행하지 않음 |

어느 환경에서도 원본을 그대로 둔 채 번역 완료로 표시하지 않는다.

## 절차

1. 범위·경로·원본/reference hash·stable key·glossary·분위기·스타일·edit region/anchor를
   재확인한다. 기존 canonical candidate가 같은 hash면 exact reuse하고, 다른 hash면 직접
   덮어쓰거나 복사본을 만들지 않고 `BLOCKED`다.
2. built-in imagegen edit 전에 local reference를 `view_image`로 직접 확인한다. reference가
   없거나 현재 hash가 분석 계약과 다르면 생성하지 않는다.
3. `prompts/<stable-key>.txt`에 reference SHA-256, 원어 분위기, 서체·색·외곽선·질감,
   `preserve_layout: exact`, 분석에서 고정한 `preserve_alpha: exact|edit-region-only`, exact
   `edit_regions`, 승인된 한글을 모두 기록한다. 기본은 alpha 전 픽셀 exact다. 글자 모양이
   alpha에 들어 있는 자산만 근거와 함께 영역 안 변경을 허용한다. 원본 전체를 새로 그리라는
   prompt나 text-to-image generate는 금지한다.
4. 에이전트 raster 생성·편집은 `$imagegen`을 사용한 내장 `image_gen.imagegen` **edit만**
   호출한다. Python/Pillow/OpenCV, ImageMagick, SVG/HTML/canvas, 임의 스크립트로 글자를
   그리기·지우기·합성·alpha 복구·resize·candidate 저장을 하지 않는다. 분석용 도구는
   읽기 전용이며 생성기 대체가 아니다.
5. 결과는 프로젝트 내부 `for_translation/tmp-imagegen-<stable-key>-<attempt>`의 새 경로로
   받는다. 원본, reference, 기존 candidate를 생성 도구로 직접 덮어쓰지 않는다. 플랫폼
   importer가 필요해도 검증된 결과를 새 staging에 인코딩할 뿐 한글 픽셀을 만들지 않는다.
6. 동일 decoder로 source/candidate의 header 없는 RGBA8 probe를 만들고
   `IMAGE_GENERATION_MANIFEST.tsv`와 `receipts/<stable-key>.json`을 작성한다. agent-generated
   receipt는 `generator=imagegen`, `tool=image_gen.imagegen`, `operation=edit`여야 한다.
7. 각 시도 직후 다음을 실행한다.

   ```bash
   node "$GT_HOME/scripts/validate-image-translation.mjs" \
     --project-root "<프로젝트 루트>" \
     --manifest "<프로젝트 루트>/30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv"
   ```

   선언한 alpha policy(기본 전 픽셀 exact, 예외는 edit region 안만 변경), edit region 밖
   decoded RGBA diff 0, canvas/format/color mode·anchor·atlas rect exact, 분위기/스타일/한글
   상태 PASS가 아니면 해당 시도를 격리하고 재생성한다.
   validator 출력 `Issues: 0` 없이 manifest 상태를 눈으로 `verified`로 바꾸지 않는다.
8. 생성/수급 후 extract→import→re-extract 왕복으로 canvas·format·alpha·atlas·pixel/metadata를
   다시 검사한다. 실패한 행만 `blocked`로 격리하고 전체를 완료 처리하지 않는다.
9. 전 행의 현재 manifest/receipt/probe가 검증된 뒤에만 `IMAGE_PLAN.tsv`와
   `image_status=translated`를 기록하고 `gt-image-qa`로 진행한다. 사용자 승인을 기다리는
   단계가 아니다.

## 산출물

- `30_translation/image_translation/IMAGE_PLAN.tsv`
- `30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv`
- `reference/` 원본 이미지와 atlas map
- `for_translation/` imagegen 번역 이미지 또는 `hold-for-imagegen` 목록
- `prompts/`, `receipts/`, `probes/`의 prompt·imagegen provenance·decoded RGBA 증거

## 완료 기준

- [ ] required 대상이 전부 계획표에 있고 누락·추가·중복이 없음
- [ ] agent-generated 전 대상이 `image_gen.imagegen` edit receipt를 가지며 Python/임의 스크립트 후보가 없음
- [ ] 원본/reference/기존 candidate 덮어쓰기 0건, source/reference byte-exact
- [ ] canvas·format·alpha·atlas 좌표·anchor·보존 영역·분위기·스타일 검사 통과
- [ ] `validate-image-translation.mjs`가 현재 파일로 `Issues: 0`
- [ ] 왕복 추출·재삽입 후 대상/비대상 diff가 허용 목록과 일치함
- [ ] `image_status=translated`와 현재 원본 hash가 귀속됨
