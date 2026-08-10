---
name: gt-image-analyze
description: "Image branch analysis after overall and text handoff: inventory every text-bearing texture and lock its atmosphere, edit regions, anchors, canvas, alpha policy, format, atlas, style, and image scope before translation. Use when starting or resuming image analysis for a game localization project."
---

# gt-image-analyze — 이미지 브랜치 I1: 이미지 분석

이미지 안의 문자를 실제로 번역해야 하는지와 재삽입 계약을 확정한다. 생성·수정은 하지
않으며, 파일명이나 빈 목록만으로 `N/A`를 추정하지 않는다.

## 입력 조건

- `gt-analyze`의 전체 컨테이너 inventory와 `ANALYSIS.md`
- `gt-text-review`의 `text_status=review_ready` handoff와 준비된 glossary·STYLE
- `PROJECT.md`의 `image_scope`, 원본 inventory, target language slot
- 플랫폼·엔진의 texture/atlas/alpha/import 문서와
  `$GT_HOME/common/image-translation-contract.md`

text handoff 또는 `font_status=verified`가 없으면 이미지 안의 텍스트가 번역어와 일치하는지
검증할 수 없으므로 `BLOCKED`다. `image_scope=pending`이면 먼저 범위를 판정한다.

## 절차

0. `SAFETY.md`, `project-structure.md`, `preflight-checks.md`, 플랫폼·엔진 문서를 읽고
   프로젝트·원본 해시·canonical 경로를 literal로 확정한다.
1. **범위 판정**: 컨테이너 엔트리 전수 목록을 만들고 이미지가 없거나 게임별 근거상
   번역 대상이 없으면 `image_scope=N/A`와 0건 근거를 `PROJECT.md`/`IMAGE_ANALYSIS.md`에
   기록한다. 대상이 하나라도 있거나 확인할 수 없으면 `required` 또는 `BLOCKED`로 둔다.
2. **이미지 전수 inventory**: 경로·stable key·포맷·canvas·색상 모드·alpha·압축·mip·
   원본 SHA-256·언어 variant·runtime consumer를 기록한다. 아틀라스는 page·x/y·width/
   height·padding·UV 원점·sprite/region ID까지 기록한다.
3. **문자 영역 확인**: 시각 검사와 엔진 metadata를 교차 확인해 실제 문자 영역·보존 영역·
   일반 이미지·미확인을 분리한다. OCR/파일명은 후보 근거일 뿐 완료 근거가 아니다.
4. **분위기·스타일·보존 계약**: 원어 이미지의 시대감·장르·온도감·명도/채도·재질·광원·
   감정과 폰트 계열·크기·색·외곽선·그라데이션·여백·레이어·clear bbox·clip·
   active/inactive 관계를 행별로 서술한다. 각 문자 영역의 exact `edit_regions`, anchor,
   정렬, baseline을 실제 metadata/시각 검사로 고정한다. 빈 값·`N/A`·추측값은 허용하지 않는다.
   원본 해상도·캔버스·alpha·atlas 좌표를 임의로 바꾸지 않는 기준을 정한다. alpha는
   기본 `exact`이며, 글자 glyph 자체가 alpha에 들어 있음을 증명한 행만
   `edit-region-only`로 선언한다.
5. **계획표 작성**: `30_translation/image_translation/IMAGE_PLAN.tsv`에 required 대상
   전부를 `identified`로 기록한다. 같은 stable key를 text manifest에 중복 등록하지 않는다.
   `IMAGE_GENERATION_MANIFEST.tsv`의 stable key는 물리 raster 파일 단위로 두고, 한 atlas의
   여러 region ID를 그 bitmap과 `edit_regions`에 연결한다.
6. **비파괴 reference 준비**: `10_extract` 원본을 수정하지 않고
   `image_translation/reference/`에 byte-exact reference를 만든다. reference hash가 원본과
   다르거나 symlink/reparse point면 `BLOCKED`다.
7. **해시·경로 검증**: reference와 for_translation을 혼동하지 않고 canonical 상대 경로,
   대소문자, 원본 hash, 예상 대상 수를 재확인한다. 생성기는 원본/reference에 쓸 권한이 없다.

## 산출물

- `30_translation/image_translation/IMAGE_ANALYSIS.md`
- `30_translation/image_translation/IMAGE_SOURCE_INVENTORY.tsv`
- `30_translation/image_translation/IMAGE_PLAN.tsv` (`required`일 때)
- stable key별 atmosphere/style, edit region·anchor, canvas/alpha/atlas 계약과 byte-exact reference
- `image_scope=N/A`이면 0건 inventory·판정 근거·생략 상태 기록

## 완료 기준

- [ ] 대상·비대상·미확인 이미지가 전수 기록됨
- [ ] 문자 영역·보존 영역·atlas region·runtime consumer가 구분됨
- [ ] canvas·format·alpha·압축·좌표·분위기·스타일 계약과 원본/reference hash가 있음
- [ ] edit region·anchor·atlas rect가 수치로 고정되고 원본/reference가 byte-exact임
- [ ] `required`면 IMAGE_PLAN 입력 수가 inventory와 exact 일치함
- [ ] `N/A`면 0건과 근거가 기록되고 이미지 단계를 생략할 수 있음

완료 시 `gt-image-translate`로 진행하며 사용자 승인을 기다리지 않는다.
