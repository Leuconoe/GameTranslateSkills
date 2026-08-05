# GameTranslateSkills

게임 한글화(개인 번역 패치) 작업을 AI 에이전트(Codex, Claude Code 등)로 수행하기 위한
**범용 스킬 세트**입니다. 실전 Nintendo Switch 한글화 프로젝트들에서 검증된
노하우를 플랫폼 범용 구조로 추출했습니다.

> 전제: 사용자가 **합법적으로 보유한 게임의 개인 번역**만 다룹니다.
> 배포물은 원본 게임 데이터를 포함하지 않는 패치 형태여야 하며,
> 롬·콘솔 키·펌웨어의 취급/재배포를 지원하지 않습니다.

## 7단계 워크플로우

| # | 단계 | 스킬 | 비고 |
|---|------|------|------|
| 1 | 파일 분석 | `gt-analyze` | 추출·엔진 식별·인벤토리 |
| 2 | 텍스트 번역 | `gt-text-translate` | 배치·용어집·구조 검증 |
| 3 | 텍스트 검수 | `gt-text-review` | **사용자 승인 게이트** |
| 4 | 이미지 번역 | `gt-image-translate` | Codex=imagegen 생성 / Claude=분석·보류 |
| 5 | 이미지 검수 | `gt-image-review` | **사용자 승인 게이트** |
| 6 | 전체 검수 | `gt-qa` | 폰트·빌드·실행 시험 |
| 7 | 배포 파일 생성 | `gt-release` | 델타/모드 패치 패키징 |

전체 흐름은 오케스트레이터 스킬 **`game-translate`** 가 PDCA 루프로 지휘합니다.

## 설치

### 플러그인 (권장)

Claude Code에서:

```
/plugin marketplace add Leuconoe/GameTranslateSkills
/plugin install game-translate@game-translate-skills
```

### Codex CLI / desktop

Codex는 표준 플러그인 manifest와 마켓플레이스를 통해 설치한다. PowerShell 설치기는 필요 없다.

Codex CLI에서 마켓플레이스를 한 번 등록한다:

```bash
codex plugin marketplace add Leuconoe/GameTranslateSkills
```

그 다음 Codex에서 `/plugins`를 입력해 `GameTranslateSkills` 마켓플레이스의
`game-translate` 플러그인을 설치·활성화하고 새 세션을 시작한다. Codex의 설치 메뉴는
`/plugin` 단수가 아니라 `/plugins`이며, 일반적인 `/install` 명령은 사용하지 않는다.

Codex 데스크톱 앱에서는 Plugins 화면에서 같은 플러그인을 검색해 설치할 수 있다.

### Claude Code 수동 설치 (Windows)

```powershell
git clone https://github.com/Leuconoe/GameTranslateSkills.git
cd GameTranslateSkills
.\install.ps1          # 스킬 → ~/.claude/skills, 지식 베이스 → GT_HOME
```

### 도구 설치 (공통)

```powershell
pwsh setup\Install-Tools.ps1 -ToolsRoot <작업루트>\_tools
```

## 사용

새 Codex 세션에서:

```
$game-translate 스킬로 <게임명> 한글화를 시작해줘. 플랫폼은 nsw, 작업 루트는 D:\MyWork
```

새 Claude Code 세션에서는:

```
game-translate 스킬로 <게임명> 한글화를 시작해줘. 플랫폼은 nsw, 작업 루트는 D:\MyWork
```

- 언어 방향: 일/영/중 → 한 (한글화 특화)
- 세션 재개: 프로젝트의 `PROJECT.md`를 읽고 마지막 단계부터 재개
- 안전 규칙: 모든 작업 전 `common/SAFETY.md` 필독 (프로젝트 경계 보호, allowlist 커밋 등)

## 구조

```
skills/       Codex/Claude Code 공용 스킬 8종 (게이트·절차 — 플랫폼 무관)
platforms/    플랫폼 어댑터: nsw(완전) / sfc·ps1·ps2·steam(골격) / _template(양식)
engines/      엔진 모듈: unity / vn-common / lucasystem (플랫폼과 직교)
common/       SAFETY.md(안전 규칙) · glossary-rules.md(번역 규칙) ·
              project-structure.md · handoff-rules.md(시행착오 기록·개선 루프)
setup/        도구 자동 설치 (tools.manifest.json + Install-Tools.ps1)
scripts/      프로젝트 생성·검증 스크립트
docs/         PDCA 문서 (plan / design / analysis / report)
```

## 스킬 개선에 기여하기 (Handoff)

이 스킬 세트는 실전 사용에서 발견된 갭으로 개선됩니다 (릴리스 전 실제 타이틀 드라이런
2회로 결함 18건을 발견·수정한 구조를 그대로 제도화했습니다):

1. 작업 중 문서와 실제가 다르거나 막힌 지점을 뚫으면 프로젝트 `HANDOFF.md`에 **즉시 기록**
2. 프로젝트 완료 시 오케스트레이터가 기록을 일반화(게임 정보 제거)해 지식 베이스 수정 제안
3. 수정 diff를 이 저장소에 이슈/PR로 제출 — 골격 어댑터(SFC/PS1/PS2/Steam)의
   `⚠️ 미검증` 항목은 이 루프로만 해제됩니다

형식과 절차: `common/handoff-rules.md`

## 플랫폼 확장

`platforms/_template/PLATFORM.md` 양식을 채워 새 어댑터를 만들면 스킬 수정 없이
새 플랫폼을 지원할 수 있습니다.

## 출처

실전 Nintendo Switch 한글화 프로젝트들의 작업 지침·번역 워크플로우·안전 규칙에서
특정 게임 정보를 제거하고 패턴·교훈만 일반화하여 이식했습니다.
