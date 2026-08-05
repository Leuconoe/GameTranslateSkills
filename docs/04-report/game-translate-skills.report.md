# game-translate-skills 완료 보고서 (PDCA: Report)

> 기간: 2026-08-04 ~ 2026-08-05 | 사이클: PDCA 1회차 완료 + iterate 1회

## 1. 목표와 결과

**목표**: 실전 NSW 한글화 작업장의 노하우를 플랫폼 범용(NSW/SFC/PS1/PS2/Steam)
Claude Code 스킬 세트로 추출·구조화하여 공유 가능하게 만든다.

**결과**: 스킬 8종 + 지식 베이스(플랫폼 어댑터 5종·엔진 모듈 3종·공통 규칙 3종) +
설치/도구 자동화 완성. 실제 대기 타이틀 드라이런으로 검증하고 결함 15건 수정.
스킬은 사용자 환경에 설치 완료(`~/.claude/skills/`, `GT_HOME`).

## 2. PDCA 요약

| 단계 | 내용 |
|-----|------|
| **Plan** | 원본 작업장 분석(도구 18종·타이틀 11개·가이드 158KB) → 사용자 결정 D1-D9 확정 (스킬 구조·배포 형태·도구 의존성·엔진/플랫폼 범위·검수 형태·언어) |
| **Design** | 3계층 아키텍처(스킬=절차 / 플랫폼 어댑터=추출·빌드·시험 / 엔진 모듈=포맷·폰트), 단계 간 산출물 계약, 검수 게이트 프로토콜, 에이전트별 분기 |
| **Do** | 병렬 증류 에이전트 2기(158KB 가이드+AGENTS.md → 일반화 이식) + 스킬 8종·골격 어댑터·setup/install 작성. 초기 커밋 `e61bfad` (33파일, 2,416줄) |
| **Check** | 정적 검증(frontmatter 8/8·참조 무결성·유출 0건) + **실전 드라이런**: LucaSystem 대기 타이틀로 원본 가이드 차단 상태에서 1단계 실측 → 결함 15건 발견 |
| **Act** | 15/15 수정 (`c8a25c2`) — 추출 실측 명령 반영, LucaSystem 복구 절차, 스크립트 재작성, 문서 모순 해소. 2차 드라이런으로 D4 해제 실증 진행 |

## 3. 최종 산출물

```
skills/          game-translate(오케스트레이터) + gt-analyze/text-translate/text-review/
                 image-translate/image-review/qa/release (7단계)
platforms/       nsw(완전: PLATFORM+extract+build-test+release) / sfc·ps1·ps2·steam(골격) / _template
engines/         unity(TMP·SDF 폰트) / vn-common(GARbro·msg-tool·pfs-rs) / lucasystem(LuckSystem)
common/          SAFETY.md / glossary-rules.md(80행 배치 canonical) / project-structure.md
setup/           tools.manifest.json + Install-Tools.ps1 (GitHub 최신 릴리스 자동 설치)
scripts/         New-TranslationProject.ps1(-TitlesRoot, 재귀 중복검사) / Validate-TranslationProjects.ps1
install.ps1      스킬→~/.claude/skills, 지식베이스→GT_HOME 분리 설치
```

## 4. 핵심 교훈 (Lessons Learned)

1. **드라이런이 결정적이었다** — 정적 검증(참조·frontmatter)은 전부 통과했지만, 실제
   타이틀로 문서만 보고 진행하자 "행복 경로만 문서화된" 결함 15건이 즉시 드러났다.
   특히 키 지정(`-k`)·NCA 파티션 추출처럼 작업자에겐 당연한 암묵지가 누락돼 있었다.
2. **소스 문서 간 모순은 이식 과정에서 표면화된다** — 배치 크기(40행 vs 80행)처럼
   서로 다른 가이드에서 온 규칙은 canonical 선언으로 단일화해야 한다.
3. **안전 규칙은 이식 품질이 좋았다** — AGENTS.md에서 일반화한 SAFETY.md는 드라이런
   에이전트가 "그대로 따라도 사고가 나지 않는" 수준으로 평가.
4. **검증 스크립트 자체의 버그 주의** — 1차 frontmatter 검사에서 오탐 16건은 검사
   스크립트의 PowerShell 파라미터 비호환이 원인이었다.

## 5. 2차 드라이런 (D4 해제 실증) — 성공

수정된 문서 절차만으로 1차 차단 지점부터 완주 (상세 검증 기록은 로컬 보관 — git 미추적):

- **진단**: 프리셋의 특정 opcode가 해당 Switch 빌드에 없어 인덱스가 +1 밀림 —
  데이터 스크립트 파일명↔opcode 이름 대조로 특정
- **보정**: 프로젝트 사본 프리셋으로 대사 MESSAGE 5,991행 정상 디코드 (17개 시나리오 전체)
- **왕복 검증**: 무수정 import 재생성 PAK이 원본과 **바이트 동일**
- **산출물**: 번역 manifest TSV 5,885행 (전체, 해시 기록) — gt-analyze 1단계 완주 판정
- 신규 결함 3건(중간 1·낮음 2) 발견 → 즉시 수정 완료 (OPCODE 보정 위치 특정법,
  대사 외 문자열 내장 opcode 처리, 이미지 전수 조사의 1단계/4단계 경계)

**결론: 스킬 문서만으로 신규 작업자가 1단계를 완주할 수 있음이 실증됨.**

## 6. 잔여 과제 (다음 사이클 후보)

- 골격 어댑터(SFC/PS1/PS2/Steam) 첫 실전 작업 시 보강 (D7 결정에 따른 의도적 이연)
- 2~7단계(번역~배포)의 실전 드라이런 (1차는 1단계만 검증)
- 드라이런 검증 기록(실제 타이틀 ID·해시 포함)은 개인정보 보호를 위해 git에서 제외
  (`docs/03-analysis/dryrun-*.md` gitignore) — 로컬에만 보관
- 도구 매니페스트의 manual 항목(GARbro·msg-tool·pfs-rs·xdelta3) 자동화 검토
