# 내장 imagegen 이미지 번역·보존 계약

## 프로젝트 한정 사용자 override: 2회 후 직접 조판

사용자가 특정 타이틀에 `imagegen 2회 시도 후 실패하면 직접 조판`을 명시하면
프로젝트 기록에 원문 지시·날짜·타이틀·적용 stable key를 남기고 이 경로를 적용한다.
기본 best-of-3/no-local-raster 규칙을 전역 변경하지 않는다. 각 key의 같은 byte-exact
원본·정확한 한글 문구로 별도 imagegen 호출을 **최대 2회** 평가한다. 이미 2회 이상의
독립 실패가 물리적 산출물·hash·QA 기록으로 확인되면 추가 호출 없이 조판한다.
공급자 거부는 성공한 생성 출력으로 세지 않고 실패 사유로 별도 기록한다.
안전상 거부되었거나 이미 금지된 이미지에는 직접 조판 fallback도 적용하지 않는다.
재시도·재표현·부분 crop으로 그 제한을 우회하지 않는다.

두 시도가 합격 후보를 만들지 못하면 원본/reference/기존 후보를 덮어쓰지 않고 새
`agent-typeset` 후보를 만든다. 로컬 조판은 이 명시된 프로젝트 범위에서만 허용한다.
편집 전에 정확한 glyph/effect 마스크와 배경 복원 근거를 잠그고, 한글 서체·색·획·
간격·정렬을 원본에 맞춘다. receipt에는 두 실패 시도의 원본/prompt/output hash와
판정, 사용자 지시 근거, 원본·후보 hash, font 경로/hash, 렌더러 버전과 설정,
마스크·배경 복원 근거, 보호 영역 RGBA 비교, 원문 제거, 네이티브 왕복과 시각 QA를
기록한다. `generator=typeset` 및 `origin=agent-typeset`을 사용하고 imagegen schema
3–5 PASS로 표기하지 않는다. 배경·alpha·삽화의 원형을 입증하지 못한 후보는
`BLOCKED`로 둔다. 최종 에뮬레이터 검증은 별도다.

### PROJECT 연결 및 정책 JSON 계약

기존 CLI는 그대로 사용한다. --project-root의 PROJECT.md가 아래 두 override 필드를
각각 한 번만 선언해야 활성화될 수 있다. CLI의 임의 플래그로 켜지 않는다.

~~~yaml
title_id: "<현재 프로젝트의 정확한 title_id>"
image_generation_override: 30_translation/image_translation/policies/image-policy.json
image_generation_override_sha256: "<위 JSON 원본 byte SHA-256>"
~~~

정책 JSON schema 1의 구조는 다음과 같다. 이 예시는 실제 승인이나 게임 scope가 아니다.
primary는 확정 scope와 실제 사용자 지시 증거로 새 파일을 작성한다.

~~~json
{
  "schema_version": 1,
  "policy": "project-local-max-2-then-typeset",
  "project_root": "<실제 프로젝트 realpath 절대경로>",
  "title_id": "<PROJECT.md와 동일>",
  "max_imagegen_attempts": 2,
  "include_prior_failures": true,
  "fallback": "direct-typesetting",
  "user_instruction": {
    "path": "30_translation/image_translation/policies/user-instruction.json",
    "sha256": "<사용자 지시 기록의 원본 byte SHA-256>"
  },
  "scope": [
    {"stable_key": "<정확한 key>", "source_sha256": "<정확한 원본 byte SHA-256>",
     "prior_history": {"path": "30_translation/image_translation/policies/prior-history.json",
                       "sha256": "<해당 history snapshot의 byte SHA-256>"}}
  ]
}
~~~

user_instruction 파일은 JSON이며 authority="user", 동일 policy/project_root/title_id,
max_imagegen_attempts=2, include_prior_failures=true, fallback="direct-typesetting"과
실제 지시 원문 verbatim, 메시지/기록 위치 source_ref, ISO 날짜 recorded_at을 포함한다.
실제 지시를 보존하는 기록이며 승인 발명용이 아니다. 정책·지시·receipt는 project-local
non-link 파일로 유지하고 변경하면 새 byte SHA를 연결한다.

각 scope의 prior_history는 phase를 정직하게 기록한 schema_version=1 JSON snapshot을 필수로 연결한다.
동일 project_root/title_id/stable_key/source_sha256, snapshot_phase="before-current-execution" 또는 "after-generation-before-adoption",
실제 기록 참조 source_ref/recorded_at 및 invocations 배열을 담는다. 각 항목은 실제 과거
typed invocation identity/invocation_path/invocation_sha256이며 해당 호출 파일도 현재 byte SHA로 대조한다.
과거 호출이 없을 때도 invocations=[]와 explicit_zero_prior=true인 명시적 0회 증거를 고정한다.
호출이 있으면 explicit_zero_prior=false다. receipt의 prior_history={path,sha256}도 같은 pin이어야 한다.
receipt는 pinned prior 호출을 하나도 빼지 않고 같은 invocation pin으로 포함하며, 현재 receipt의
call ID 중복은 0이고 prior∪receipt 누적 unique 호출 수는 2 이하여야 한다. 따라서 prior A를
숨겨 B,C만 제시하는 우회는 거부한다. 기존 실패를 세지 않으려고 새 zero snapshot을 발명하지 않는다.
이 검증은 명시한 실행 전 snapshot과 실제 보존 호출 기록 범위의 일관성 증거이며, 서비스 전체
호출 이력이나 zero 선언의 진실성을 자동 서명·전역 scan으로 증명했다고 주장하지 않는다.

after-generation-before-adoption은 기존 사용자 권한 아래 이미 생성된 두 실패 결과와 조판 후보를
채택 직전에 기록하는 historical-adoption 전용 phase다. 정확히 두 actual prior 호출을 모두 고정하고
explicit_zero_prior=false인 경우에만 agent-typeset 채택을 허용한다. 기존 source identity, 요청·관측
locator·출력 SHA, 실패 QA와 font/mask/protected pixels/native import 증거는 모두 그대로 요구한다.
이는 새 사용자 권한을 만들거나 generation 전에 policy pin이 있었다고 소급 주장하는 기록이 아니며,
추가 generation·재시도·조판 재렌더를 허가하지 않는다. 새 대상의 실제 실행 전 0회 snapshot은
before-current-execution으로 유지하며 이 phase로 소급된 zero 기록을 만들지 않는다.

scope 밖 행은 기본 best-of-3 검증을 유지한다. override receipt에는
policy_override={path: 정책 상대경로, sha256: 정책 byte SHA},
candidate_policy="project-local-max-2-then-typeset", minimum_candidates=1,
maximum_attempts=2를 기록한다. imagegen prompt에도 같은 policy와 min/max를 적는다.
imagegen 성공은 기존 schema 3(조건부 4/5)에 1~2개 시도와 정확히 하나의 합격 선택을 요구하며,
첫 성공에 두 번째 호출을 강제하지 않는다. 같은 원본의 기존 실패를 이력에서 빼거나 run 이름을
바꿔 상한을 초기화하지 않는다. 기존 schema 4/5의 provenance·결정론적 픽셀 검증도 유지한다.

각 override attempt는 execution_surface="chatgpt-built-in", safety_refusal=false,
invocation_path/invocation_sha256와 다음 중 실제로 관측한 typed identity를 기록한다.

- provider ID가 실제 노출되면 provider_tool_call_id_exposed=true와 원 tool_call_id를 그대로 쓴다.
- 반환이 image_url/output_hint뿐이면 provider_tool_call_id_exposed=false이고 tool_call_id는
  생략/null로 둔다. invocation_key="returned-artifact:<실제 output_hint basename에서 확장자를 뺀 값>",
  returned_artifact_locator=실제 반환 locator 원문, returned_artifact_sha256=보존 출력의 byte SHA,
  request_path/request_sha256=보존한 실제 요청 기록의 project-local 경로·byte SHA를 연결한다.
  보존 출력 SHA는 attempt.output_sha256와 같아야 하며 이 분기는 completed 출력에만 적용한다.

invocation JSON은 tool/execution_surface/operation/reference_sha256/prompt_sha256,
generation_status/output_sha256/safety_refusal과 같은 discriminator·identity 필드 및
관측 분기의 locator/artifact SHA/request pin을 exact 반복한다. history 항목도 같은 typed identity와
invocation path/SHA를 고정한다. native ID와 observable key의 구분은 중복·누락·누적 2회 검사에
공통 적용한다. locator를 validator가 다시 열지 않고 project-local 보존 출력·요청의 bytes를 검증한다.
observable key는 독립 호출 결과를 연결하는 관측 식별자이며 provider native ID·서비스 서명·인증
증명이 아니다. 미노출 ID를 발명하거나 실제 반환 basename을 native tool_call_id로 가장하지 않는다.
완료 출력 QA reject는 기존 물리 output/hash와 구체적 거부 이유를 유지한다. 출력 없는 비안전성 생성 오류는
generation_status="failed", failure_kind="generation-error", output path/hash="N/A",
rejected QA·이유와 invocation JSON의 실제 error를 남긴다. 안전 거부는 조판 허가로 전환하지 않는다.

### 보존된 자연어 실패 prompt의 채택 계약

max2 override의 실제 독립 두 rejected builtin 호출 뒤 agent-typeset/schema 6을 채택할 때만,
receipt.failed_prompt_contract={path,sha256}로 별도 sidecar를 연결할 수 있다. before/after phase는
실제 기록 그대로 유지한다. sidecar는 사후 해석 계약이며 원 prompt·request의 byte를 수정하거나
실제 tool prompt에 기계 header가 있었다고 가장하는 문서가 아니다. 기본 best-of-3/schema 3 및
imagegen 성공 경로의 prompt header 검증을 완화하지 않는다.

sidecar schema_version=1, kind="preserved-failed-prompt-contract"의 필수 필드는
stable_key/source_path/source_sha256/reference_path/reference_sha256, plan={path,sha256},
source_text/korean_text/edit_regions, canvas={width,height}, actual_read=true, 실제 reviewer,
semantic_consistency="pass", 정확히 두 attempts다. plan은 동결된 계획 bytes의 pin이며 scope 권한은
기존 PROJECT/사용자 policy의 exact key/source SHA에서 계속 검증한다.
각 sidecar attempt는 동일 typed invocation identity, prompt_path/prompt_sha256,
request_path/request_sha256와 다음 byte span을 포함한다.

- request_prompt_pointer: 보존 request JSON의 실제 prompt 문자열 RFC 6901 pointer.
- request_prompt_span={byte_offset,byte_length}: raw prompt 파일에서 실제 호출 문자열을 나타낸 범위.
  offset 0의 전체 파일 또는 마지막 LF/CRLF 한 개만 제외한 범위이며 JSON 문자열 UTF-8와 정확히 같아야 한다.
- literal_spans={source_text:{byte_offset,byte_length},korean_text:{byte_offset,byte_length}}.
  source_text만 두 줄의 분산 literal인 경우 {kind:"ordered-source-lines",
  ordered_spans:[{byte_offset,byte_length},{byte_offset,byte_length}],joiner:"\n",
  line_instruction_span:{byte_offset,byte_length}}를 사용할 수 있다. 두 비어 있지 않은 단일행
  raw span은 원문 순서대로 실제 "<첫 부분> on the first line and <둘째 부분> on the second line"
  지시 구간의 정확한 위치를 차지해야 하며 LF로 연결한 결과가 canonical source_text와 같아야 한다.
  LF는 sidecar의 명시적 결합이며 실제 tool prompt에 LF literal이 있었다는 주장이 아니다.
  기존 단일 literal 및 before/after phase는 그대로 유지하며 다른 문구·누락·중복 span으로 원문을 복원할 수 없다.
- canvas_span={byte_offset,byte_length}: 실제 width/height 숫자쌍을 담은 원문 범위.
- region_spans=[{index,representation:"xywh",byte_offset,byte_length}]: 모든 edit region의
  실제 [x,y,width,height] 또는 (x,y,width,height) literal을 0-based 순서로 고정한다.

모든 span은 raw UTF-8 byte 기준이고 실제 호출 문자열 범위 안에 있어야 한다. validator는
JA/KO literal·canvas·좌표 숫자를 대조하며 모순 없는 전체 지시 해석은 기명 actual-read 검수로 남긴다.
request pin은 현재 보존된 호출 기록 또는 정직하게 표시한 typed-exact 추출 bytes이며 원 wire bytes나
서비스 인증 증명이 아니다. 실제 request prompt 문자열은 raw file의 명시 범위와 직접 대조한다.
기존 actual 두 invocation·request·artifact SHA·실패 QA와 모든 source/protected pixel/alpha/canvas/
anchor/font/mask/native import 검증은 계속 적용한다. 이 분기는 세 번째 생성·원 prompt 재작성·재렌더 허가가 아니다.
미래 호출은 prompt 파일을 쓴 뒤 도구 실행 전에 기계 header preflight를 검사하되, 이미 발생한 두 실패의 재호출을 요구하지 않는다.

### 별도 typeset receipt schema 6

두 독립 호출 모두 불합격일 때만 origin=agent-typeset, generator=typeset,
generation_mode=typeset, 실제 renderer 이름인 tool, model/quality/prompt path/hash=N/A를 쓴다.
receipt의 api_endpoint와 input_fidelity도 각각 명시적으로 N/A로 기록하고 빈값으로 두지 않는다.
source/reference/candidate/probe/receipt 경로·hash와 기존 TSV 열은 유지한다.
receipt는 공통 identity 필드에 schema_version=6, source_path/source_sha256,
execution_surface="project-local-typeset", operation="typeset", 위 정책 pin/min/max,
selected_attempt=null 및 정확히 두 rejected builtin attempts를 연결한다.
각 실패 prompt의 reference/source_text/korean_text를 조판 문구와 대조하므로 과거 prompt를
사후 수정할 필요가 없다. typeset를 imagegen schema 3–5나 user-supplied로 위장하지 않는다.

typesetting 객체의 필수 증거:

- technique: direct-typesetting 또는 compositing; source_text/korean_text는 실제 문구.
- font: {path, sha256}, 사용한 project-local 폰트 byte 증거.
- renderer: {name, version, settings}, 실제 도구·버전과 비어 있지 않은 설정 객체.
- glyph_mask/effect_mask: 각각 {path, sha256}, 원본 canvas의 opaque grayscale PNG.
  edit region 밖은 0이며 두 mask 밖 RGBA 변경은 허용하지 않는다.
- background_evidence: {path, sha256}, exact stable_key/source_sha256/candidate_sha256와
  실제 배경 복원 method를 담은 JSON.
- visual_qa: {path, sha256}, 같은 identity, actual_view=true, 실제 reviewer,
  동일 source_text/korean_text, visual/source_text_removal/korean_text/original_feel status 모두 pass.
- roundtrip: {path, sha256}, 같은 identity, 실제 method, status=pass,
  reloaded_path/reloaded_sha256/reloaded_rgba_path/reloaded_rgba_sha256.
  별도 보존한 native reload 파일과 decoded probe의 현재 bytes가 candidate/probe와 일치해야 한다.

추가 증거는 원본·reference·candidate·probe·정책 등 보호 파일의 alias/hard-link일 수 없다.
schema 6도 canvas/format/color-mode/anchors/atlas/alpha와 보호 RGBA gate를 모두 거친다.
이 receipt는 조판 경로의 기술·시각·왕복 기록이며 imagegen PASS나 runtime PASS가 아니다.

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
  지우기·합성하기·alpha 복구·기존 파일 덮어쓰기는 금지한다. 분석기와 decoder는 읽기 전용
  probe에만 사용할 수 있고 후보 생성기로 기록할 수 없다. 내장 imagegen이 반환한 파일을 새
  프로젝트 경로로 byte-copy하는 것은 허용한다. 픽셀 변환 예외는 §3.1의 PNG/RGBA8
  canvas-size-only 정규화와 §3.2의 imagegen alpha-mask 합성뿐이며, raw output과 기존 receipt를
  보존하고 전체 QA를 다시 통과해야 한다.
- 플랫폼·엔진 importer는 검증된 imagegen 결과를 새 staging에 인코딩할 수 있지만 한글 픽셀을
  새로 만들거나 원본/reference/candidate를 직접 덮어쓰지 않는다.
- `10_extract` 원본, `reference/`, 기존 canonical candidate는 읽기 전용이다. 내장 도구가
  반환한 각 generated artifact를 픽셀 변환 없이
  `for_translation/attempts/<stable-key>-attempt-<NN>`의 새 파일로 byte-copy한다. 선택 뒤에는 합격
  output 하나만 비어 있는 canonical 경로로 byte-preserving rename하고 receipt의 선택 path를
  그 최종 경로로 기록한다. §3.1 정규화를 적용하면 이 경로가 보존된 raw input이 되고 새
  `normalized/` 경로가 canonical candidate가 된다. 어떤 경로든 이미 파일이 있으면 덮어쓰지 않고
  `BLOCKED`다.
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

미래 prompt의 실제 개행은 단일 물리행의 JSON string으로 명시한다. 예:
`source_text_json: "甲\n乙"`, `korean_text_json: "가\n나"`. JSON decode 뒤의 실제 LF를
receipt/visual QA와 그대로 비교한다. 같은 기본 키와 _json 키를 동시에 쓰거나 잘못된 JSON을 쓰면 실패한다.
혼합 state는 `source_text_json: ["甲","甲","甲","乙"]`,
`korean_text_json: ["가","가","가","나"]`처럼 비어 있지 않은 string array로 기록한다.
두 배열의 길이는 edit_regions 개수와 같고 해당 좌표 순서와 1:1이며, typesetting 및 visual QA의
source_text/korean_text도 같은 typed array로 유지한다. 순서·중복 state·개행을 축약하거나 평탄화하지 않는다.
JSON header 뒤에는 `# 각 state의 같은 index 좌표에서 해당 원문만 해당 한국어로 교체`처럼
사람이 읽는 상태별 지시를 덧붙인다. 기존 단행 literal과 기본 best-of-3 계약은 바뀌지 않는다.
실행 전 `scripts/lib/image-prompt-contract.mjs`의 validatePromptTextPreflight(prompt,row,expected,issues)로
저장한 prompt와 고정 metadata를 대조한다. row.edit_regions 및 expected의 source_text, korean_text,
edit_regions, reference_sha256, tool, execution_surface가 필수이며 나머지 고정 header도 expected에 넣을 수 있다.
이 검사는 원본/PNG를 읽지 않는 header/text preflight이며 전체 이미지·provenance gate의 대체가 아니다.

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

### 3.1 canvas-size-only 정규화

schema 3 manifest를 현재 validator로 검사했을 때 오류가 `canvas width changed` 및/또는
`canvas height changed`뿐이고 다음 조건을 모두 만족할 때만 정규화를 시도한다.

- `origin=agent-generated`, PNG→PNG, decoded color mode RGBA8
- candidate와 source의 종횡비가 정수 교차곱 기준 exact 동일하며 crop/pad가 필요하지 않음
- source/raw candidate PNG IHDR와 각 RGBA probe의 dimensions/bytes/hash가 exact 일치
- selected attempt와 raw candidate/probe/schema 3 receipt가 exact 연결됨
- resize 결과가 기존 alpha policy, edit region 밖 RGBA diff 0, 영역 안 RGB 변경을 통과함

먼저 dry-run하고 `ELIGIBLE`일 때만 적용한다.

```bash
npm run image:normalize-size -- \
  --project-root "<프로젝트 루트>" \
  --manifest "<프로젝트 루트>/30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv" \
  --stable-key "<stable-key>" \
  --apply
```

도구는 Node 표준 모듈만 사용하여 `premultiplied-alpha-bilinear-rgba8-v1`로 목표 canvas에
리사이즈한다. 완전 투명 표본의 숨은 RGB도 보존 검증 대상이므로 alpha=0에서는 straight RGB
보간값을 기록한다. raw candidate/probe/schema 3 receipt는 수정하지 않고 다음 새 파일을 만든다.

- `for_translation/normalized/<stable-key>.png`
- `probes/normalized/<stable-key>.candidate.rgba`
- `receipts/normalized/<stable-key>.json` (schema 4)

schema 4의 `normalization` 객체는 `status=applied`, `reason=canvas-size-only`, 고정 tool/algorithm,
원본 schema 3 receipt path/hash, raw input candidate/probe path/hash/dimensions, normalized output
candidate/probe path/hash/dimensions를 기록한다. `attempts`는 원본 schema 3에서 byte-semantic하게
변경하지 않는다. selected attempt는 raw imagegen output을, top-level `candidate_*`는 normalized
output을 가리킨다. 정규화 후 반드시 `image:validate`를 다시 실행하며, 다른 오류가 하나라도
생기면 크기 문제만이 아니므로 합격시키지 않는다.

### 3.2 imagegen alpha-mask 합성

선택한 한글 후보의 RGB·문자·스타일·layout은 합격했지만 imagegen이 alpha를 잃은 경우 다음
조건을 모두 만족할 때만 mask 합성을 시도한다.

- `origin=agent-generated`, PNG/RGBA8, source/candidate canvas exact 동일
- 분석 단계에서 `alpha_policy=edit-region-only`로 증명된 자산
- 현재 validator가 성공하거나 오류가 edit region 밖 alpha/RGBA diff뿐임
- candidate RGB는 edit region 밖에서 source와 byte-exact
- prior color receipt는 검증 가능한 schema 3 또는 schema 4

mask prompt는 선택한 Korean candidate를 `Image 1` edit target으로 사용하며 다음 필드를 exact로
포함한다.

```text
use_case: alpha-mask-recovery
input_image_role: Image 1 = selected Korean candidate
tool: image_gen.imagegen
execution_surface: chatgpt-built-in
model: provider-selected
quality: provider-managed
candidate_policy: best-of-3-fail-closed
minimum_candidates: 3
reference_sha256: <selected-candidate-sha256>
output_mode: grayscale-alpha-mask
mask_polarity: white-opaque
mask_channel: luminance-rec709
mask_canvas: <width>x<height>
edit_regions: <x,y,w,h[;x,y,w,h...]>
preserve_korean_glyph_edges: true
opaque_output: true
```

같은 candidate와 prompt로 내장 imagegen을 3회 독립 호출하고 4회까지만 허용한다. 각 output은
`alpha_masks/attempts/`의 새 파일에 보존한다. mask receipt schema 1은 기존 imagegen provenance와
함께 각 attempt의 `technical_status`, `visual_status`, `edge_status`,
`transparency_intent_status`, selection 및 rejection reasons를 기록한다. 정확히 하나만 selected이고
top-level `mask_path`/hash와 일치해야 한다. selected mask는 source와 같은 canvas의 불투명 PNG이고
edit region 안 RGB channel spread가 8 이하인 grayscale이어야 한다.

먼저 dry-run하고 `ELIGIBLE`일 때만 적용한다.

```bash
npm run image:compose-alpha -- \
  --project-root "<프로젝트 루트>" \
  --manifest "<프로젝트 루트>/30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv" \
  --stable-key "<stable-key>" \
  --mask-receipt "30_translation/image_translation/receipts/alpha_masks/<stable-key>.json" \
  --apply
```

`source-outside-mask-luma-inside-v1` 알고리즘은 candidate RGB를 변경하지 않는다. edit region 안
alpha는 selected mask의 Rec.709 luminance로 설정하고, 영역 밖 alpha는 source에서 byte-exact로
복구한다. raw candidate/prior receipt와 모든 mask attempt/receipt는 수정하지 않고 다음 새 파일을
만든다.

- `for_translation/composed/<stable-key>.png`
- `probes/composed/<stable-key>.candidate.rgba`
- `receipts/composed/<stable-key>.json` (schema 5)

schema 5의 `alpha_composition` 객체는 prior receipt/input candidate/probe, 원본 selected imagegen
output, mask receipt/selected mask, input/output dimensions와 hashes, 고정 tool/algorithm을 연결한다.
prior가 schema 4이면 normalization chain도 exact 보존하고 재검증한다. 합성 후 `image:validate`를
다시 실행하며 mask가 input alpha를 실제로 바꾸지 않거나 영역 밖 RGBA/다른 QA가 실패하면
합격시키지 않는다.

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
  alpha는 byte-exact여야 한다. §3.2 mask 합성은 `edit-region-only`에서만 허용한다.
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
- agent-generated receipt가 schema 3, 검증된 canvas-size-only schema 4, 또는 검증된 alpha-mask
  composition schema 5,
  `image_gen.imagegen`, `chatgpt-built-in`,
  `provider-selected`/`provider-managed`, `best-of-3-fail-closed`, 최소 3개 독립 path/hash임
- 정확히 하나의 color 선택 시도가 전 QA 상태를 통과함. schema 3은 manifest candidate와,
  schema 4는 normalization raw input과, schema 5는 prior receipt의 selected imagegen output과
  일치함. schema 5의 mask receipt도 정확히 하나의 mask 시도만 선택함
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
