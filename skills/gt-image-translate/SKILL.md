---
name: gt-image-translate
description: "Translate text-bearing game textures, atlases, and raster labels through no-API built-in imagegen edits, multi-candidate selection, fail-closed provenance, source protection, and original typography, atmosphere, layout, alpha, material, and lighting preservation. Use after gt-image-analyze when game images require Korean localization."
---

# gt-image-translate — 이미지 브랜치 I2: 이미지 번역

`gt-image-analyze`가 확정한 대상만 처리한다. 이미지 안 텍스트는 text branch의 glossary와
STYLE을 따르고 `$GT_HOME/common/image-translation-contract.md`를 적용한다. 원어의 분위기·
스타일·위치·canvas·alpha·atlas·보존 픽셀 계약을 깨는 생성물은 완료로 처리하지 않는다.

## 입력 조건

- `PROJECT.md`, `IMAGE_ANALYSIS.md`, `IMAGE_SOURCE_INVENTORY.tsv`, `IMAGE_PLAN.tsv`
- `gt-text-review` handoff, `text_status=review_ready`, `font_status=verified`
- texture/atlas import contract, 원본 hash, byte-exact reference
- stable key별 atmosphere/style와 exact edit region·anchor

`image_scope=N/A`이면 가짜 후보를 만들지 않고 0건 근거와 `image_status=skipped`를 기록한 뒤
`gt-qa`로 이동한다. `required`인데 분석·text handoff·원본 hash가 없으면 `BLOCKED`다.

## 실행 경로

| 환경 | 동작 |
|---|---|
| Codex + 내장 `$imagegen` | `view_image`로 local reference를 확인하고 `image_gen.imagegen`에 `referenced_image_paths`로 전달해 edit |
| 내장 imagegen 없음 | 계획·분석까지만 하고 `hold-for-imagegen-review`; API/CLI나 로컬 raster 생성기로 폴백하지 않음 |
| 사용자가 ChatGPT UI 결과를 제공 | `origin=user-supplied`로 검증하며 agent-generated tool call로 가장하지 않음 |

내장 호출은 API 키를 요구하지 않는다. 현재 tool surface는 GPT Image 모델과 quality를 노출하지
않으므로 `model=provider-selected`, `quality=provider-managed`로 기록한다. `gpt-image-2/high`를
증거 없이 주장하지 말고 결과 합격률로 품질을 통제한다.

## 절차

1. 범위·경로·원본/reference hash·stable key·glossary·분위기·스타일·edit region/anchor를
   재확인한다. 기존 canonical candidate에 다른 hash가 있으면 덮어쓰지 않고 `BLOCKED`다.
2. local reference를 `view_image`로 직접 확인한다. reference가 없거나 분석 hash와 다르면
   생성하지 않는다.
3. `prompts/<stable-key>.txt`에 계약의 exact prompt를 기록한다. 최소한 다음을 구체화한다.
   - `Image 1 = edit target`, `tool: image_gen.imagegen`, `chatgpt-built-in`
   - `candidate_policy: best-of-3-fail-closed`, `minimum_candidates: 3`
   - 제거할 원문, `remove_source_text: complete`, `no_overlay: true`, 정확한 한글
   - 분위기, 서체 인상/굵기/획 끝, 색/그라데이션, 외곽선/그림자/발광, 질감/재질/광원,
     자간/행간/baseline/정렬
   - `preserve_layout: exact`, alpha policy, exact edit regions, 영역 밖 픽셀 exact

   `same`, `original`, `N/A` 같은 대체값과 text-to-image 재생성을 금지한다. 원문 glyph·외곽선·
   그림자·발광·안티앨리어싱을 먼저 완전히 제거하고 배경을 복원한 뒤 한글을 한 번만 렌더링하도록
   명시한다.
4. 같은 byte-exact reference와 같은 prompt로 `image_gen.imagegen`을 **별도 호출 3회** 실행한다.
   각 tool result의 generated artifact를 픽셀 변환 없이 새
   `for_translation/attempts/<stable-key>-attempt-<NN>` 파일로 byte-copy한다. 한 호출의 여러 출력,
   이미 저장한 output의 복제, 이전 후보의 rename은 독립 시도로 세지 않는다. 매 호출은 이전
   후보가 아닌 같은 reference에서 시작해 선언된 모든 영역만 편집한다. 영역이 너무 조밀해 한
   호출로 안전하게 처리할 수 없으면 추적되지 않는 연쇄 편집 대신 분석 계획을 분할하거나
   `BLOCKED`로 둔다.
5. source/reference/기존 candidate를 생성 도구로 직접 덮어쓰지 않는다. Python/Pillow/OpenCV,
   ImageMagick, SVG/HTML/canvas 또는 임의 스크립트로 글자·배경·alpha를 생성·삭제·합성하지
   않는다. 내장 도구 반환 파일의 byte-copy와 읽기 전용 decoder/probe만 허용한다. 예외는 아래
   `image:normalize-size`와 `image:compose-alpha` 게이트뿐이다.
6. 세 후보를 모두 before/after로 검사한다. 원문 흔적/no-overlay, 정확한 한글, 원본 분위기·서체·
   색·외곽선·재질·광원·자간/baseline, canvas/layout/alpha와 영역 밖 변형을 각각 판정한다.
   - 전 항목 통과: `qualified`
   - 가장 우수한 합격 후보 하나: `selected`
   - 한 항목이라도 실패: `rejected`와 구체적 사유

   첫 결과를 자동 채택하지 않는다. 3개가 모두 실패하면 필요할 때 네 번째 독립 호출까지만
   허용하고, 그래도 실패하면 `hold-for-imagegen-review`로 멈춘다. 선택 output은 비어 있는
   canonical 경로로 byte-preserving rename하고 기존 파일은 절대 교체하지 않는다.
7. 동일 decoder로 source/선택 후보의 header 없는 RGBA8 probe를 만들고 receipt schema 3와
   `IMAGE_GENERATION_MANIFEST.tsv`를 작성한다. receipt는 `image_gen.imagegen`,
   `chatgpt-built-in`, `provider-selected`, `provider-managed`, `best-of-3-fail-closed`, 모든 시도
   path/hash/QA 상태, 정확히 하나의 `selected_attempt`를 포함해야 한다. 이 상태에서 validator의
   유일한 오류가 canvas width/height이고 PNG/RGBA8 및 종횡비가 exact이면 다음을 dry-run한다.

   ```bash
   npm run image:normalize-size -- \
     --project-root "<프로젝트 루트>" \
     --manifest "<프로젝트 루트>/30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv" \
     --stable-key "<stable-key>"
   ```

   `ELIGIBLE`일 때만 `--apply`를 추가한다. 이 명령은 raw candidate/probe/schema 3 receipt를
   보존하고 `normalized/`의 새 PNG·probe와 schema 4 receipt를 만든다. crop/pad/종횡비 변경,
   PNG 외 포맷, 다른 validator 오류가 있으면 실패하며 resize 뒤 alpha·영역 밖 RGBA·영역 안 변경
   검사를 다시 통과하지 못해도 실패한다.
   alpha를 잃은 `edit-region-only` 후보는 같은 후보와 exact alpha-mask prompt로 imagegen을 3회
   독립 호출한다. grayscale/white-opaque mask의 edge·transparency intent를 전수 QA하고 mask
   schema 1 receipt에서 하나만 selected로 기록한 뒤 다음을 dry-run한다.

   ```bash
   npm run image:compose-alpha -- \
     --project-root "<프로젝트 루트>" \
     --manifest "<프로젝트 루트>/30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv" \
     --stable-key "<stable-key>" \
     --mask-receipt "30_translation/image_translation/receipts/alpha_masks/<stable-key>.json"
   ```

   `ELIGIBLE`일 때만 `--apply`를 추가한다. 합성기는 candidate RGB를 바꾸지 않고 edit region 안
   alpha만 mask Rec.709 luminance로 교체하며 영역 밖 alpha는 source에서 exact 복구한다. 영역 밖
   RGB drift, 다른 QA 오류, mask canvas/opacity/grayscale/provenance 오류는 `BLOCKED`다.
8. 다음 검증을 실행한다.

   ```bash
   node "$GT_HOME/scripts/validate-image-translation.mjs" \
     --project-root "<프로젝트 루트>" \
     --manifest "<프로젝트 루트>/30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv"
   ```

   alpha policy, 영역 밖 decoded RGBA diff 0, canvas/format/color mode·anchor·atlas rect exact,
   원문 완전 제거, no-overlay, 원본 느낌과 한글 상태가 모두 통과해야 한다. `Issues: 0` 없이
   manifest를 수동으로 `verified`로 바꾸지 않는다.
9. extract→import→re-extract 왕복을 검사한다. 전 행의 현재 manifest/receipt/probe가 검증된
   뒤에만 `image_status=translated`를 기록하고 `gt-image-qa`로 진행한다.

## 산출물

- `IMAGE_PLAN.tsv`, `IMAGE_GENERATION_MANIFEST.tsv`
- `reference/`의 원본 이미지와 atlas map
- `for_translation/attempts/`의 3–4개 독립 출력과 선택된 canonical 후보
- `prompts/`, `receipts/`, `probes/`의 prompt·내장 imagegen provenance·decoded RGBA 증거

## 완료 기준

- [ ] required 대상에 누락·추가·중복이 없음
- [ ] 모든 agent-generated 대상에 schema 3, 검증된 size-normalization schema 4, 또는 alpha-mask composition schema 5 best-of-3 receipt와 정확히 하나의 합격 선택 후보가 있음
- [ ] API/CLI/Python raster 생성·원본/reference/기존 candidate 덮어쓰기 0건
- [ ] 원문 흔적·겹쳐쓰기 0건, 정확한 한글과 원본 시각적 정체성 검사 통과
- [ ] canvas·format·alpha·atlas·anchor·보존 영역 검사와 validator `Issues: 0`
- [ ] 왕복 결과가 허용 목록과 일치하고 `image_status=translated`가 현재 hash에 귀속됨
