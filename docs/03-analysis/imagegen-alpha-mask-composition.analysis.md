# imagegen 알파 마스크 합성 Gap Analysis

> 작성일: 2026-08-20 | 대상: Plan/Design 대비 구현

## 품질 요약

| 차원 | 점수 | 근거 |
|---|---:|---|
| Structural | 100 | mask receipt validator, compositor CLI, schema 5 validator, 계약·skill route 존재 |
| Functional | 98 | 정상 합성, 비alpha 오류, RGB drift, mask QA 및 사후 변조 경로 검증 |
| Contract | 100 | source/prior receipt/raw candidate/mask attempts를 hash로 연결하고 합성 bytes 재계산 |
| Runtime | 100 | Node checks, 39/39 harness tests, skill contract `Issues: 0` |

런타임 가중식 `0.15·Structural + 0.25·Functional + 0.25·Contract + 0.35·Runtime` 기준
매치율은 **99.5%**다. 임계값 90%를 통과했고 Critical/Major finding은 없다.

## 요구사항 추적

| 요구사항 | 구현/증거 | 결과 |
|---|---|---|
| imagegen alpha mask 생성 흐름 | built-in imagegen best-of-3 prompt/receipt 계약 | PASS |
| 영역 제한 alpha 합성 | candidate RGB 유지, source alpha outside, mask luminance inside | PASS |
| 원본·후보 보존 | `composed/` 파생 파일과 schema 5 receipt, overwrite 거부 | PASS |
| 다른 오류 우회 금지 | preflight alpha-only allowlist와 outside-region RGB 비교 | PASS |
| provenance 검증 | prior schema 3/4, raw selected output, mask receipt/attempt hashes 연결 | PASS |
| 결정론 검증 | validator가 PNG decode 후 고정 알고리즘으로 output bytes 재계산 | PASS |
| 회귀 방지 | 전체 39개 테스트와 bundle contract 통과 | PASS |

## QA 증거

| ID | 동작 | 기대/실제 | 결과 |
|---|---|---|---|
| IMG-ALPHA-01 | alpha가 소실된 동일 canvas PNG 합성 | edit region alpha=mask, 영역 밖 source alpha, `Issues: 0` | PASS |
| IMG-ALPHA-02 | 비alpha QA 오류 동반 | output 작성 전 거부 | PASS |
| IMG-ALPHA-03 | 영역 밖 candidate RGB 변경 | 합성으로 은폐하지 않고 거부 | PASS |
| IMG-ALPHA-04 | selected mask edge QA 실패 | receipt gate에서 거부 | PASS |
| IMG-ALPHA-05 | 합성 후 selected mask bytes 변조 | 최종 validator hash 검증 실패 | PASS |
| REG-01 | 전체 harness | 39 passed, 0 failed | PASS |
| CONTRACT-01 | skill bundle | Skills 15, stages 11, Issues 0 | PASS |

## 잔여 제한

- 자동 합성은 agent-generated PNG/RGBA8, 동일 canvas, `alpha_policy=edit-region-only`에만 적용한다.
- mask는 불투명 grayscale PNG여야 하며 채널 간 차이가 8을 넘으면 실패한다.
- crop/pad/resize, RGB 복구, 영역 밖 변경 및 실패한 시각 QA는 합성으로 우회하지 않는다.
