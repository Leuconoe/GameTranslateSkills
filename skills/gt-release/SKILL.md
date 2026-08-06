---
name: gt-release
description: "Stage 7 of game localization - package a verified patch using the platform adapter's exact release contract, with original-data/key exclusion, canonical filename checks, hash synchronization, and release-risk warnings. Use when creating release/배포 파일 생성/패치 배포."
---

# gt-release — 7단계: 배포용 파일 생성

검증 완료된 패치를 배포 가능한 패키지로 만든다.

> `$GT_HOME` = 지식 베이스 루트. Codex에서는 이 스킬이 설치된 플러그인 루트(상위에 `.codex-plugin/`, `skills/`, `common/`이 있는 디렉터리)로 해석하고, Claude Code 플러그인에서는 `${CLAUDE_PLUGIN_ROOT}`를 사용한다. 플러그인 외 수동 설치는 지원하지 않는다.
> 시작 전에 `$GT_HOME/common/preflight-checks.md`를 읽고 플랫폼 릴리스 계약·QA 승인·현재 canonical staging을 확인한다.
> 작업 중 문서와 실제의 괴리·막힌 지점·우회법을 발견하면 **즉시** 프로젝트 `HANDOFF.md`에 기록한다 (`$GT_HOME/common/handoff-rules.md`).

## 입력 조건

- `gt-qa` 완료 기준 전 항목 통과 (실행 시험 증거 존재)
- 플랫폼 어댑터 로드: `$GT_HOME/platforms/<platform>/release.md`
- `PROJECT.md`에 플랫폼 어댑터의 exact release path, filename, archive root, version ledger가 기록됨

## 절대 규칙

- **배포물에 원본 게임 데이터를 포함하지 않는다.** 패치는 변경분만 담는 형태여야 한다
  (NSW: LayeredFS 모드 폴더, SFC: IPS/BPS 델타 패치, PS1/PS2: xdelta 등 델타 패치,
  Steam: 교체 파일 모음 — 단 원본 자산의 단순 재배포가 되지 않는 범위).
- 콘솔 키·펌웨어·롬 파일은 어떤 형태로도 포함 금지.
- 공통 스킬은 게임명·날짜·버전이 붙은 파일명을 임의로 선택하지 않는다. 정확한 경로·파일명·
  ZIP 루트는 플랫폼 어댑터와 `PROJECT.md`의 계약을 그대로 사용한다.
- 플랫폼 계약이 없거나 문서끼리 다른 이름·폴더·루트를 가리키면 패키징하지 말고 `BLOCKED`와
  `HANDOFF.md` 기록을 남긴다.

## 절차

1. **패키징**: 플랫폼 어댑터의 배포 규격에 따라 패키지 생성.
   - 결정적 빌드: 같은 입력 → 바이트 동일 ZIP (타임스탬프 고정)
   - 파일명·출력 폴더·ZIP 루트: 플랫폼 어댑터의 canonical 규칙을 그대로 사용하고 수동 rename하지 않는다.
   - 패키지의 SHA-256 해시 기록
2. **설치 가이드 작성**: `INSTALL.md` — 대상 게임 버전/리전, 설치 경로, 적용 방법,
   제거 방법, 알려진 제한사항. 플랫폼별 설치법(에뮬레이터 모드 폴더/실기 적용)을
   사용자 눈높이로.
3. **릴리스 노트**: `RELEASE_NOTES.md` — 버전, 번역 범위(텍스트 %/이미지 %),
   시험 환경(에뮬레이터·펌웨어 버전), 미번역/보류 항목, 크레딧.
4. **최종 검증**: 패키지를 깨끗한 환경(새 모드 폴더)에 풀어 적용 → 실행 스모크 테스트
   1회 (타이틀 화면 + 인게임 진입). 통과 증거 캡처.
5. **아카이브**: 릴리스 패키지·해시·증거를 플랫폼 어댑터가 지정한 canonical 경로에 보관.
   `PROJECT.md`의 상태는 모든 필수 QA·런타임/하드웨어 정책·체크섬 동기화가 끝난 뒤에만
   `released`로 갱신한다. 버전은 canonical ZIP 파일명과 분리된 원장에서 관리한다.
6. **커밋(선택)**: 저장소 추적 대상(번역 TSV·용어집·문서)만 명시적 allowlist로 커밋
   (`common/SAFETY.md`의 git 규칙 — `git add .` 금지, 롬/키/추출물/빌드 산출물 제외).

## 산출물

| 파일 | 내용 |
|-----|------|
| `<adapter release path>/<canonical>.zip` | 배포 패키지 (+ SHA-256) |
| `<adapter release path>/INSTALL.md` | 설치 가이드 |
| `<adapter release path>/RELEASE_NOTES.md` | 릴리스 노트 |

## 완료 기준

- [ ] 패키지에 원본 게임 데이터·키 미포함 확인 (내용물 전수 목록 검사)
- [ ] 깨끗한 환경 적용 스모크 테스트 통과 (증거 보존)
- [ ] INSTALL.md / RELEASE_NOTES.md 완비, 해시 기록
- [ ] canonical 파일명·경로·ZIP root·파일 allowlist가 어댑터 계약과 exact 일치
- [ ] 런타임·하드웨어 상태와 `released` 판정이 서로 혼동되지 않음
