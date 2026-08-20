# imagegen 크기 정규화 Gap Analysis

> 작성일: 2026-08-20 | 대상: Plan/Design 대비 구현

## 품질 요약

| 차원 | 점수 | 근거 |
|---|---:|---|
| Structural | 100 | CLI, PNG codec/resampler, shared manifest parser, schema 4 validator, 문서·package route 존재 |
| Functional | 98 | 정상 resize와 3개 실패 경로 검증; 지원 PNG는 8-bit non-interlaced로 의도적으로 제한 |
| Contract | 100 | raw output/schema 3 보존, schema 4 hash 연결, 결정론적 재계산, 기존 QA 불변 |
| Runtime | 100 | Node checks, 35/35 harness tests, skill contract `Issues: 0` |

런타임 가중식 `0.15·Structural + 0.25·Functional + 0.25·Contract + 0.35·Runtime` 기준
매치율은 **99.5%**다. 임계값 90%를 통과했고 Critical/Major finding은 없다.

## 요구사항 추적

| 요구사항 | 구현/증거 | 결과 |
|---|---|---|
| 크기 문제만 자동 보정 | validator 오류 allowlist + 동일 종횡비 + PNG/RGBA8 gate | PASS |
| 실제 raster resize | PNG decode → premultiplied-alpha bilinear → deterministic PNG encode | PASS |
| 원본 보존 | raw candidate/probe/schema 3 receipt 유지, `normalized/` 새 파일 | PASS |
| 다른 오류 우회 금지 | 정규화 전 비크기 오류 거부, 후 alpha/preserved-region 검사 | PASS |
| provenance 검증 | schema 4 input/output/original receipt hash 및 algorithm 재계산 | PASS |
| 회귀 방지 | schema 3 기존 테스트와 신규 성공/거부/변조 테스트 35개 통과 | PASS |

## QA 증거

| ID | 동작 | 기대/실제 | 결과 |
|---|---|---|---|
| IMG-NORM-01 | 4×4 동일 종횡비 후보를 2×2로 적용 | 새 파일·schema 4 생성, validator `Issues: 0` | PASS |
| IMG-NORM-02 | 4×2 → 2×2 입력 | 종횡비 오류, 출력 없음 | PASS |
| IMG-NORM-03 | `original_feel_status=fail` 동반 | non-size issue로 출력 전 거부 | PASS |
| IMG-NORM-04 | normalization algorithm 변조 | receipt hash/algorithm 검증 실패 | PASS |
| REG-01 | 전체 harness | 35 passed, 0 failed | PASS |
| CONTRACT-01 | skill bundle | Skills 15, stages 11, Issues 0 | PASS |

## 잔여 제한

- 자동 정규화 입력은 8-bit non-interlaced grayscale/RGB/grayscale-alpha/RGBA PNG만 지원한다.
  palette, 16-bit, interlaced PNG와 엔진 전용 raster는 변환하지 않고 `BLOCKED`로 둔다.
- crop/pad 또는 종횡비 변경은 단순 크기 문제로 간주하지 않는다.
