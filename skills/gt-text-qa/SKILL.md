---
name: gt-text-qa
description: "Text branch technical QA after Korean translation: validate manifest structure and round-trip safety, prove full Korean font glyph coverage and atlas coordinates/metrics, build an emulator-ready text candidate, and route to text review without waiting for user approval. Use after gt-text-translate or when text/font rendering preparation must be verified."
---

# gt-text-qa — 텍스트 브랜치 T3: 텍스트·폰트 기술 QA

번역문만 검사하지 않는다. 실제 번역에 필요한 전체 글리프가 실제 consumer 폰트와
아틀라스 metadata에 안전하게 들어갔는지 검증한 뒤, 에뮬레이터에 투입할 수 있는
텍스트 후보를 만든다. 이 단계의 `review_ready`는 사용자 승인이나 런타임 PASS가 아니다.

## 입력 조건

- `gt-text-analyze`의 `TEXT_ANALYSIS.md`, `TEXT_SOURCE_INVENTORY.tsv`, canonical
  `translation_manifest.tsv`
- `gt-text-translate`의 전 배치 결과·용어집·STYLE·작업 로그
- 플랫폼 어댑터의 역변환·staging·build-test 계약과 엔진 폰트 문서
- `$GT_HOME/common/font-atlas-contract.md`와 프로젝트의 `font_status`, font asset 경로
- 프로젝트의 최신 입력 해시, `target_language_slot`, `text_review_policy`

입력 manifest의 행 수·ID·원문·해시가 현재 번역 시트와 다르면 `BLOCKED`다. 빈 대상이나
누락 배치를 반복문 0건으로 PASS 처리하지 않는다.

## 절차

0. **사전 게이트**: `SAFETY.md`, `project-structure.md`, `preflight-checks.md`,
   `font-atlas-contract.md`, 플랫폼·엔진 문서를 읽고 literal 경로·Title ID·입력 해시·
   canonical staging을 확정한다.
1. **번역 완결 검사**: 모든 대상이 `translated` 또는 명시적 `blocked`인지 확인한다.
   `new`, 빈 `target_ko`, 누락·중복 ID, 보호 필드 변경, 용어집 충돌이 하나라도 있으면
   대상 배치를 격리하고 전체 후보를 만들지 않는다.
2. **독립 텍스트 QA**: 원문부터 다시 읽어 의미 누락·오역 후보·잔존 원문·말투·용어집·
   표시 폭·제어 토큰·태그·개행·placeholder를 전수 검사한다. low-confidence와
   semantic conflict는 수정 전까지 `blocked`로 유지한다.
3. **구조 왕복**: TSV→게임 포맷→TSV 또는 extract→import→re-extract를 깨끗한 원본과
   staging에서 수행한다. ID·행 수·순서·불변 필드·제어 토큰 서명·언어 슬롯이 exact
   일치해야 하며, 종료 코드 0만으로 통과시키지 않는다.
4. **전체 가시 코드포인트 추출**: 최종 텍스트·UI·선택지·설정·루비·특수문자에서
   제어부/태그를 제외한 코드포인트를 전수 추출한다. 샘플 문장이나 한글 완성형 일부만
   커버리지로 간주하지 않는다. 결과를 `FONT_COVERAGE.tsv`에 기록한다.
5. **폰트 consumer·glyph 검증**: 실제 런타임이 읽는 폰트 asset/fallback/language slot을
   증명하고, 코드포인트별 glyph ID·outline·atlas page/rect·UV 원점·bearing·advance·
   baseline·line height·padding을 `FONT_ATLAS_MANIFEST.tsv`에 기록한다. 다음을 모두
   검사한다.
   - 기존 언어·비대상 glyph의 mapping, rect, metrics는 원본과 exact
   - 새 한글은 글자별 임의 배율 없이 공통 scale/baseline 사용
   - rect 경계·padding·겹침·페이지·좌표계가 유효
   - face metrics·atlas format·alpha·mip·font reference가 의도 없이 교체되지 않음
6. **아틀라스 왕복·렌더 probe**: `glyph table → atlas → re-import → re-export`를
   독립 프로세스에서 수행하고 manifest와 비교한다. 한글 완성형·자모·숫자·문장부호·
   작은 글자·루비·active/inactive 상태를 실제 consumer로 렌더링해 tofu·빈 outline·
   잘린 descender·baseline 이동·advance/겹침을 검사한다. 검증 스크립트가 있으면 다음
   명령 형태로 실행하고 결과를 보존한다.

   ```text
   node "$GT_HOME/scripts/validate-font-atlas.mjs" \
     --manifest "<프로젝트>/30_translation/text/FONT_ATLAS_MANIFEST.tsv" \
     --coverage "<프로젝트>/30_translation/text/FONT_COVERAGE.tsv"
   ```

   실패하면 `font_status=blocked`로 기록하고 `TEXT_QA_REPORT.md`에 codepoint·asset·해시·
   재검증 조건을 남긴다. 통과한 경우에만 `font_status=verified`를 기록한다.
7. **텍스트 후보 생성**: 폰트와 텍스트를 깨끗한 원본에 재삽입해 플랫폼 어댑터의
   canonical staging에 텍스트 후보를 만든다. 임의 파일명·언어 슬롯·기존 후보 복사를
   사용하지 않는다. `TEXT_BUILD_MANIFEST.tsv`에 파일 수·구조·magic·교체 목록·입출력
   SHA-256·폰트 manifest SHA-256을 기록한다.
8. **상태·handoff 기록**: `TEXT_QA_REPORT.md`에 정적/bench 결과를 남기고
   `PROJECT.md`에 `text_status=qa_ready`, `font_status=verified`,
   `text_runtime_ready=PASS (bench)` 또는 `PENDING_RUNTIME`을 기록한다. 완료 시
   `gt-text-review`로 진행한다. `text_review_policy=prepare-only`라면 사용자 응답을
   기다리지 않는다. `user-gate`인 경우에도 사용자 게이트는 다음 review 단계가 담당한다.

## 벡터 폰트(TTF/TTC/OTF) 한글 추가 — 검증된 방법

엔진이 런타임에 벡터 폰트를 그리는 경우(nn::fontll, KiriKiri `addFont`, Artemis `set_textfont` 등)의
실증 절차다. 아틀라스 엔진은 계약서의 atlas 경로를 그대로 따른다.

1. **consumer 증명 먼저**: 폰트 목록 파일(`fontresource`, `deffontmap.tjs`/`embfontlist.tjs`,
   `list_<platform>.tbl` 등)과 실행 파일 심볼·문자열로 해당 언어 슬롯이 실제로 읽는 파일·face를
   확정한다. 사용자 폰트 선택이 있으면 선택지 전부가 대상이다. 어디서도 참조되지 않는
   PC 시대 비트맵 폰트(예: Shift-JIS 인덱스 `.fnt`)는 건드리지 않되 런타임 의심 항목으로 기록한다.
2. **번들 폰트가 이미 한글을 갖는지 확인**: Source Han Sans 등은 한글 11,172자를 이미 포함할 수
   있다. 그러면 폰트를 바꾸지 않고 커버리지·probe 증거만 만든다.
3. **원본 파일에 덧붙이기**: 파일명·face 이름·로더 스크립트는 그대로 두고 원본 폰트에 U+AC00–D7A3,
   호환 자모, 번역문에 쓰였지만 없는 문자(예: KEEP 행의 `简`, `·`)를 새 glyph로 추가한다.
   출처는 OFL 한글 폰트 또는 게임에 번들된 OFL CJK 폰트이며 굵기·서체를 맞추고 출처를 기록한다.
4. **공통 변환 하나**: 폰트마다 기준 한자(예: 国語東京会) bbox 높이·중심으로 scale·dy를 한 번
   구해 모든 한글에 적용한다. 고정폭 face는 원본 전각 advance 중앙에 두고, 같은 계열(Source Han)은
   원래 한글 advance(920 등)를 유지할 수 있다. vmtx/VORG도 같은 원점으로 채운다.
5. **원본 보존 증명**: 원래 cmap 매핑·glyph outline·hmtx/vmtx를 glyph ID별로 원본과 바이트 비교해
   차이 0을 증명한다. 저장 후 독립 프로세스로 재파싱해 새 glyph 기하가 공통 변환과 ±2 unit 이내인지 본다.
6. **알려진 함정**
   - 비표준 `cmap` format 4(glyphIdArray 범위 초과)는 fontTools가 거부한다. 원본 매핑은 관용
     파서로 읽어 그대로 재구성하고, 범위 초과 항목 수를 보고서에 남긴다.
   - TTC의 face들은 `glyf`/`loca`를 공유한다. fontTools에서 `setGlyphOrder`에 넘긴 리스트를 `glyf`가
     직접 붙잡아 append하므로 반드시 복사본을 넘기고, 모든 face에 같은 순서로 추가한다.
   - CID-CFF는 CID가 연속이 아닐 수 있으므로 비어 있는 CID를 써야 한다.
   - post format 3 폰트는 glyph 이름이 없어 `getGlyphOrder()`가 cmap을 강제로 읽는다. 먼저 순서를 직접 지정한다.
7. **벡터 폰트의 manifest 표기**: `validate-font-atlas.mjs`는 아틀라스를 가정한다. 래스터 아틀라스가
   없으면 코드포인트당 1개의 em 레이아웃 셀(font unit)을 가상 격자로 기록하고, bearing·advance는 실제
   값을 쓰며, 그 사실을 `FONT_ATLAS_QA_REPORT.md`에 명시한다. 커버리지는 코드포인트당 1행(전 face 합산)이다.
8. **render probe**: FreeType(Pillow)로 모든 face에서 필요한 코드포인트를 렌더링해 빈 비트맵 0을 확인하고,
   한자·가나와 한글을 섞은 줄의 PNG를 `50_test/font_probe/`에 남긴다.

## 한국어 줄바꿈 — 엔진 규칙 표 우선

일본어 엔진은 글자 단위로 줄을 바꾸는 경우가 많아 한국어가 "따뜻/한"처럼 단어 중간에서 끊긴다.
1. 먼저 엔진이 실제로 읽는 줄바꿈 규칙 표를 찾는다(예: Artemis `system/list_*_ja.tbl`의 wordparts/prohibit).
   스크립트(init.lua 등) 상수 수정은 반영되지 않거나 멈춤을 일으킬 수 있으므로 표가 있으면 표를 고친다.
2. wordparts에 한글 음절·자모를 넣되 닫는 괄호 `」』）`는 넣지 않는다. 대사창 indent 짝 `「」（）『』`과
   충돌해 「…」 대사가 오른쪽 끝에서 한 단어씩 끊긴다(Meteor r5→r6에서 확인).
3. 표가 없거나 통하지 않을 때만 실제 폰트 advance와 대사창 폭으로 계산한 명시 개행을 한국어에 넣는다
   (백로그 폭에서도 깨지지 않는지 확인, 원자적 병합 1회).
4. 판정은 Eden 대사 화면과 백로그·세이브 후 백로그에서 한다. 정적 검사만으로 PASS 처리하지 않는다.

## 산출물

- `30_translation/text/TEXT_QA_REPORT.md`
- `30_translation/text/TEXT_BUILD_MANIFEST.tsv`와 canonical text staging
- `30_translation/text/FONT_COVERAGE.tsv`
- `30_translation/text/FONT_ATLAS_MANIFEST.tsv`
- `30_translation/text/FONT_ATLAS_QA_REPORT.md`
- 입력·출력·폰트·staging SHA-256 및 왕복/렌더 probe 로그

## 완료 기준

- [ ] 모든 번역 대상의 ID·구조·제어 토큰·왕복 검증 통과
- [ ] `30_translation/text/HELD_FOR_USER.tsv`가 있고(0행이면 헤더만), 병합된 `ko_user` 행도 같은 구조 검사를 통과함
- [ ] 전체 가시 코드포인트가 실제 consumer 폰트에 대응함
- [ ] 기존 glyph 보존, 새 glyph 공통 scale/baseline, rect·padding·UV·metrics 검증 통과
- [ ] 아틀라스 재추출 왕복과 렌더 probe에서 tofu·위치·잘림·겹침 오류 0건
- [ ] `font_status=verified`와 `TEXT_BUILD_MANIFEST.tsv`가 현재 입력 해시에 귀속됨
- [ ] `text_status=qa_ready`가 기록되고 `gt-text-review`로 자동 진행 가능함
