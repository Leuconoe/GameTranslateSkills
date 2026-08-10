# imagegen 이미지 번역·보존 계약

이 계약은 기존 게임 이미지를 한글화할 때 원어 이미지의 분위기, 스타일, 문자 위치,
캔버스, alpha, atlas 좌표와 비대상 픽셀을 보존하기 위한 실패-폐쇄형 기준이다.
`gt-image-analyze` → `gt-image-translate` → `gt-image-qa` → `gt-image-review` 전 단계가
같은 `IMAGE_GENERATION_MANIFEST.tsv`와 실제 파일을 사용한다.

## 1. 생성기와 비파괴 원칙

- 에이전트가 raster 이미지를 생성·편집할 때는 Codex의 `$imagegen` 스킬과 내장
  `image_gen.imagegen` 편집 호출만 사용한다. 신규 text-to-image 재생성이 아니라 원본
  reference를 입력한 **edit**여야 한다.
- Python/Pillow/OpenCV, ImageMagick, SVG/HTML/canvas, 임의 스크립트로 글자를 그리거나
  지우거나 합성하거나 alpha를 고치거나 후보 이미지를 저장하는 행위는 금지한다.
  분석 도구는 읽기 전용 probe에만 사용할 수 있고 후보 생성기로 기록할 수 없다.
- 플랫폼·엔진 importer는 검증된 imagegen 결과를 컨테이너에 인코딩할 수 있지만 새 staging에만
  기록한다. 한글 픽셀을 새로 만들거나 원본/reference/candidate를 직접 덮어쓰지 않는다.
- `10_extract` 원본, `reference/`, 기존 canonical candidate는 모든 생성 도구에 대해 읽기
  전용이다. 매 시도는 프로젝트 내부 `for_translation/tmp-imagegen-<stable-key>-<attempt>`에
  새 파일로 받고, 검증 완료 뒤에만 canonical 경로로 게시한다. canonical 경로에 다른 hash가
  이미 있으면 덮어쓰지 않고 `BLOCKED`다.
- imagegen을 쓸 수 없으면 `hold-for-imagegen`으로 멈춘다. 사용자가 직접 공급한 파일은
  `origin=user-supplied`, `generator=user-supplied`로만 구분하며 에이전트 생성 성공으로
  가장하지 않는다.

## 2. 분석 단계에서 고정할 시각 계약

각 stable key마다 다음을 실제 원본과 engine metadata에서 기록한다.

- 원어가 주는 분위기와 시각적 의도: 시대감, 장르, 온도감, 명도/채도, 재질, 광원, 감정
- 글자 스타일: 서체 계열, 굵기, 크기, 자간/행간, 색, 그라데이션, 외곽선, 그림자, 질감
- 위치: 하나 이상의 편집 rect와 각 rect의 anchor, 정렬, baseline, 여백, clip/clear bbox
- 구조: canvas, format, color mode, alpha, palette/transparency, mip/compression
- atlas: page, rect, padding, UV 원점, sprite/region ID와 보존 영역

추측값이나 OCR만으로 좌표를 확정하지 않는다. 의미를 설명할 수 없는 `style` 또는
`atmosphere` 값, `N/A`, 빈 값은 생성 입력으로 사용할 수 없다.

## 3. imagegen prompt와 receipt

imagegen 호출 전에 exact prompt를 프로젝트의
`30_translation/image_translation/prompts/<stable-key>.txt`에 저장한다. 최소 키는 다음과
같으며 값은 해당 행의 실제 계약을 써야 한다.

```text
reference_sha256: <64-hex>
preserve_atmosphere: <원어 이미지의 분위기와 시각적 의도>
preserve_style: <서체·색·외곽선·재질·광원 계약>
preserve_layout: exact
preserve_alpha: <exact|edit-region-only>
edit_regions: <x,y,w,h[;x,y,w,h...]>
korean_text: <승인 용어집을 적용한 한글>
```

생성 직후 `receipts/<stable-key>.json`에 다음을 기록한다. receipt의 모든 경로는 프로젝트
상대경로이고, hash는 현재 파일에서 다시 계산한다.

```json
{
  "schema_version": 1,
  "stable_key": "ui/title",
  "origin": "agent-generated",
  "generator": "imagegen",
  "tool": "image_gen.imagegen",
  "operation": "edit",
  "reference_path": "30_translation/image_translation/reference/ui-title.png",
  "reference_sha256": "<sha256>",
  "prompt_path": "30_translation/image_translation/prompts/ui-title.txt",
  "prompt_sha256": "<sha256>",
  "candidate_path": "30_translation/image_translation/for_translation/ui-title.png",
  "candidate_sha256": "<sha256>",
  "source_rgba_path": "30_translation/image_translation/probes/ui-title.source.rgba",
  "source_rgba_sha256": "<sha256>",
  "candidate_rgba_path": "30_translation/image_translation/probes/ui-title.candidate.rgba",
  "candidate_rgba_sha256": "<sha256>",
  "alpha_policy": "exact"
}
```

## 4. IMAGE_GENERATION_MANIFEST.tsv

헤더 순서와 컬럼은 고정한다.

```text
stable_key\tsource_path\tsource_sha256\treference_path\treference_sha256\tcandidate_path\tcandidate_sha256\tsource_rgba_path\tsource_rgba_sha256\tcandidate_rgba_path\tcandidate_rgba_sha256\tsource_width\tsource_height\tcandidate_width\tcandidate_height\tsource_format\tcandidate_format\tsource_color_mode\tcandidate_color_mode\talpha_policy\tedit_regions\tsource_anchors\tcandidate_anchors\tatlas_page\tsource_atlas_rect\tcandidate_atlas_rect\torigin\tgenerator\tgeneration_mode\tprompt_path\tprompt_sha256\treceipt_path\treceipt_sha256\tstyle_contract\tatmosphere_contract\tstyle_status\tatmosphere_status\talpha_status\tlayout_status\tkorean_text_status\troundtrip_status\tstatus\tnotes
```

- manifest의 `stable_key`는 물리 raster 파일 단위로 유일해야 한다. 한 atlas에 번역 영역이
  여러 개면 행을 복제하지 않고 `edit_regions`/anchors에 모두 기록하며, 개별 region ID는
  `IMAGE_PLAN.tsv`에서 이 bitmap stable key에 연결한다. source/candidate/receipt 경로도 행별로
  유일해야 한다.
- `edit_regions`: `x,y,w,h`를 `;`로 연결한다. 겹치지 않는 실제 편집 허용 영역만 쓴다.
- `source_anchors`/`candidate_anchors`: region 순서대로 `x,y`를 `;`로 연결한다. 두 값은
  exact 일치하고 각 region 안에 있어야 한다.
- atlas가 아니면 `atlas_page`, 두 atlas rect 모두 `none`이다. atlas면 page는 0 이상의
  정수이고 두 rect는 같은 `x,y,w,h`여야 한다.
- `source_rgba_path`와 `candidate_rgba_path`는 동일한 decoder/importer로 얻은 header 없는
  RGBA8 probe다. 길이는 `width × height × 4`와 exact 일치해야 한다.
- `alpha_policy=exact`가 기본이다. 글자 모양 자체가 alpha에 들어 있어 한글 glyph로 인해
  alpha 변경이 불가피하다고 분석 단계에서 증명한 행만 `edit-region-only`를 사용한다.
  이 경우에도 edit region 밖 alpha는 byte-exact이고 `alpha_status=pass`여야 한다.
- 에이전트 생성은 `origin=agent-generated`, `generator=imagegen`,
  `generation_mode=edit`만 허용한다. 사용자 공급은 별도 provenance인
  `user-supplied / user-supplied / external`만 허용한다.
- style, atmosphere, alpha, layout, Korean text, roundtrip 상태와 최종 `status`는 모두
  `pass`/`verified`여야 한다. 한 항목이라도 미확인이면 `BLOCKED`다.

## 5. 기계 검증 게이트

이미지 번역과 이미지 QA에서 각각 다음 명령을 실행한다.
`npm run image:validate`는 `scripts/validate-image-translation.mjs`를 호출한다.

```bash
npm run image:validate -- --project-root "<프로젝트 루트>" --manifest "<프로젝트 루트>/30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv"
```

검증기는 다음을 실제 파일로 확인한다.

- source/reference/candidate가 서로 다른 프로젝트 내부 일반 파일이고 source/reference hash가 동일
- declared SHA-256과 현재 파일·prompt·receipt·RGBA probe hash가 모두 동일
- agent-generated receipt가 `image_gen.imagegen`의 `edit`이고 Python/Pillow/OpenCV 계열이 아님
- source/candidate canvas·format·color mode·anchor·atlas rect가 exact 동일
- `alpha_policy=exact`면 모든 alpha byte가 동일하고, `edit-region-only`면 alpha 변경이
  exact edit region 안으로만 제한됨
- `edit_regions` 밖 decoded RGBA diff가 0이고, 안쪽에는 실제 RGB 변경이 존재
- prompt가 reference hash, 분위기·스타일·layout·alpha·region·한글 계약을 모두 포함
- style/atmosphere/alpha/layout/한글/왕복 상태가 모두 통과

명령 종료 코드 0과 `Issues: 0`이 없으면 `image_status=translated` 또는 `qa_ready`로
진행할 수 없다. manifest 값만 눈으로 고치거나 이전 run의 probe/receipt를 재사용하지 않는다.
