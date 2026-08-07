# 한글 폰트·글리프·아틀라스 검증 계약

폰트는 텍스트 번역의 부속 파일이 아니라 런타임 표시를 결정하는 별도 입력이다.
`gt-text-qa`는 텍스트 후보를 `review_ready`로 만들기 전에 이 계약을 모두 증명한다.
폰트 파일이 존재하거나 아틀라스가 재생성되었다는 사실만으로 통과시키지 않는다.

## 필수 산출물

```text
30_translation/text/FONT_ATLAS_MANIFEST.tsv
30_translation/text/FONT_COVERAGE.tsv
30_translation/text/FONT_ATLAS_QA_REPORT.md
```

`FONT_ATLAS_MANIFEST.tsv`의 최소 컬럼은 다음과 같다.

```text
codepoint	character	glyph_id	atlas_page	atlas_width	atlas_height	x	y	width	height	bearing_x	bearing_y	advance_x	line_height	padding	uv_origin	source_sha256	target_sha256	roundtrip_status	render_probe_status	status	notes
```

## 필수 검사

1. 최종 텍스트·UI·이미지 문자에서 제어 코드와 태그를 제거한 **전체 가시 코드포인트**를
   추출한다. 샘플 문자나 대표 문장만으로 커버리지를 선언하지 않는다.
2. 코드포인트마다 실제 런타임 폰트 자산·glyph ID·아틀라스 페이지·사각형·UV 원점·
   bearing·advance·line metrics를 기록한다. 동일 코드포인트가 의도 없이 중복되거나,
   필요한 glyph가 빈 outline이면 `BLOCKED`다.
3. 모든 rect와 사방 padding이 아틀라스 경계 안에 있고, padding을 침범하지 않으며, 겹침·음수 좌표·
   페이지 누락이 없어야 한다. 좌표계가 top-left인지 bottom-left인지 명시하고 변환 후
   다시 추출해 같은 좌표가 나오는지 확인한다.
4. 기존 언어 glyph와 비대상 glyph의 codepoint→glyph 매핑·rect·bearing·advance·baseline은
   원본과 exact 비교한다. 변경 허용 목록은 새 한글 glyph와 도구가 불가피하게 갱신하는
   명시된 인덱스/체크섬뿐이다.
5. 새 한글 glyph는 글자별 임의 배율을 사용하지 않고 공통 스케일·공통 baseline 정책을
   사용한다. 기존 face metrics, line height, padding, atlas format, alpha, mip 설정을
   통째로 새 폰트 값으로 교체하지 않는다.
6. 대상 폰트 아틀라스를 독립 프로세스에서 재추출·재파싱하고, `glyph table → atlas →
   re-import → re-export` 왕복을 수행한다. 왕복 후 glyph ID·rect·metrics·coverage가
   manifest와 일치해야 한다.
7. 한글 완성형·자모·숫자·문장부호·특수문자·작은 글자·루비·비활성/선택 상태를 포함한
   render probe를 실제 소비 폰트로 수행한다. tofu, 빈 outline, 잘린 descender,
   위아래로 밀린 baseline, 글자 간 겹침, advance 오차가 하나라도 있으면 `BLOCKED`다.
8. 폰트가 여러 크기·패밀리·fallback·언어 슬롯으로 나뉘면 각각을 별도 manifest 행과
   별도 probe로 기록한다. 한 패밀리의 성공을 다른 패밀리의 성공으로 복사하지 않는다.

## 실패 시 복구

- 아틀라스 텍스처만 교체하고 glyph table을 유지하지 않는다. 원본에서 다시 시작해
  텍스처와 metadata를 함께 재생성한다.
- glyph 위치가 틀리면 per-character 보정으로 덮지 말고 UV 원점·padding·좌표계·공통
  스케일·font asset 참조를 역추적한다.
- 한글이 보이지 않으면 먼저 실제 consumer/fallback 체인과 language slot을 증명하고,
  폰트가 로드되었다는 로그만으로 해결을 선언하지 않는다.
- 실패 후보는 `font_status=blocked`와 영향 받는 codepoint·asset·해시·재검증 조건을
  기록한다. 검증되지 않은 폰트 후보를 `review_ready` staging에 포함하지 않는다.

`PASS (bench)`는 manifest·왕복·probe가 통과했다는 뜻이고, 실제 화면에서의 폰트 표시와
레이아웃 확인은 `gt-qa`의 별도 런타임 증거다.
