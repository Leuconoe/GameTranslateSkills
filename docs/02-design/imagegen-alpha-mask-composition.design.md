# imagegen 알파 마스크 합성 Design

> 작성일: 2026-08-20 | Plan: `docs/01-plan/imagegen-alpha-mask-composition.plan.md`

## Context Anchor

| 항목 | 내용 |
|---|---|
| WHY | imagegen이 투명 PNG를 불투명하게 만들거나 glyph alpha를 손실하는 실전 이슈 해소 |
| WHO | PNG/RGBA8 게임 UI·texture 한글화 작업자 |
| RISK | mask 합성이 다른 RGB/레이아웃 실패를 은폐하거나 영역 밖 alpha를 변경할 수 있음 |
| SUCCESS | alpha-only 후보가 합성 뒤 기존 validator `Issues: 0`을 통과하고 provenance가 완전함 |
| SCOPE | imagegen mask receipt, edit-region-only compositor, schema 5 validator, 문서·테스트 |

## 설계 선택

| 선택지 | 판정 | 이유 |
|---|---|---|
| source alpha를 전체 복사 | 기각 | 번역된 Korean glyph의 새 alpha 윤곽을 표현하지 못함 |
| 단일 imagegen mask를 즉시 합성 | 기각 | 생성 편차와 잘못된 edge를 실패-폐쇄로 통제할 수 없음 |
| best-of-3 imagegen mask + 영역 제한 합성 | 채택 | 기존 provenance 모델을 재사용하고 RGB/영역 경계를 보존 가능 |

## 흐름

```text
schema 3/4 Korean candidate
  -> same candidate + exact mask prompt로 imagegen mask 3–4회 생성
  -> ALPHA_MASK_RECEIPT schema 1에서 정확히 하나 selected
  -> compose-alpha eligibility gate
  -> output RGB = Korean candidate RGB
  -> output alpha = source alpha(outside) / mask Rec.709 luminance(inside)
  -> composed PNG + probe + schema 5 receipt
  -> 전체 image validator 재실행
```

## Module Map

| 모듈 | 책임 |
|---|---|
| `scripts/lib/image-alpha-mask.mjs` | edit region parse, mask luminance, 결정론적 RGBA 합성 |
| `scripts/compose-imagegen-alpha.mjs` | 입력/receipt gate, dry-run/apply, manifest 원자 갱신 |
| `scripts/validate-image-translation.mjs` | schema 5 chain과 mask receipt/합성 bytes 재계산 |
| `common/image-translation-contract.md` | mask prompt·receipt·경로·QA 계약 |

## Receipt 계약

- mask receipt schema 1은 `purpose=alpha-mask`, built-in imagegen provenance, same reference/prompt,
  3–4개 attempt, exactly one selected, `technical/visual/edge/transparency_intent` 상태를 기록한다.
- composed receipt schema 5의 `alpha_composition`은 prior receipt/input candidate/probe, mask
  receipt/selected output, source dimensions, output candidate/probe 및 고정 알고리즘을 연결한다.
- prior receipt가 schema 4이면 size-normalization chain도 그대로 보존하고 재검증한다.

## 오류 처리

- 현재 validator가 성공하거나 alpha 관련 pixel 오류만 낼 때 진행한다.
- candidate RGB가 source와 edit region 밖에서 다르면 합성 전 실패한다.
- mask canvas가 다르거나 mask PNG alpha가 255가 아니거나 grayscale channel drift가 8을 넘으면 실패한다.
- 합성 결과가 input alpha와 한 픽셀도 다르지 않으면 불필요/잘못된 mask로 실패한다.
- 모든 output 경로는 `composed/`의 새 파일이어야 하며 기존 파일이 있으면 실패한다.

## 테스트

- alpha가 소실된 2×2 PNG + 4×4가 아닌 동일 canvas mask 성공
- non-alpha manifest 오류와 영역 밖 RGB drift 거부
- mask receipt/hash/selected attempt 변조 거부
- schema 4 prior receipt에서 schema 5 chain 유지
- 기존 schema 3/4 전체 회귀 통과
