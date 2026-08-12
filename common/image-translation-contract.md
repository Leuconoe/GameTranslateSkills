# 내장 imagegen 이미지 번역·보존 계약

이 계약은 기존 게임 이미지를 한글화할 때 원어 이미지의 분위기, 스타일, 문자 위치,
캔버스, alpha, atlas 좌표와 비대상 픽셀을 보존하고 생성 품질 편차를 실패-폐쇄형으로
흡수하기 위한 기준이다. `gt-image-analyze` → `gt-image-translate` → `gt-image-qa` →
`gt-image-review` 전 단계가 같은 `IMAGE_GENERATION_MANIFEST.tsv`와 실제 파일을 사용한다.

## 1. 생성기와 비파괴 원칙

- 에이전트의 raster 생성·편집은 API 키나 로컬 API 클라이언트를 쓰지 않고 Codex/ChatGPT의
  내장 `$imagegen` 도구인 `image_gen.imagegen`으로만 실행한다. local reference는 먼저
  `view_image`로 확인하고 `referenced_image_paths`에 edit target으로 전달한다.
- 내장 도구는 현재 호출 표면에서 GPT Image 모델과 `quality`를 고정하거나 증명할 수 없다.
  따라서 manifest와 receipt에는 `model=provider-selected`, `quality=provider-managed`,
  `input_fidelity=provider-managed`를 기록한다. `gpt-image-2`, `high` 또는 그 이상의 값을
  실행 증거 없이 주장하지 않는다. 품질은 요청 옵션이 아니라 아래의 다중 후보 합격 게이트로
  통제한다.
- 각 stable key는 같은 byte-exact reference와 같은 exact prompt로 **서로 독립된 내장
  imagegen 호출을 최소 3회** 실행한다. 한 호출의 여러 변형이나 이전 결과 복제는 독립 시도로
  세지 않는다. 최대 4회까지만 허용하고, 합격 후보가 없으면 `hold-for-imagegen-review`로
  멈춘다. 낮은 품질 후보를 임의 채택하거나 API/로컬 생성기로 폴백하지 않는다.
- Python/Pillow/OpenCV, ImageMagick, SVG/HTML/canvas 또는 임의 스크립트로 글자를 그리기·
  지우기·합성하기·alpha 복구·resize하기·기존 파일 덮어쓰기는 금지한다. 분석기와 decoder는
  읽기 전용 probe에만 사용할 수 있고 후보 생성기로 기록할 수 없다. 내장 imagegen이 반환한
  파일을 새 프로젝트 경로로 byte-copy하는 것은 허용하지만 픽셀 변환은 허용하지 않는다.
- 플랫폼·엔진 importer는 검증된 imagegen 결과를 새 staging에 인코딩할 수 있지만 한글 픽셀을
  새로 만들거나 원본/reference/candidate를 직접 덮어쓰지 않는다.
- `10_extract` 원본, `reference/`, 기존 canonical candidate는 읽기 전용이다. 내장 도구가
  반환한 각 generated artifact를 픽셀 변환 없이
  `for_translation/attempts/<stable-key>-attempt-<NN>`의 새 파일로 byte-copy한다. 선택 뒤에는 합격
  output 하나만 비어 있는 canonical 경로로 byte-preserving rename하고 receipt의 선택 path를
  그 최종 경로로 기록한다. canonical 경로에 파일이 이미 있으면 덮어쓰지 않고 `BLOCKED`다.
- ChatGPT UI에서 사용자가 직접 내려받아 제공한 파일은 `origin=user-supplied`,
  `generator=user-supplied`로 기록한다. 대화 밖 UI 작업을 에이전트의 내장 tool call로 가장하지
  않는다.

## 2. 분석 단계에서 고정할 시각 계약

각 stable key마다 다음을 실제 원본과 engine metadata에서 기록한다.

- 원어가 주는 분위기와 시각적 의도: 시대감, 장르, 온도감, 명도/채도, 재질, 광원, 감정
- 글자 스타일: 서체 계열과 인상, 획 굵기·끝 모양, 크기, 자간/행간, 색·그라데이션,
  외곽선·그림자·발광, 표면 질감·재질, 광원 반응
- 위치: 하나 이상의 편집 rect와 각 rect의 anchor, 정렬, baseline, 여백, clip/clear bbox
- 구조: canvas, format, color mode, alpha, palette/transparency, mip/compression
- atlas: page, rect, padding, UV 원점, sprite/region ID와 보존 영역

추측값이나 OCR만으로 좌표를 확정하지 않는다. 의미를 설명할 수 없는 `style` 또는
`atmosphere` 값, `N/A`, 빈 값은 생성 입력으로 사용할 수 없다. 각 독립 호출은 같은 reference에서
시작해 해당 bitmap의 선언된 모든 문자 영역만 편집한다. 한 호출로 안전하게 다루기 어려울 만큼
영역이 조밀하면 추적되지 않는 연쇄 편집을 만들지 말고 분석 계획을 분할하거나 `BLOCKED`로 둔다.

## 3. imagegen prompt와 다중 후보 receipt

호출 전에 모든 독립 시도가 공유할 exact prompt를
`30_translation/image_translation/prompts/<stable-key>.txt`에 저장한다. 최소 키는 다음과 같다.

```text
use_case: text-localization
input_image_role: Image 1 = edit target
tool: image_gen.imagegen
execution_surface: chatgpt-built-in
model: provider-selected
quality: provider-managed
candidate_policy: best-of-3-fail-closed
minimum_candidates: 3
reference_sha256: <64-hex>
source_text: <완전히 제거할 원문>
remove_source_text: complete
no_overlay: true
verbatim_korean: true
change_only_declared_regions: true
preserve_unchanged_pixels: exact-outside-edit-regions
preserve_atmosphere: <원어 이미지의 분위기와 시각적 의도>
preserve_style: <서체·색·외곽선·재질·광원 계약>
preserve_typography: <서체 인상·굵기·획 끝·크기 계약>
preserve_color: <글자·외곽선·그라데이션 색 계약>
preserve_outline_shadow: <외곽선·그림자·발광 계약>
preserve_material_lighting: <표면 질감·재질·광원 반응 계약>
preserve_spacing_baseline: <자간·행간·정렬·baseline 계약>
preserve_layout: exact
preserve_alpha: <exact|edit-region-only>
edit_regions: <x,y,w,h[;x,y,w,h...]>
korean_text: <승인 용어집을 적용한 정확한 한글 문구>
```

`source_text`의 글자 본체뿐 아니라 외곽선·그림자·발광·안티앨리어싱 흔적까지 완전히
제거한 뒤 배경을 복원하고 한글을 정확히 한 번만 생성하도록 지시한다. 한글은 의미만 맞추는
것이 아니라 원본의 시각적 정체성을 유지해야 한다. 보존 필드는 실제 원본을 설명해야 하며
`same`, `original`, `N/A`, `미확인` 같은 대체값은 허용하지 않는다.

생성 직후 `receipts/<stable-key>.json`에 schema 3 receipt를 기록한다. 모든 경로는 프로젝트
상대경로이고 hash는 현재 파일에서 다시 계산한다. `attempts`는 실제로 완료된 별도 tool call을
하나씩 기록하며, 정확히 하나만 `selected`여야 한다.

```json
{
  "schema_version": 3,
  "stable_key": "ui/title",
  "origin": "agent-generated",
  "generator": "imagegen",
  "tool": "image_gen.imagegen",
  "execution_surface": "chatgpt-built-in",
  "model": "provider-selected",
  "quality": "provider-managed",
  "api_endpoint": "N/A",
  "input_fidelity": "provider-managed",
  "operation": "edit",
  "candidate_policy": "best-of-3-fail-closed",
  "minimum_candidates": 3,
  "selected_attempt": 2,
  "reference_path": "30_translation/image_translation/reference/ui-title.png",
  "reference_sha256": "<sha256>",
  "prompt_path": "30_translation/image_translation/prompts/ui-title.txt",
  "prompt_sha256": "<sha256>",
  "candidate_path": "30_translation/image_translation/for_translation/ui-title.png",
  "candidate_sha256": "<candidate-sha256>",
  "source_rgba_path": "30_translation/image_translation/probes/ui-title.source.rgba",
  "source_rgba_sha256": "<sha256>",
  "candidate_rgba_path": "30_translation/image_translation/probes/ui-title.candidate.rgba",
  "candidate_rgba_sha256": "<sha256>",
  "alpha_policy": "exact",
  "attempts": [
    {
      "attempt": 1,
      "tool": "image_gen.imagegen",
      "operation": "edit",
      "reference_path": "30_translation/image_translation/reference/ui-title.png",
      "reference_sha256": "<sha256>",
      "prompt_path": "30_translation/image_translation/prompts/ui-title.txt",
      "prompt_sha256": "<sha256>",
      "output_path": "30_translation/image_translation/for_translation/attempts/ui-title-attempt-01.png",
      "output_sha256": "<sha256>",
      "generation_status": "completed",
      "technical_status": "reject",
      "visual_status": "reject",
      "source_text_removal_status": "reject",
      "korean_text_status": "pass",
      "original_feel_status": "reject",
      "selection_status": "rejected",
      "rejection_reasons": ["source outline remains"]
    },
    {
      "attempt": 2,
      "tool": "image_gen.imagegen",
      "operation": "edit",
      "reference_path": "30_translation/image_translation/reference/ui-title.png",
      "reference_sha256": "<sha256>",
      "prompt_path": "30_translation/image_translation/prompts/ui-title.txt",
      "prompt_sha256": "<sha256>",
      "output_path": "30_translation/image_translation/for_translation/ui-title.png",
      "output_sha256": "<candidate-sha256>",
      "generation_status": "completed",
      "technical_status": "pass",
      "visual_status": "pass",
      "source_text_removal_status": "pass",
      "korean_text_status": "pass",
      "original_feel_status": "pass",
      "selection_status": "selected",
      "rejection_reasons": []
    },
    {
      "attempt": 3,
      "tool": "image_gen.imagegen",
      "operation": "edit",
      "reference_path": "30_translation/image_translation/reference/ui-title.png",
      "reference_sha256": "<sha256>",
      "prompt_path": "30_translation/image_translation/prompts/ui-title.txt",
      "prompt_sha256": "<sha256>",
      "output_path": "30_translation/image_translation/for_translation/attempts/ui-title-attempt-03.png",
      "output_sha256": "<sha256>",
      "generation_status": "completed",
      "technical_status": "pass",
      "visual_status": "pass",
      "source_text_removal_status": "pass",
      "korean_text_status": "pass",
      "original_feel_status": "pass",
      "selection_status": "qualified",
      "rejection_reasons": []
    }
  ]
}
```

선택 시도는 `technical_status`, `visual_status`, `source_text_removal_status`,
`korean_text_status`, `original_feel_status`가 모두 `pass`이고 `rejection_reasons=[]`여야 한다.
다른 합격 후보는 `qualified`, 탈락 후보는 적어도 한 상태가 `reject`이고 구체적 탈락 사유가
있어야 한다. 선택 시도의 `output_path`/hash는 manifest의 canonical candidate와 정확히 같아야
한다. schema 1/2 receipt나 단일 후보를 문자열만 바꿔 schema 3으로 승격하지 않는다.

## 4. IMAGE_GENERATION_MANIFEST.tsv

헤더 순서와 컬럼은 고정한다.

```text
stable_key\tsource_path\tsource_sha256\treference_path\treference_sha256\tcandidate_path\tcandidate_sha256\tsource_rgba_path\tsource_rgba_sha256\tcandidate_rgba_path\tcandidate_rgba_sha256\tsource_width\tsource_height\tcandidate_width\tcandidate_height\tsource_format\tcandidate_format\tsource_color_mode\tcandidate_color_mode\talpha_policy\tedit_regions\tsource_anchors\tcandidate_anchors\tatlas_page\tsource_atlas_rect\tcandidate_atlas_rect\torigin\tgenerator\ttool\tmodel\tquality\tgeneration_mode\tprompt_path\tprompt_sha256\treceipt_path\treceipt_sha256\tstyle_contract\tatmosphere_contract\tstyle_status\tatmosphere_status\toriginal_feel_status\tsource_text_removal_status\talpha_status\tlayout_status\tkorean_text_status\troundtrip_status\tstatus\tnotes
```

- `stable_key`는 물리 raster 파일 단위로 유일하다. 한 atlas의 여러 region ID는 행을 복제하지
  않고 `edit_regions`/anchors에 모두 기록하며 `IMAGE_PLAN.tsv`에서 bitmap stable key에 연결한다.
- `edit_regions`는 겹치지 않는 `x,y,w,h`를 `;`로 연결한다. anchors는 같은 순서의 `x,y`이고
  source/candidate 값이 exact 일치하며 각 region 안에 있어야 한다.
- atlas가 아니면 `atlas_page`, 두 atlas rect 모두 `none`이다. atlas면 page는 0 이상의 정수이고
  두 rect는 같은 `x,y,w,h`여야 한다.
- RGBA probe는 동일 decoder/importer로 얻은 header 없는 RGBA8이며 길이는
  `width × height × 4`와 exact 일치해야 한다.
- `alpha_policy=exact`가 기본이다. 글자 모양 자체가 alpha에 들어 있어 한글 glyph로 인한 변경이
  불가피하다고 분석에서 증명한 행만 `edit-region-only`를 사용한다. 이 경우에도 edit region 밖
  alpha는 byte-exact여야 한다.
- 에이전트 생성은 `origin=agent-generated`, `generator=imagegen`,
  `tool=image_gen.imagegen`, `model=provider-selected`, `quality=provider-managed`,
  `generation_mode=edit`만 허용한다. 사용자 공급은 `origin=user-supplied`,
  `generator=user-supplied`, `tool=user`, `model=N/A`, `quality=N/A`,
  `generation_mode=external`만 허용한다.
- style, atmosphere, original feel, 원문 완전 제거, alpha, layout, Korean text, roundtrip과
  최종 상태는 모두 `pass`/`verified`여야 한다. 원문 위 덮어쓰기나 원본 서체 인상·재질·광원·
  색·외곽선·자간·baseline이 어긋난 후보는 한 항목이라도 미확인이면 `BLOCKED`다.

## 5. 기계·시각 검증 게이트

이미지 번역과 QA에서 각각 다음 명령을 실행한다.

```bash
npm run image:validate -- --project-root "<프로젝트 루트>" --manifest "<프로젝트 루트>/30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv"
```

검증기는 다음을 실제 파일로 확인한다.

- source/reference/candidate가 서로 다른 프로젝트 내부 일반 파일이고 source/reference hash가 동일
- declared SHA-256과 현재 파일·prompt·receipt·RGBA probe·모든 시도 output hash가 동일
- agent-generated receipt가 schema 3, `image_gen.imagegen`, `chatgpt-built-in`,
  `provider-selected`/`provider-managed`, `best-of-3-fail-closed`, 최소 3개 독립 path/hash임
- 정확히 하나의 선택 시도가 전 QA 상태를 통과하고 manifest candidate path/hash와 일치함
- source/candidate canvas·format·color mode·anchor·atlas rect가 exact 동일
- `alpha_policy=exact`면 모든 alpha byte가 동일하고, `edit-region-only`면 alpha 변경이 exact edit
  region 안으로만 제한됨
- edit region 밖 decoded RGBA diff가 0이고 안쪽에는 실제 RGB 변경이 존재
- prompt가 원문 완전 제거, no-overlay, 정확한 한글, 분위기, 서체 인상, 색, 외곽선/그림자,
  재질/광원, 자간/baseline, layout, alpha, region과 다중 후보 정책을 포함
- style/atmosphere/original-feel/source-text-removal/alpha/layout/한글/왕복 상태가 모두 통과

기계 검증과 `gt-image-qa`의 전체 before/after 시각 검토가 모두 통과하지 않으면 첫 결과나
가장 그럴듯한 결과를 채택하지 않는다. 종료 코드 0과 `Issues: 0` 없이 `image_status=translated`
또는 `qa_ready`로 진행할 수 없다.
