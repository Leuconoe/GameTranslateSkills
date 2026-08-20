# GameTranslateSkills

게임 한글화(개인 번역 패치) 작업을 AI 에이전트(Codex, Claude Code 등)로 수행하기 위한
**범용 스킬 세트**입니다. 실전 Nintendo Switch 한글화 프로젝트들에서 검증된
노하우를 플랫폼 범용 구조로 추출했습니다.

> 전제: 사용자가 **합법적으로 보유한 게임의 개인 번역**만 다룹니다.
> 배포물은 원본 게임 데이터를 포함하지 않는 패치 형태여야 하며,
> 롬·콘솔 키·펌웨어의 취급/재배포를 지원하지 않습니다.

## 브랜치 기반 워크플로우

| # | 단계 | 스킬 | 비고 |
|---|------|------|------|
| 1 | 공통 분석 | `gt-analyze` | 추출·엔진·언어 슬롯·전체 inventory |
| 2–5 | 텍스트 브랜치 | `gt-text-analyze` → `gt-text-translate` → `gt-text-qa` → `gt-text-review` | 텍스트·폰트·아틀라스·에뮬레이터 준비 |
| 6–9 | 이미지 브랜치 | `gt-image-analyze` → `gt-image-translate` → `gt-image-qa` → `gt-image-review` | 이미지·atlas·스타일·비교 자료 |
| 10 | 통합 QA | `gt-qa` | 통합 빌드·세션 소유권·실행 시험 |
| 11 | 배포 파일 생성 | `gt-release` | 어댑터 계약에 따른 패치 패키징 |

전체 흐름은 오케스트레이터 스킬 **`game-translate`** 가 PDCA 루프로 지휘합니다.

게임 분석에서 이미지 번역 대상이 없거나 게임별로 이미지 번역이 적용되지 않는다고
증명되면 `image_scope=N/A`로 기록하고, 텍스트 브랜치 뒤 이미지 4단계를 생략해
QA와 릴리즈로 진행할 수 있습니다. 이때도 QA에서 기존 이미지 표시 이상 여부는 확인하고,
릴리스 노트에 `N/A` 근거를 남깁니다.

`text-review`와 `image-review`는 기본적으로 사용자 승인 단계가 아닙니다. 전체 검수
자료·handoff·에뮬레이터 준비 상태를 만들고 자동으로 다음 단계로 진행합니다.
프로젝트의 `text_review_policy` 또는 `image_review_policy`를 `user-gate`로 명시한 경우에만
해당 단계에서 사용자의 명시적 승인을 기다립니다.

텍스트 QA는 번역문뿐 아니라 전체 가시 코드포인트, 실제 폰트 consumer/fallback, glyph
좌표·metrics·아틀라스 padding·UV 원점, 재추출 왕복과 render probe를 통과해야 합니다.
폰트 아틀라스 문제는 [font-atlas-contract.md](common/font-atlas-contract.md)의 계약을
따릅니다.

Raster 이미지 번역은 [image-translation-contract.md](common/image-translation-contract.md)에
따라 API 키 없이 `$imagegen`의 내장 `image_gen.imagegen` edit만 사용합니다. 내장 도구가
노출하지 않는 모델이나 quality를 거짓으로 고정하지 않고, 같은 byte-exact reference와 exact
prompt로 최소 3개 독립 후보를 만든 뒤 기술·시각 QA를 모두 통과한 하나만 선택합니다. 첫 결과나
가장 그럴듯한 실패 후보를 채택하지 않으며 전부 실패하면 `hold-for-imagegen-review`로 멈춥니다.
Python/Pillow/OpenCV나 임의 스크립트로 글자를 그리거나 합성·resize·덮어쓰지 않습니다. 원문
완전 제거와 no-overlay, 원어의 서체 인상·색·외곽선·질감·재질·광원·자간/baseline·분위기·
좌표·canvas, 기본 전 픽셀 alpha exact(글자 alpha 자산은 선언한 edit region 안만 변경), 편집
영역 밖 decoded RGBA diff 0과 다중 후보 선택 receipt를 `IMAGE_GENERATION_MANIFEST.tsv`로
검증합니다.

NSW 기본 반복 시험은 Eden-MCP를 사용합니다. Eden-MCP/Ryubing-MCP 양쪽 inventory를
조회하고 타이틀당 공유 세션 하나만 재사용하며, Ryubing이나 교체 세션에는 구체적인 예외
사유가 필요합니다. 최종 QA는 MCP 결과로 대체하지 않습니다. 공식 사이트의 allowlist된
배포용 릴리즈를 별도로 받아 MCP 없이 직접 실행하고 URL·버전·바이너리·최종 build·활성 mod·
로그·스크린샷 해시를 `RELEASE_RUNTIME_QA.json`으로 검증해야 릴리스할 수 있습니다.
모든 격리 프로파일은 시스템 지역 `한국`/`대한민국`, 시스템 언어 `한국어`를 사용합니다.

Steam/PC는 MCP 세션 없이 설치 게임을 직접 실행하고, 현재 App ID/build ID·game EXE·active
patch·로그·화면 증거를 schema 2 영수증으로 검증합니다.

작업 루트는 플랫폼 원본이 직접 있는 실제 타이틀 폴더의 `_work/<프로젝트 ID>/`로 고정합니다.
NSW는 NSP/XCI와 16자리 Title ID, Steam/PC는 실제 게임 EXE와 `steam-<APP_ID>` 또는
`pc-<slug>`를 사용합니다. 원본 없는 임의 `title` 폴더를 새로 만들지 않습니다. NSW 양쪽
MCP는 프로젝트당 `50_test/eden/SESSION.json` 하나를 공유하고,
remote 세션을 정확한 ID로 종료하기 전에는 예외 교체 세션을 추가하지 않습니다.
`pending` 세션은 remote 상태를 재조회하기 전 재생성하지 않으며, 이전 `last_session_id`가
있는 새 세션은 `--previous-session-id` 증명 없이는 생성하지 않습니다.

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

Steam/PC 프로젝트 도구의 시작점은 다음과 같다.

```powershell
npm run project:new:steam -- --install-root '<게임 설치 폴더>' --game-executable '<게임.exe>' --game-name '<게임명>' --app-id '<Steam App ID>' --steam-manifest '<appmanifest_APPID.acf>'
npm run project:validate:steam -- --project-root '<게임 설치 폴더>\_work\steam-<APP_ID>'
npm run release:package:steam -- --project-root '<게임 설치 폴더>\_work\steam-<APP_ID>'
```

- 언어 방향: 일/영/중 → 한 (한글화 특화)
- 세션 재개: 프로젝트의 `PROJECT.md`를 읽고 마지막 단계부터 재개
- 안전 규칙: 모든 작업 전 `common/SAFETY.md` 필독 (프로젝트 경계 보호, allowlist 커밋 등)
- 완료 정리: `gt-project-cleanup` 또는 `npm run project:cleanup -- --project-root "<타이틀 루트>/_work/<프로젝트 ID>"`로 계획을 만들고, 승인된 exact allowlist와 plan SHA-256의 `--apply`는 파일을 아카이브로 이동함. 이어서 전체 재검토 보고서를 사용자에게 상세히 보고하고 멈추며, 이후 별도 승인에만 `--trash --trash-plan "<TRASH_PLAN.json>" --trash-plan-sha256 "<SHA-256>" --user-confirmed-trash` 사용. 파일은 복구 가능한 운영체제 휴지통으로만 이동하며 실패 시 영구 삭제하지 않음
- NSW MCP 세션 guard: `npm run project:qa-session -- --project-root "<타이틀 루트>/_work/<프로젝트 ID>" --action prepare ... --remote-inventory-checked --inventory-backend eden-mcp --inventory-backend ryubing-mcp`로 양쪽 목록을 확인하고 기존 타이틀 세션을 재사용. Steam/PC는 `direct-native`, session scope `none`이다.
- 최종 runtime guard: `npm run runtime:validate -- --project-root "<타이틀 루트>/_work/<프로젝트 ID>" --receipt "<프로젝트 루트>/50_test/RELEASE_RUNTIME_QA.json"`로 공식 배포 릴리즈의 non-MCP 직접 실행 증거를 검증
- 이미지 보존 guard: `npm run image:validate -- --project-root "<타이틀 루트>/_work/<프로젝트 ID>" --manifest "<프로젝트 루트>/30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv"`로 내장 imagegen best-of-3 provenance·원문 제거/no-overlay·원본 느낌·비덮어쓰기·좌표·alpha·보존 픽셀을 검증
- 작업장 루트 정리: `gt-workspace-cleanup` 또는 `npm run workspace:cleanup -- --workspace-root "<루트>" --report "<외부 보고서 경로>"`; 기본은 이동·삭제하지 않고, 적용 시에도 외부 아카이브·전체 재검토·사용자 상세 보고를 거친 뒤 별도 승인에만 운영체제 휴지통 이동
- 사전 경고: 모든 단계에서 `common/preflight-checks.md`를 읽고 배치·경로·언어 슬롯·review policy·폰트·세션·릴리스 계약의 불일치를 `WARN`/`BLOCKED`로 기록

## 구조

```
.codex-plugin/ Codex 플러그인 manifest
.agents/      Codex repo marketplace 정의
package.json  크로스플랫폼 npm 명령
skills/       Codex/Claude Code 공용 스킬 (파이프라인·정리·청결화 — 플랫폼 무관)
platforms/    플랫폼 어댑터: nsw·steam/pc(완전) / sfc·ps1·ps2(골격) / _template(양식)
engines/      엔진 모듈: unity / vn-common / lucasystem (플랫폼과 직교)
common/       SAFETY.md(안전 규칙) · preflight-checks.md(사전 경고 게이트) ·
              qa-session-rules.md(MCP 단일 세션 규칙) · release-runtime-contract.md(공식 배포 릴리즈 최종 QA) ·
              emucap-integration.md(선택적 smoke QA) · glossary-rules.md · project-structure.md · pipeline-contract.* ·
              font-atlas-contract.md · image-translation-contract.md · cleanup-contract.md · handoff-rules.md
setup/        도구 자동 설치 (tools.manifest.json + install-tools.mjs)
scripts/      프로젝트 생성·검증·스킬/폰트·imagegen 이미지 보존·공식 릴리즈 runtime 검증·Handoff 기반 정리 계획·아카이브·재검토·승인된 휴지통 이동·QA 세션 guard Node CLI
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
