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

## 산출물

- `30_translation/text/TEXT_QA_REPORT.md`
- `30_translation/text/TEXT_BUILD_MANIFEST.tsv`와 canonical text staging
- `30_translation/text/FONT_COVERAGE.tsv`
- `30_translation/text/FONT_ATLAS_MANIFEST.tsv`
- `30_translation/text/FONT_ATLAS_QA_REPORT.md`
- 입력·출력·폰트·staging SHA-256 및 왕복/렌더 probe 로그

## 완료 기준

- [ ] 모든 번역 대상의 ID·구조·제어 토큰·왕복 검증 통과
- [ ] 전체 가시 코드포인트가 실제 consumer 폰트에 대응함
- [ ] 기존 glyph 보존, 새 glyph 공통 scale/baseline, rect·padding·UV·metrics 검증 통과
- [ ] 아틀라스 재추출 왕복과 렌더 probe에서 tofu·위치·잘림·겹침 오류 0건
- [ ] `font_status=verified`와 `TEXT_BUILD_MANIFEST.tsv`가 현재 입력 해시에 귀속됨
- [ ] `text_status=qa_ready`가 기록되고 `gt-text-review`로 자동 진행 가능함
