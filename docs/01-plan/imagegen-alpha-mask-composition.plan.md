# imagegen 알파 마스크 합성 Plan

> 작성일: 2026-08-20 | 상태: Approved | 다음 단계: Design

## Executive Summary

- Problem: 내장 imagegen 편집 결과가 원본의 투명도/안티앨리어싱 alpha를 잃어 후보 QA가 막힌다.
- Solution: 같은 한글 후보를 참조해 imagegen으로 alpha mask를 best-of-3 생성하고, 검증된 mask를
  선언된 edit region에만 결정론적으로 합성한다.
- User effect: RGB 번역 품질이 합격인 후보를 alpha 손실만으로 폐기하지 않아도 된다.
- Core value: imagegen provenance와 원본 보호를 유지하면서 alpha 복구를 재현 가능하게 만든다.

## Context Anchor

| 항목 | 내용 |
|---|---|
| WHY | imagegen이 투명 PNG를 불투명하게 만들거나 glyph alpha를 손실하는 실전 이슈 해소 |
| WHO | PNG/RGBA8 게임 UI·texture 한글화 작업자 |
| RISK | mask 합성이 다른 RGB/레이아웃 실패를 은폐하거나 영역 밖 alpha를 변경할 수 있음 |
| SUCCESS | alpha-only 후보가 합성 뒤 기존 validator `Issues: 0`을 통과하고 provenance가 완전함 |
| SCOPE | imagegen mask receipt, edit-region-only compositor, schema 5 validator, 문서·테스트 |

## 범위

- agent-generated PNG/RGBA8, 동일 canvas, `alpha_policy=edit-region-only`
- selected Korean candidate를 reference로 한 alpha-mask imagegen 3–4회 독립 시도
- mask luminance를 edit region 안 alpha에만 사용하고 영역 밖 source alpha 보존
- raw candidate, prior receipt, mask attempts/receipt를 보존하는 schema 5 receipt

## 비범위

- `alpha_policy=exact`, user-supplied 후보, PNG 외 포맷
- RGB 합성/수정, crop/pad/resize, edit region 밖 변경 복구
- mask 시각 QA 실패 또는 다른 manifest 오류 우회

## 성공 기준

1. `image:compose-alpha` dry-run이 alpha-only 적격성과 mask provenance를 검증한다.
2. `--apply`가 새 composed PNG/probe/schema 5 receipt를 만들고 기존 파일을 덮어쓰지 않는다.
3. mask는 불투명 8-bit PNG이며 RGB luminance가 edit region alpha로 결정론적으로 합성된다.
4. 영역 밖 source RGBA exact, 영역 안 mask alpha, 기존 시각/문자/roundtrip QA가 모두 유지된다.
5. 성공·비alpha 오류·mask 변조·영역 밖 RGB drift 회귀 테스트가 통과한다.

## 위험과 대응

| 위험 | 대응 |
|---|---|
| mask가 잘못된 glyph 윤곽을 만듦 | best-of-3와 edge/transparency visual status 전수 검사 |
| 합성으로 다른 오류를 숨김 | 현재 validator 오류를 alpha 관련 allowlist로 제한하고 RGB를 별도 비교 |
| 영역 밖 투명도 변경 | output alpha를 source에서 복사하고 최종 byte 검증 |
| provenance 단절 | prior receipt, selected imagegen output, mask receipt/attempt를 SHA-256으로 연결 |
