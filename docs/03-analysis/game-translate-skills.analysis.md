# game-translate-skills Gap Analysis (PDCA: Check)

> 작성일: 2026-08-04 | 대상: Design v1.0 대비 구현 결과

## 1. 검증 결과

| 항목 | 결과 |
|-----|------|
| 스킬 8종 frontmatter (name/description) | ✅ 8/8 통과 |
| 스킬 → 지식 베이스 상호 참조 무결성 (`$GT_HOME/...` 6개 경로) | ✅ 전부 존재 |
| 게임 특정 정보 유출 (실제 게임명·16자리 Title ID 스캔) | ✅ 0건 |
| Design §1 레이아웃 대비 파일 존재 | ✅ 전 항목 (Codex/Claude plugin manifests, skills 8, platforms 4+5, engines 3, common 3, setup 2, scripts 2, README) |

## 2. 노하우 이식 커버리지

| 소스 | 이식 위치 | 상태 |
|-----|----------|------|
| DETAILED_WORK_INSTRUCTIONS_KO.md §1-3 | common/project-structure.md, platforms/nsw/PLATFORM.md | ✅ |
| §4-5 (추출·언어슬롯) | platforms/nsw/extract.md | ✅ |
| §6-7 (번역·용어집) | common/glossary-rules.md | ✅ |
| §8-9 (폰트·이미지) | engines/unity, vn-common, lucasystem | ✅ |
| §11-15 (빌드·시험·복구·검증·팁) | platforms/nsw/build-test.md | ✅ (§15 팁 45개 성격별 분배) |
| §11·16 (산출물·완료 기준) | platforms/nsw/release.md | ✅ |
| CODEX_TRANSLATION_WORKFLOW_KO.md 전 13절 | common/glossary-rules.md | ✅ (수치 기준 보존: 80행/48,000자/heartbeat) |
| AGENTS.md 안전 규칙 | common/SAFETY.md | ✅ (8개 섹션 일반화) |

## 3. 잔여 갭 (Act 후보)

| # | 갭 | 심각도 | 조치 방안 |
|---|----|-------|----------|
| G1 | 실전 드라이런 미수행 — 실제 타이틀로 스킬만 갖고 1단계부터 진행하는 검증 없음 | 중 | `_waitng` 타이틀 1개로 gt-analyze 드라이런 |
| G2 | 플러그인 설치·새 세션 반영 확인 필요 | 낮 | Codex `/plugins` 또는 Claude `/plugin`에서 설치 후 새 세션으로 확인 |
| G3 | 매뉴얼 번역(소스 §10)이 별도 스킬/절차로 분리되지 않음 | 낮 | gt-image-translate 범위로 흡수됨 — 필요 시 후속 |
| G4 | SFC/PS1/PS2 골격 어댑터의 후보 도구가 미검증 (⚠️ 표시로 명시됨) | 낮(의도됨) | 해당 플랫폼 첫 작업 시 보강 (D7 결정) |
| G5 | 저장소 미커밋 | 낮 | 사용자 승인 후 초기 커밋 |

## 4. 판정 (1차)

Design 대비 구조·내용 매치율 **~95%** (G1-G2는 검증 절차, G3-G5는 의도된 후속).
핵심 산출물은 완성 — 사용자 검수(iterate 여부 결정) 단계로 진행.

## 5. Iterate 1회차 (2026-08-04)

- **G1 드라이런 수행**: LucaSystem 엔진 대기 타이틀로 원본 가이드 차단 상태에서
  프로젝트 생성→gt-analyze 1단계 실측 → 결함 15건 발견 (상세 기록은 로컬 보관 — git 미추적)
- **결함 15/15 수정 완료**:
  - 높음 4: 스캐폴드 경로 지시(D1), nstool 키·티켓 규약(D2), 베이스 NSP→NCA→RomFS
    절차(D3), LucaSystem 프리셋 검증·OPCODE 보정·GUI 예외 절차(D4)
  - 중간 7: 배치 크기 모순 통일(D5, 80행 canonical), 대기 폴더 규약(D6), 스크립트
    here-string 버그·중복검사 강화·`-TitlesRoot` 추가(D7·D8), 레지스트리 스키마(D10),
    도구 경로 실배치 일치(D11), 템플릿 외부 참조 제거(D12)
  - 낮음 4: 원본 위치 모순(D9), 폰트 규칙(D13), 표준 트리 보완(D14), 실행 위치 주석(D15)
- **재검증**: 스크립트 구문 오류 0, 깨진 참조 0, 게임정보 유출 0
  (ENGINE.md의 게임명 표기 2건은 LuckSystem 도구가 공식 문서에 명시한 공개 프리셋 명칭 — 유출 아님)
- **잔여**: 재드라이런으로 D4 해제(OPCODE 보정→대사 TSV 생성) 실증 권장, 플러그인 설치 후 새 세션 스모크 테스트 권장(G2)
