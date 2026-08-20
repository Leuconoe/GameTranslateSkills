# imagegen 크기 정규화 완료 보고서

> 완료일: 2026-08-20 | PDCA: Plan → Design → Do → Check → Act 완료

내장 imagegen이 원본과 다른 크기의 PNG를 반환해 이미지 QA가 막히는 경우, 크기 외 오류가 없을
때만 원본 canvas로 정규화하는 기능을 추가했다.

## 완료 내용

- `image:normalize-size` dry-run/`--apply` CLI
- 의존성 없는 PNG RGBA decoder/encoder와 결정론적 bilinear resampler
- raw imagegen output·probe·schema 3 receipt를 보존하는 schema 4 provenance
- 실제 PNG IHDR, RGBA bytes, input/output hashes, 선택 attempt와 알고리즘 재계산 검증
- 종횡비 변경, 비크기 QA 오류, provenance 변조의 실패-폐쇄 테스트
- README, 안전 규칙, 공통 이미지 계약, image translate/QA/review/orchestrator 지침 동기화

## 최종 판정

- Plan/Design match: 99.5%
- 자동 테스트: 35/35 PASS
- Skill contract: `Issues: 0`
- Critical/Major/Minor actionable findings: 0/0/0

정규화는 QA 면제가 아니다. 적용 후에도 기존 alpha, edit region 밖 RGBA exact, 원문 제거,
한글 정확성, 원본 느낌, roundtrip 검증이 모두 통과해야 한다.
