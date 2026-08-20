# imagegen 알파 마스크 합성 완료 보고서

> 완료일: 2026-08-20 | PDCA: Plan → Design → Do → Check → Act 완료

내장 imagegen 편집 결과가 투명도나 glyph 안티앨리어싱 alpha를 잃는 경우, 같은 한글 후보를
참조해 생성한 best-of-3 alpha mask를 선언된 edit region에만 결정론적으로 합성하는 기능을 추가했다.

## 완료 내용

- `image:compose-alpha` dry-run/`--apply` CLI
- built-in imagegen alpha-mask prompt와 schema 1 best-of-3 receipt 계약
- candidate RGB 유지, 영역 밖 source alpha 복원, 영역 안 mask luminance 적용
- raw imagegen 후보·prior schema 3/4 receipt·mask attempts를 보존하는 schema 5 provenance
- mask canvas/불투명도/grayscale/edge QA와 영역 밖 RGB drift 실패-폐쇄 검증
- 최종 validator의 hash chain 및 결정론적 PNG/RGBA 재계산
- README, 안전 규칙, 공통 계약, image translate/QA/review/orchestrator 지침 동기화

## 최종 판정

- Plan/Design match: 99.5%
- 자동 테스트: 39/39 PASS
- Skill contract: `Issues: 0`
- Critical/Major actionable findings: 0/0

알파 합성은 QA 면제가 아니다. 기존의 원문 제거, 한글 정확성, 원본 느낌, layout, roundtrip과
edit region 밖 RGB exact 검증이 모두 통과해야 하며, 크기가 다르면 먼저 허용된 크기 정규화를 거쳐야 한다.
