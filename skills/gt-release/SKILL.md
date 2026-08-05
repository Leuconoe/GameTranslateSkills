---
name: gt-release
description: "Stage 7 of game localization - package the verified patch into a distributable release (LayeredFS ZIP, IPS/BPS, file-replacement pack) with install guide and release notes. Use when creating release/배포 파일 생성/패치 배포."
---

# gt-release — 7단계: 배포용 파일 생성

검증 완료된 패치를 배포 가능한 패키지로 만든다.

> `$GT_HOME` = 지식 베이스 루트. Codex에서는 `install-codex.ps1`가 설정한 `GT_HOME`을 사용하고, Claude Code 플러그인에서는 `GT_HOME`이 없을 때 `${CLAUDE_PLUGIN_ROOT}`를 사용한다. 수동 설치는 `GT_HOME`을 직접 지정한다.
> 작업 중 문서와 실제의 괴리·막힌 지점·우회법을 발견하면 **즉시** 프로젝트 `HANDOFF.md`에 기록한다 (`$GT_HOME/common/handoff-rules.md`).

## 입력 조건

- `gt-qa` 완료 기준 전 항목 통과 (실행 시험 증거 존재)
- 플랫폼 어댑터 로드: `$GT_HOME/platforms/<platform>/release.md`

## 절대 규칙

- **배포물에 원본 게임 데이터를 포함하지 않는다.** 패치는 변경분만 담는 형태여야 한다
  (NSW: LayeredFS 모드 폴더, SFC: IPS/BPS 델타 패치, PS1/PS2: xdelta 등 델타 패치,
  Steam: 교체 파일 모음 — 단 원본 자산의 단순 재배포가 되지 않는 범위).
- 콘솔 키·펌웨어·롬 파일은 어떤 형태로도 포함 금지.

## 절차

1. **패키징**: 플랫폼 어댑터의 배포 규격에 따라 패키지 생성.
   - 결정적 빌드: 같은 입력 → 바이트 동일 ZIP (타임스탬프 고정)
   - 파일명 규약: `<게임명>_KO_v<버전>_<날짜>.zip`
   - 패키지의 SHA-256 해시 기록
2. **설치 가이드 작성**: `INSTALL.md` — 대상 게임 버전/리전, 설치 경로, 적용 방법,
   제거 방법, 알려진 제한사항. 플랫폼별 설치법(에뮬레이터 모드 폴더/실기 적용)을
   사용자 눈높이로.
3. **릴리스 노트**: `RELEASE_NOTES.md` — 버전, 번역 범위(텍스트 %/이미지 %),
   시험 환경(에뮬레이터·펌웨어 버전), 미번역/보류 항목, 크레딧.
4. **최종 검증**: 패키지를 깨끗한 환경(새 모드 폴더)에 풀어 적용 → 실행 스모크 테스트
   1회 (타이틀 화면 + 인게임 진입). 통과 증거 캡처.
5. **아카이브**: 릴리스 패키지·해시·증거를 `40_build/release/`에 보관.
   `PROJECT.md` 상태를 `released`로 갱신하고 완료 기준 체크리스트 기록.
6. **커밋(선택)**: 저장소 추적 대상(번역 TSV·용어집·문서)만 명시적 allowlist로 커밋
   (`common/SAFETY.md`의 git 규칙 — `git add .` 금지, 롬/키/추출물/빌드 산출물 제외).

## 산출물

| 파일 | 내용 |
|-----|------|
| `40_build/release/<패키지>.zip` | 배포 패키지 (+ SHA-256) |
| `40_build/release/INSTALL.md` | 설치 가이드 |
| `40_build/release/RELEASE_NOTES.md` | 릴리스 노트 |

## 완료 기준

- [ ] 패키지에 원본 게임 데이터·키 미포함 확인 (내용물 전수 목록 검사)
- [ ] 깨끗한 환경 적용 스모크 테스트 통과 (증거 보존)
- [ ] INSTALL.md / RELEASE_NOTES.md 완비, 해시 기록
