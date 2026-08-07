---
name: gt-image-translate
description: "Image branch translation after image analysis: translate text-bearing textures, atlases, and raster labels while preserving canvas, alpha, coordinates, style, and approved text terms, with Codex/imagegen and Claude capability handling. Use when translating game images or textures."
---

# gt-image-translate — 이미지 브랜치 I2: 이미지 번역

`gt-image-analyze`가 확정한 대상만 처리한다. 이미지 안의 텍스트는 text branch의 glossary와
STYLE을 따르며, 원본 스타일·canvas·alpha·atlas 계약을 깨는 생성물을 완료로 처리하지 않는다.

## 입력 조건

- `IMAGE_ANALYSIS.md`, `IMAGE_SOURCE_INVENTORY.tsv`, `IMAGE_PLAN.tsv`
- `gt-text-review` handoff, `text_status=review_ready`, `font_status=verified`
- 엔진·플랫폼의 texture/atlas import contract와 원본 이미지 hash
- `PROJECT.md`의 `image_scope`와 실행 환경(Codex/imagegen 또는 Claude)

`image_scope=N/A`이면 계획·가짜 이미지·검수 행을 만들지 않고 0건 근거와
`image_status=skipped`를 기록한 뒤 `gt-qa`로 이동한다. `required`인데 분석·text handoff·
원본 hash가 없으면 `BLOCKED`다.

## 에이전트별 처리

| 환경 | 동작 |
|---|---|
| Codex + imagegen | 계획·스타일 분석 후 imagegen/편집으로 전 대상 생성·수급 |
| Claude 또는 imagegen 불가 | 계획·분석까지만 하고 `hold-for-generation`; 사용자가 공급한 파일을 기다림 |

어느 환경에서도 원본을 그대로 둔 채 번역 완료로 표시하지 않는다.

## 절차

1. 범위·경로·원본 hash·stable key·text glossary를 재확인한다. 기존 for_translation 파일이
   있으면 hash와 계획 행을 비교해 exact reuse하고 복사본을 만들지 않는다.
2. reference를 원본 해상도·포맷으로 추출하고 atlas region/clear bbox/보존 픽셀을 고정한다.
3. 원본 스타일(서체·크기·색·외곽선·질감·여백·active/inactive)을 행별로 기록한다.
4. 대상 문자 영역만 번역한다. canvas·alpha·색상 모드·압축·atlas page/좌표·sprite ID를
   임의 변경하지 않는다. atlas는 원본 좌표에 합성하고 보존 영역 decoded RGBA diff를 검증한다.
5. Codex는 imagegen 결과를 동일 파일명·canvas·포맷으로 생성한 뒤 style/alpha/region을
   비교한다. Claude는 모든 행을 `hold-for-generation`으로 표시하고 공급 경로·hash를
   기록한다.
6. 생성/수급 후 extract→import→re-extract 왕복으로 canvas·format·alpha·atlas·pixel/metadata를
   검사한다. 실패한 행만 `blocked`로 격리하고 전체를 완료 처리하지 않는다.
7. `IMAGE_PLAN.tsv`를 갱신하고 `image_status=translated`를 기록한 뒤 `gt-image-qa`로
   진행한다. 사용자 승인을 기다리는 단계가 아니다.

## 산출물

- `30_translation/image_translation/IMAGE_PLAN.tsv`
- `reference/` 원본 이미지와 atlas map
- `for_translation/` 번역 이미지 또는 hold 목록
- 생성기·입력·출력 hash와 왕복/시각 검증 기록

## 완료 기준

- [ ] required 대상이 전부 계획표에 있고 누락·추가·중복이 없음
- [ ] Codex는 전 대상 생성/수급, Claude는 전 대상 hold 상태와 공급 조건이 있음
- [ ] canvas·format·alpha·atlas 좌표·보존 영역·스타일 검사 통과
- [ ] 왕복 추출·재삽입 후 대상/비대상 diff가 허용 목록과 일치함
- [ ] `image_status=translated`와 현재 원본 hash가 귀속됨
