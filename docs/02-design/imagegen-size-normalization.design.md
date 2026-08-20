# imagegen 크기 정규화 Design

> 작성일: 2026-08-20 | Plan: `docs/01-plan/imagegen-size-normalization.plan.md`

## 설계 선택

| 선택지 | 판정 | 이유 |
|---|---|---|
| validator가 크기 차이를 무시 | 기각 | 실제 파일이 importer 계약을 위반하고 오류를 숨김 |
| 외부 ImageMagick/Pillow 의존 | 기각 | 설치·플랫폼 편차와 기존 no-API/no-local-editor 계약 충돌 |
| Node 내장 모듈 기반 PNG 정규화 + 재검증 | 채택 | 의존성 없이 결정론적이며 provenance를 코드로 검증 가능 |

## 흐름

```text
schema 3 receipt + selected raw PNG + raw RGBA probe
  -> eligibility gate (agent-generated, PNG/RGBA8, size mismatch only, same aspect ratio)
  -> premultiplied-alpha bilinear resize
  -> normalized PNG + normalized RGBA probe (new paths)
  -> schema 4 receipt (raw input and prior receipt linked by SHA-256)
  -> manifest candidate/receipt/dimensions updated atomically
  -> existing image validator (all pixel/provenance/status gates)
```

## 파일 계약

- CLI: `scripts/normalize-imagegen-size.mjs`
- codec/resampler: `scripts/lib/png-rgba.mjs`
- 출력:
  - `30_translation/image_translation/for_translation/normalized/<stable-key>.png`
  - `30_translation/image_translation/probes/normalized/<stable-key>.candidate.rgba`
  - `30_translation/image_translation/receipts/normalized/<stable-key>.json`
- 입력과 출력은 물리적으로 달라야 하고 출력 경로는 비어 있어야 한다.

## schema 4 normalization 객체

`reason=canvas-size-only`, 고정 tool/algorithm, 이전 receipt path/hash, raw input path/hash 및
dimensions, normalized output path/hash 및 dimensions, probe path/hash를 기록한다. 선택 attempt는
raw imagegen output을 가리키고 top-level candidate는 normalized output을 가리킨다.

## 검증 규칙

- 실제 PNG IHDR가 manifest/normalization dimensions와 일치해야 한다.
- raw candidate probe가 PNG decode 결과와 byte-exact여야 한다.
- target 종횡비가 다르면 resize-only로 보지 않는다.
- schema 4 receipt는 원본 schema 3 receipt와 selected attempt를 hash로 연결해야 한다.
- 정규화 후 기존 alpha, edit region 밖 RGBA exact, 내부 RGB 변경, atlas/anchor/status 검증을
  한 항목도 완화하지 않는다.
