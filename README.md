# GameTranslateSkills

게임 한글화(개인 번역 패치) 작업을 AI 에이전트(Codex, Claude Code 등)로 수행하기 위한
**범용 스킬 세트**입니다. 실전 Nintendo Switch 한글화 프로젝트들에서 검증된
노하우를 플랫폼 범용 구조로 추출했습니다.

> 전제: 사용자가 **합법적으로 보유한 게임의 개인 번역**만 다룹니다.
> 배포물은 원본 게임 데이터를 포함하지 않는 패치 형태여야 하며,
> 롬·콘솔 키·펌웨어의 취급/재배포를 지원하지 않습니다.

## 핵심 원칙

| 영역 | 내용 |
|---|---|
| **공용 도구 (최상위)** | 반복 작업(imagegen·Eden·릴리스·일괄 번역·엔진 포맷·폰트)은 이 저장소의 공용 도구로만 한다. 타이틀마다 새로 만들거나 다른 타이틀에서 복사하지 않고, 모자라면 공용 도구를 고쳐 테스트와 함께 커밋한다 (`skills/game-translate` 최상위 규칙) |
| 품질 | 1차 번역 → 구조 검증 → **im-not-ai(`humanize-korean`) 윤문(기본)** → 원문부터 다시 읽는 독립 2차 검수. 의미·말투·고유명사·태그·개행은 보존 |
| 속도·토큰 | 번역 전 말투표·보류 기준·추출 범위를 고정하고, 이어하기는 `RESUME.md`와 원문 slice만 읽음. 세그먼트 TM, 시리즈 공유 TM, 파일 브리프(`briefs/`), 짧은 보고, 무거운 단계 동시 2개 이하 (`common/harness-performance.md`) |
| 반복 방지 | 하네스가 같은 작업 재실행·같은 내용 사본·active 중복을 막음(`--reuse-check`). 빌드는 한 벌, 시험은 canonical ZIP을 hash로 참조 |
| 작업 경계 | 모든 산출물은 `<타이틀 루트>/_work/<프로젝트 ID>/` 안. 워크스페이스 루트 파일·비슷한 이름의 최상위 폴더·공용 임시 폴더 금지, 타이틀 폴더는 Title ID로 찾아 재사용 |
| 상태 폴더 | `_titles/_waitng`(대기) → **`_working`(작업 중, 시작·재개 시 이동)** → `_complete`(릴리스 완료) / `_hold`(보류). Steam/PC 설치 폴더는 옮기지 않음 |
| 안전 | 확인할 수 없으면 `WARN`/`BLOCKED`로 멈춤(fail-closed). 정리는 계획 → 승인 → 복구 가능한 휴지통 |
| 릴리스 | `<타이틀 루트>/_release/<한국어 제목> - <Title ID>.zip` + 7항목 `RELEASE_NOTES.md`(`npm run release:notes`). 4GiB 이상 파일은 Zip64와 exFAT 안내가 자동으로 붙음 |

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
Python/Pillow/OpenCV나 임의 스크립트로 글자를 그리거나 덮어쓰지 않습니다. 단, PNG/RGBA8
후보가 동일 종횡비를 유지하고 validator의 유일한 문제가 canvas 크기일 때는 provenance를 보존하는
내장 Node 정규화 CLI로 새 파생 후보를 만들 수 있습니다. 또한 `edit-region-only` 자산에서
imagegen이 alpha를 잃은 경우에는 같은 한글 후보로 alpha mask를 3회 독립 생성하고 검증된 mask를
편집 영역에만 합성할 수 있습니다. 원문
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

### NSW 명령 요약

```powershell
# 프로젝트 생성 (타이틀 루트 = NSP/XCI가 직접 있는 폴더, 작업 시작 전 _titles\_working\으로 이동)
npm run project:new -- --titles-root '<작업루트>\_titles' --game-folder '_working\<타이틀 폴더>' --game-name '<게임명>' --korean-title '<한국어 제목>' --title-id '<16자리 Title ID>'
# 작업 전 하네스 초기화 / 같은 작업 재실행 전 재사용 조회 (REUSE면 다시 만들지 않음)
npm run project:artifacts -- --project-root '<타이틀 루트>\_work\<TITLE_ID>' --init
npm run project:artifacts -- --project-root '<타이틀 루트>\_work\<TITLE_ID>' --reuse-check --producer '<도구>' --reproduce-command '<명령>'
# 빌드 생성·패치 생성 → <타이틀 루트>\_release\<한국어 제목> - <TITLE_ID>.zip
npm run release:package:nsw -- --project-root '<타이틀 루트>\_work\<TITLE_ID>'
npm run release:validate:nsw -- --project-root '<타이틀 루트>\_work\<TITLE_ID>'
```

릴리스 산출물은 타이틀 루트의 `_release\`(`_work\` 옆)에 둔다(ZIP, `RELEASE_NOTES.md`, `INSTALL.md`, `SHA256SUMS.txt`,
`RELEASE_PACKAGE.json`, `screenshots\`, `superseded\`). ZIP 이름은 기본 `<한국어 제목> - <BASE_TITLE_ID>.zip`이다(예: `지뢰계 마법소녀 사쿠라 - 01006D202294E000.zip`). 한국어 제목은 `--korean-title` → 타이틀 루트의 빈 한국어 라벨 폴더(`<타이틀 루트>/<한국어 제목>/`, `_work` 옆) → `PROJECT.md`의 `- Korean title:` 순서로 정하고, 어느 것도 없으면 패키징하지 않는다(fail closed). `[Title ID]` 표기·Windows 금지 문자(`\ / : * ? " < > |`)·제어 문자는 지우고 `~ ∬ ,` 같은 나머지 문자는 그대로 둔다. Title ID 접미사는 필수이며 검증기가 프로젝트 Title ID와 대조한다. 예전 `<BASE_TITLE_ID>.zip`은 `--legacy-name`을 명시할 때만 쓴다.
내용이 같은 기존 ZIP은 새 이름으로 바뀌고, 내용이 다르면 `--replace` 없이는 교체하지 않으며, 교체된 ZIP은
`_release\superseded\`로 옮겨 보존한다. 예전 `_work\<TITLE_ID>\60_release\`·`_work\<TITLE_ID>\40_build\releases\`는
검증기가 경고와 함께 읽기만 하고, 다음 릴리스 때 `_release\`로 옮긴다. `_release\screenshots\`에는 `50_test` 증거에서
복사한 대표 캡처 4~6장(`NN_<what>.png`: 타이틀, 첫 한국어 대사, 메뉴/옵션, 저장·불러오기, 한국어화 로고)을 둔다.

### 공용 도구 요약

```powershell
# 일괄 번역 (엔진 어댑터: engines/<engine>/tools/)
python -I scripts/bulk/bulk_tool.py <export|next|dupfill|check|seg-export|seg-build|merge|import-held|resume-md> ...
# 릴리스 노트 (7항목, 출시일 *, exFAT 자동)
npm run release:notes -- --out '<타이틀 루트>\_release\RELEASE_NOTES.md' --title '<한국어 제목>' --game-date YYYY-MM-DD --patch-version v0.0.1 --support-version '<버전>' --lang-method '<방법>' --zip '<ZIP>'
# Codex imagegen 편집 1회 (대괄호 없는 임시 폴더, 영역 합성, 출처 기록)
npm run image:codex -- --src '<crop.png>' --out '<out.png>' --ja '<원문>' --ko '<한국어>' --receipt '<IMAGEGEN_RECEIPT.jsonl>'
# Eden MCP (eden-mcp venv python): broker / call / session / step / record / route / publish
python scripts/eden/eden_tools.py publish <TID> <session> <후보 폴더> <PREFIX> <tag> <retire 폴더>
# 타이틀 이동·현황·RomFS 검증
npm run title:move -- ... ; npm run project:status -- ... ; npm run nsw:romfs-verify -- ...
```

서브에이전트는 `briefs/<템플릿>.md` + 변수만 넘겨 띄운다(긴 브리프를 새로 쓰지 않는다).

### Steam/PC 명령 요약

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
- imagegen 크기 정규화: 먼저 `npm run image:normalize-size -- --project-root "<프로젝트 루트>" --manifest "<프로젝트 루트>/30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv" --stable-key "<키>"`로 dry-run하고, 적격일 때만 같은 명령에 `--apply`를 추가합니다. PNG/RGBA8·동일 종횡비·크기 외 validator 오류 0건만 허용하며 schema 4 receipt를 만든 뒤 `image:validate`를 다시 실행해야 합니다.
- imagegen alpha mask 합성: 같은 한글 후보와 exact mask prompt로 3–4개 mask를 생성해 schema 1 mask receipt를 작성한 뒤 `npm run image:compose-alpha -- --project-root "<프로젝트 루트>" --manifest "<프로젝트 루트>/30_translation/image_translation/IMAGE_GENERATION_MANIFEST.tsv" --stable-key "<키>" --mask-receipt "30_translation/image_translation/receipts/alpha_masks/<키>.json"`로 dry-run합니다. 적격일 때만 `--apply`를 추가하며 schema 5 receipt 생성 후 `image:validate`를 다시 실행합니다.
- 작업장 루트 정리: `gt-workspace-cleanup` 또는 `npm run workspace:cleanup -- --workspace-root "<루트>" --report "<외부 보고서 경로>"`; 기본은 이동·삭제하지 않고, 적용 시에도 외부 아카이브·전체 재검토·사용자 상세 보고를 거친 뒤 별도 승인에만 운영체제 휴지통 이동
- 사전 경고: 모든 단계에서 `common/preflight-checks.md`를 읽고 배치·경로·언어 슬롯·review policy·폰트·세션·릴리스 계약의 불일치를 `WARN`/`BLOCKED`로 기록

## 구조

```
.claude-plugin/ Claude Code 플러그인·마켓플레이스 manifest
.codex-plugin/ Codex 플러그인 manifest
.agents/      Codex repo marketplace 정의
package.json  크로스플랫폼 npm 명령
skills/       Codex/Claude Code 공용 스킬 (파이프라인·정리·청결화 — 플랫폼 무관)
platforms/    플랫폼 어댑터: nsw·steam/pc(완전) / sfc·ps1·ps2(골격) / _template(양식)
engines/      엔진 모듈: unity / vn-common / lucasystem / giga-adv / artemis / m2-psb / shin (플랫폼과 직교).
              공용 엔진 도구는 engines/<engine>/tools/ (unity, m2-psb)
briefs/       서브에이전트 브리프 템플릿 (번역 이어하기·폰트·리뷰·이미지·Eden QA·릴리스)
common/       SAFETY.md(안전 규칙) · preflight-checks.md(사전 경고 게이트) ·
              qa-session-rules.md(MCP 단일 세션 규칙) · release-runtime-contract.md(공식 배포 릴리즈 최종 QA) ·
              emucap-integration.md(선택적 smoke QA) · glossary-rules.md · project-structure.md · pipeline-contract.* ·
              font-atlas-contract.md · image-translation-contract.md · cleanup-contract.md · handoff-rules.md ·
              workspace-boundary-contract.md(작업 구역·중복 폴더 방지) · artifact-layout-contract.md(산출물 하네스·반복 작업 방지) ·
              language-preflight.md(언어·지역판·기존 이력 사전 점검)
setup/        도구 자동 설치 (tools.manifest.json + install-tools.mjs)
scripts/      프로젝트 생성·검증·스킬/폰트·imagegen 이미지 보존·공식 릴리즈 runtime 검증·Handoff 기반 정리 계획·아카이브·재검토·승인된 휴지통 이동·QA 세션 guard Node CLI
              bulk/(공용 일괄 번역) · eden/(Eden MCP 도구) · fonts/(TTF 한글 추가·글리프 렌더) · codex-imagegen.mjs · release-notes.mjs
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
