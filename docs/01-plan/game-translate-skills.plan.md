# game-translate-skills Plan (PDCA: Plan)

> 작성일: 2026-08-04 | 상태: **Approved v1.0** (D1-D9 사용자 확정) | 다음 단계: Design

## Executive Summary

실전 NSW 한글화 작업장에서 검증된 게임 한글화 노하우(91KB 상세 지침 + Codex 워크플로우 + 안전 규칙)를
**플랫폼 범용 Claude Code 스킬 세트**로 추출·구조화하여 공유 가능한 형태로 만든다.

## Context Anchor

- **WHY**: 게임 번역 노하우가 기존 작업장 문서에 산재 — 재사용/공유하려면 스킬로 표준화 필요
- **WHO**: 게임 한글화 작업자 (Claude Code / Codex 등 AI 에이전트 활용)
- **RISK**: 플랫폼별 차이(NSW/SFC/PS1/PS2/Steam)를 과도하게 일반화하면 실전성 상실
- **SUCCESS**: 새 게임 프로젝트에서 스킬만으로 7단계 전체 진행 가능
- **SCOPE**: 스킬 작성 + 도구 자동 설치 + 플랫폼 어댑터 (게임 데이터 자체는 미포함)

## 1. 확정된 설계 결정 (사용자 확인 완료)

| # | 결정 사항 | 선택 |
|---|----------|------|
| D1 | 스킬 분할 | **오케스트레이터 + 7단계별 스킬** |
| D2 | 배포 형태 | ~~순수 skills/ 폴더 + install.ps1~~ → **Claude Code 플러그인** (2026-08-05 공개 배포 확정으로 변경, install.ps1은 수동 설치용 병행) |
| D3 | 도구 의존성 | **도구 자동 설치 스크립트 포함** |
| D4 | 엔진 범위 | **Unity + VN엔진(GARbro/msg-tool/pfs-rs) + LucaSystem 모두** |
| D5 | 플랫폼 | **범용 설계** — NSW뿐 아니라 SFC, PS1, PS2, Steam 호환 구조 |
| D6 | 검수 산출물 | **TSV/스프레드시트** (원문│번역│비고), 이미지는 before/after 경로 목록 |
| D7 | 타 플랫폼 깊이 | **골격 + 확장 가이드만** — 1차는 NSW 어댑터만 완전 이식 |
| D8 | 문서 언어 | **한국어** (frontmatter description은 영어 병기) |
| D9 | 언어 방향 | **일/영/중 → 한 고정** — 한글화 특화 품질 규칙 유지 |

## 2. 핵심 워크플로우 (사용자 정의 7단계)

1. **파일 분석** — 롬/패키지 추출, 엔진 식별, 텍스트/이미지/폰트 인벤토리
2. **텍스트 번역** — 배치 번역, 용어집 누적, 말투 일관성, 구조 검증
3. **사용자 텍스트 검수** — 검수 게이트 (사용자 승인 전 다음 단계 진행 금지)
4. **이미지 번역** — Codex: imagegen 스킬로 생성 / Claude: 분석만 하고 보류
5. **사용자 이미지 검수** — 검수 게이트
6. **전체 검수** — 구조 무결성, 빌드, 에뮬레이터/실행 시험
7. **배포용 파일 생성** — 패치 패키징 (NSW: LayeredFS ZIP 등 플랫폼별 산출물)

## 3. 아키텍처: 3계층 구조

```
skills/
├── game-translate/          ← 오케스트레이터: 7단계 PDCA 루프 지휘
├── gt-analyze/              ← 1단계
├── gt-text-translate/       ← 2단계
├── gt-text-review/          ← 3단계 (사용자 게이트)
├── gt-image-translate/      ← 4단계 (에이전트별 분기: codex=imagegen, claude=분석·보류)
├── gt-image-review/         ← 5단계 (사용자 게이트)
├── gt-qa/                   ← 6단계
└── gt-release/              ← 7단계
platforms/                   ← 플랫폼 어댑터 (스킬이 참조)
├── nsw/                     ← 1차: 실전 NSW 노하우 전체 이식 (완전)
├── sfc/  ps1/  ps2/  steam/ ← 골격 + 확장 가이드 (범위는 아래 Q 참조)
engines/                     ← 엔진 모듈 (스킬이 참조)
├── unity/                   ← UABEA, Il2CppDumper, TMP/SDF 한글 폰트
├── vn-common/               ← GARbro, msg-tool, pfs-rs
└── lucasystem/              ← LuckSystem
setup/                       ← 도구 자동 설치 스크립트 (D3)
install.ps1                  ← 스킬 설치 (~/.claude/skills 복사)
```

- **스킬 계층**: 플랫폼 무관 절차 (무엇을, 어떤 순서로, 어떤 게이트로)
- **플랫폼 어댑터**: 추출/빌드/실행시험/배포 방식 (nstool·LayeredFS·Eden은 NSW 어댑터 소속)
- **엔진 모듈**: 텍스트/이미지/폰트 포맷 처리 (플랫폼과 직교 — Unity는 NSW에도 Steam에도 존재)

## 4. 노하우 소스 → 스킬 매핑

| 소스 (원본 작업장) | 대상 |
|--------------|------|
| `DETAILED_WORK_INSTRUCTIONS_KO.md` §1-3 (격리 원칙, 폴더 구조, 게임 등록) | game-translate + gt-analyze |
| §4-5 (추출·엔진분석, 언어 슬롯) | gt-analyze + platforms/nsw |
| §6-7 (텍스트 번역, 용어집) | gt-text-translate |
| §8 (폰트) | engines/unity 등 엔진 모듈 |
| §9-10 (이미지·아틀라스, 매뉴얼) | gt-image-translate |
| §11-12 (빌드, 실기 시험) | gt-qa + platforms/nsw |
| §13-16 (실패 복구, 검증, 재발 방지, 완료 기준) | gt-qa + 각 스킬 분산 |
| `CODEX_TRANSLATION_WORKFLOW_KO.md` (배치, 2차 검수, PDCA 반복) | gt-text-translate + gt-text-review |
| `AGENTS.md` 안전 규칙 (타이틀 경계, 정션 보호, 원자적 주입) | 공통 안전 규칙 문서로 추출 |
| `_tools/*.ps1` (New-TranslationProject, Validate 등) | scripts/로 범용화 이식 |

## 5. Success Criteria

- [ ] 7단계 각각 단독 실행 가능 + 오케스트레이터로 연속 실행 가능
- [ ] NSW 신규 타이틀에 스킬만으로 착수 가능 (기존 91KB 문서 없이)
- [ ] 사용자 검수 게이트(3·5단계)가 명시적으로 작업을 멈추고 승인을 기다림
- [ ] Codex/Claude 에이전트별 이미지 처리 분기가 SKILL.md에 명문화
- [ ] 다른 PC에서 install.ps1 + setup으로 환경 재현 가능
- [ ] 플랫폼 어댑터 추가만으로 신규 플랫폼(SFC 등) 확장 가능한 구조 검증

## 6. Risks and Mitigation

| 리스크 | 대응 |
|-------|------|
| 과도한 일반화로 NSW 실전성 상실 | NSW 어댑터를 1차 기준 구현으로 삼고 스킬 본문은 어댑터 참조로 위임 |
| 91KB 지침의 게임 특정 정보(타이틀ID 등) 유출 | 이식 시 특정 게임 정보 제거, 패턴만 추출 |
| 도구 라이선스/재배포 문제 | setup 스크립트는 공식 릴리스 URL에서 다운로드만 수행, 바이너리 미포함 |
| 저작권 민감성 | 스킬은 사용자 보유 게임의 개인 번역 절차만 다룸. 롬/키/추출물 취급 금지 규칙 포함 |

## 7. Next Steps

1. 잔여 질문 확정 (검수 게이트 산출물 형태, 타 플랫폼 1차 깊이)
2. Design: 각 스킬 SKILL.md 목차 + 어댑터 인터페이스 정의
3. Do: NSW 어댑터부터 이식 → 스킬 본문 작성 → setup/install 스크립트
4. Check: 기존 NSW 타이틀 1개로 스킬 기반 드라이런 검증
5. Act: 갭 보완 후 v1 태깅

## Version History

- v0.1 (2026-08-04): 초안 — 원본 작업장 분석 + 7단계 프로세스 반영
- v0.2 (2026-08-04): D1-D5 사용자 결정 반영, 플랫폼 범용화 요구 반영
- v1.1 (2026-08-05): D2 변경(플러그인 전환), handoff 개선 루프 추가, 출처 경로 일반화
