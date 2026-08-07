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
| 4 | 이미지 번역 | `gt-image-translate` | `image_scope=required`일 때 Codex=imagegen 생성 / Claude=분석·보류; `N/A`면 생략 |
| 5 | 이미지 검수 | `gt-image-review` | `required`일 때 **사용자 승인 게이트**; `N/A`면 생략 |
| 6 | 전체 검수 | `gt-qa` | 폰트·빌드·실행 시험 |
| 7 | 배포 파일 생성 | `gt-release` | 델타/모드 패치 패키징 |

전체 흐름은 오케스트레이터 스킬 **`game-translate`** 가 PDCA 루프로 지휘합니다.

게임 분석에서 이미지 번역 대상이 없거나 게임별로 이미지 번역이 적용되지 않는다고
증명되면 `image_scope=N/A`로 기록하고, 텍스트 번역·검수 뒤 이미지 4·5단계를 생략해
QA와 릴리즈로 진행할 수 있습니다. 이때도 QA에서 기존 이미지 표시 이상 여부는 확인하고,
릴리스 노트에 `N/A` 근거를 남깁니다.

NSW 에뮬레이터 시험은 사용 가능한 경우 `eden-mcp` 경로를 권장합니다. Eden/Ryubing
격리 프로파일은 시스템 지역 `한국`/`대한민국`, 시스템 언어 `한국어`를 필수로 사용하고
실제 유효 설정과 실행 증거를 기록합니다.

작업 루트는 원본 `.nsp`/`.xci`가 직접 있는 실제 타이틀 폴더의
`_work/<베이스 Title ID>/`로 고정합니다. `_title`/`_titles` 아래에 임의의 `title` 폴더를
새로 만들지 않습니다. Eden QA는 프로젝트당 `50_test/eden/SESSION.json` 하나를 재사용하고,
remote 세션을 정확한 ID로 종료하기 전에는 새 세션을 추가하지 않습니다.

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

### 작업 도구 (선택)

```bash
npm run tools:install -- --tools-root <작업루트>/_tools
```

Node.js 18 이상과 npm이 필요하다. 이 명령은 스킬 설치가 아니라 플랫폼 어댑터가 요구하는 작업 도구를 준비할 때만 사용한다.

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
- 완료 정리: `npm run project:clean -- --project-root "<타이틀 루트>/_work/<프로젝트 ID>"`로 dry-run 후, 검토한 exact allowlist에만 `--apply` 사용
- Eden 세션 guard: `npm run project:qa-session -- --project-root "<타이틀 루트>/_work/<프로젝트 ID>" --action prepare ...`로 기존 세션을 먼저 조회·재사용
- 사전 경고: 모든 단계에서 `common/preflight-checks.md`를 읽고 배치·경로·언어 슬롯·승인·릴리스 계약의 불일치를 `WARN`/`BLOCKED`로 기록

## 구조

```
.codex-plugin/ Codex 플러그인 manifest
.agents/      Codex repo marketplace 정의
package.json  크로스플랫폼 npm 명령
skills/       Codex/Claude Code 공용 스킬 8종 (게이트·절차 — 플랫폼 무관)
platforms/    플랫폼 어댑터: nsw(완전) / sfc·ps1·ps2·steam(골격) / _template(양식)
engines/      엔진 모듈: unity / vn-common / lucasystem (플랫폼과 직교)
common/       SAFETY.md(안전 규칙) · preflight-checks.md(사전 경고 게이트) ·
              qa-session-rules.md(Eden 세션·중복 산출물 규칙) · emucap-integration.md(선택적 런타임 QA) · glossary-rules.md ·
              project-structure.md · handoff-rules.md
setup/        도구 자동 설치 (tools.manifest.json + install-tools.mjs)
scripts/      프로젝트 생성·검증·임시 파일 정리·QA 세션 guard Node CLI
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
