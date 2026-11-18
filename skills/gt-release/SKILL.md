---
name: gt-release
description: "Release a QA-verified Korean game patch using the platform adapter's exact contract, deterministic hashes, runtime evidence, notes, and cleanup evidence; for NSW build or patch packaging, consume the canonical ZIP produced by gt-nsw-build."
---

# gt-release — 통합 QA 이후: 배포용 파일 생성

검증 완료된 패치를 배포 가능한 패키지로 만든다.

> `$GT_HOME` = 지식 베이스 루트. Codex에서는 이 스킬이 설치된 플러그인 루트(상위에 `.codex-plugin/`, `skills/`, `common/`이 있는 디렉터리)로 해석하고, Claude Code 플러그인에서는 `${CLAUDE_PLUGIN_ROOT}`를 사용한다. 플러그인 외 수동 설치는 지원하지 않는다.
> 시작 전에 `$GT_HOME/common/preflight-checks.md`를 읽고 플랫폼 릴리스 계약·QA 승인·현재 canonical staging을 확인한다.
> 작업 중 문서와 실제의 괴리·막힌 지점·우회법을 발견하면 **즉시** 프로젝트 `HANDOFF.md`에 기록한다 (`$GT_HOME/common/handoff-rules.md`).

## 입력 조건

- `gt-qa` 완료 기준 전 항목 통과. `runtime_policy`는 중간 실행 빈도만 조절하며 릴리스의
  최종 런타임 게이트를 생략하지 않는다. `50_test/RELEASE_RUNTIME_QA.json`이 현재 최종
  build에 대해 공식 사이트 배포용 릴리즈의 MCP 없는 직접 실행을 증명하고
  `npm run runtime:validate`를 통과해야 한다. `PENDING_RUNTIME`이면 릴리스는 `BLOCKED`다.
- `text_status=review_ready`, `font_status=verified`, `image_scope=required`이면
  `image_status=review_ready`; `image_scope=N/A`이면 이미지 단계 생략 사유와 0건 근거가
  `PROJECT.md`/QA 보고서에 기록됨
- 플랫폼 어댑터 로드: `$GT_HOME/platforms/<platform>/release.md`
- `PROJECT.md`에 플랫폼 어댑터의 exact release path, filename, archive root, version ledger가 기록됨
- `HANDOFF.md`의 open 항목·cleanup 계획·세션 상태가 릴리스 파일과 충돌하지 않음

## 절대 규칙

- 배포 형식은 플랫폼 계약을 따른다. NSW에서 타이틀별 사용자 지시가 전체 컨테이너
  LayeredFS 교체를 명시적으로 허용하면 이를 원본 데이터 포함만을 이유로 거부하지 않는다.
  원본 NSP/XCI, 키, 펌웨어는 배포물에 넣지 않는다. 다른 플랫폼은 해당 어댑터의
  델타·재배포 계약을 따른다.
- 콘솔 키·펌웨어·롬 파일은 어떤 형태로도 포함 금지.
- 공통 스킬은 게임명·날짜·버전이 붙은 파일명을 임의로 선택하지 않는다. 정확한 경로·파일명·
  ZIP 루트는 플랫폼 어댑터와 `PROJECT.md`의 계약을 그대로 사용한다.
- 플랫폼 계약이 없거나 문서끼리 다른 이름·폴더·루트를 가리키면 패키징하지 말고 `BLOCKED`와
  `HANDOFF.md` 기록을 남긴다.
- 사용자가 NSW에서 `빌드 생성` 또는 `패치 생성`이라고 하면 전담 `gt-nsw-build`로
  라우팅한다. 이 스킬은 그 결과를 받아 정식 릴리스 게이트를 계속 수행한다.
  진단 폴더·버전/candidate 하위 폴더·delta 적용기 패키지를 대신 만들지 않는다.
- NSW의 exact 결과는 `<타이틀 루트>/_release/<한국어 제목> - <BASE_TITLE_ID>.zip` 하나이며 내부 entry는
  `atmosphere/contents/<BASE_TITLE_ID>/romfs/<패치파일>` 및 선택적 `atmosphere/contents/<BASE_TITLE_ID>/exefs/main`이다. 입력은
  `40_build/layeredfs/<BASE_TITLE_ID>/romfs/`와 선택적 `exefs/main`이다. `romfs/` 단독 root,
  `<UPDATE_TITLE_ID>.zip`, `*.gldelta`, `apply_patch.py`, NSP/XCI/키가 있으면 실패한다.
- **릴리스 폴더**: `<타이틀 루트>/_release/` — `_work/` 옆, 프로젝트 루트 기준 `../../_release`, 프로젝트 경계 밖의 유일한 쓰기 허용 위치. ZIP, `RELEASE_NOTES.md`, `INSTALL.md`(있으면),
  `SHA256SUMS.txt`, `RELEASE_PACKAGE.json`을 그 바로 아래에 두고 버전·candidate 하위 폴더는 만들지 않는다.
  교체된 이전 ZIP은 지우지 않고 `_release/superseded/`로 옮겨 이전 이름을 유지한다(생성기가 `--replace` 때 자동 수행).
  예전 위치(`_work/<ID>/60_release/`, `_work/<ID>/40_build/releases/`)는 legacy로, 검증기가 `_release/`를 먼저 찾고 없을 때만 경고와 함께 읽는다. legacy 프로젝트는 다음 릴리스 때 `_release/`로 옮긴다. `RELEASE_PACKAGE.json`의 `archive_path`는 타이틀 루트 기준 `_release/<파일명>`이다.
- **파일명(기본값)**: `release:package:nsw`는 추가 플래그 없이 `<한국어 제목> - <BASE_TITLE_ID>.zip`을 만든다
  (예: `지뢰계 마법소녀 사쿠라 - 01006D202294E000.zip`). 한국어 제목은 `--korean-title` → 타이틀 루트의 빈
  한국어 라벨 폴더(`<타이틀 루트>/<한국어 제목>/`) → `PROJECT.md`의 `- Korean title:` 순서로 정하고, 모두 없으면
  fail closed로 중단한다. Windows 금지 문자(`\ / : * ? " < > |`)와 `[Title ID]` 표기는 지우고 `~ ∬ ,` 등은 유지한다.
  Title ID 접미사는 필수이며 검증기가 프로젝트 Title ID와 대조한다. `<BASE_TITLE_ID>.zip`은 `--legacy-name`일 때만 쓴다.
  Steam/PC도 같은 규칙으로 `<설치 루트>/_release/<한국어 제목> - <project-id>.zip`이다(제목은 `PROJECT.md`/`--korean-title`).

## 절차

1. **패키징**: 플랫폼 어댑터의 배포 규격에 따라 패키지 생성.
   - 결정적 빌드: 같은 입력 → 바이트 동일 ZIP (타임스탬프 고정)
   - 파일명·출력 폴더·ZIP 루트: 플랫폼 어댑터의 canonical 규칙을 그대로 사용하고 수동 rename하지 않는다.
   - 패키지의 SHA-256 해시 기록
   - NSW는 `gt-nsw-build`에 위임해 다음 공용 명령으로 생성·재검증한다. 프로젝트별 임의
     ZIP 코드로 우회하지 않는다.

   ```text
     npm run release:package:nsw -- --project-root "<타이틀 루트>/_work/<BASE_TITLE_ID>" --replace
   npm run release:validate:nsw -- --project-root "<타이틀 루트>/_work/<BASE_TITLE_ID>"
   ```
   - 한국어 제목을 자동으로 정할 수 없으면 두 명령에 `--korean-title "<한국어 제목>"`을 함께 넘긴다.
   - Steam/PC는 `platforms/steam/release.md`의 공용 패키저로 `40_build/overlay/`와
     `PATCH_MANIFEST.tsv`를 검증해 `patch/` root의 canonical ZIP을 만든다.

     ```text
     npm run release:package:steam -- --project-root "<install-root>/_work/<steam-APP_ID|pc-slug>"
     npm run release:validate:steam -- --project-root "<install-root>/_work/<steam-APP_ID|pc-slug>"
     ```
2. **설치 가이드 작성**: `INSTALL.md` — 대상 게임 버전/리전, 설치 경로, 적용 방법,
   제거 방법, 알려진 제한사항. 플랫폼별 설치법(에뮬레이터 모드 폴더/실기 적용)을
   사용자 눈높이로.
3. **릴리스 노트**: `RELEASE_NOTES.md`(패치 노트) — 사용자용 한국어 문서를 **간소하게** 쓴다. canonical
   ZIP 옆에 두고 타이틀 기록(PROJECT/WORK_LOG/TEST_LOG/HANDOFF)에 있는 사실만 쓴다. 해시·빌드 경로·
   번역 통계·시험 환경 같은 내부 정보는 넣지 않는다(이런 근거는 `_work` 기록에 둔다). 형식은 고정이다.

   ```markdown
   # <한국어 제목> 한국어 패치

   1. 게임명 - <한국어 제목>

   2. 게임 출시일 - 2025-03-27*     (24개월 미경과면 날짜 바로 뒤에 `*`)

   3. 패치 버전 - v0.0.1            (첫 배포는 v0.0.1, 이후 배포마다 올린다)

   4. 게임 지원 버전 - v1.0.0       (필요한 업데이트/DLC 포함 여부: 예 "v1.0.2 (업데이트 1.0.2 설치 필요)", "v1.0.0, DLC 포함")

   5. 언어 선택 방법 - <예: 설정 불필요 / 첫 실행 언어 선택에서 「한국어」 / 기기 언어를 일본어로 변경>

   6. 체인지로그
      - v0.0.1 - 초도 배포
      - v0.0.2 - 크래시 버그 픽스  (새 버전을 아래에 한 줄씩 추가)

   7. 주의사항
      - 없음  (예: RomFS와 ExeFS를 같이 사용함, saltyNX가 필요함, 업데이트 x.y.z 설치 필요)
   ```

   번호 항목(1~7) 사이에는 빈 줄을 한 줄씩 넣는다. 체인지로그·주의사항의 `-` 하위 줄은 붙여 쓴다.

   게임 출시일은 `gt-analyze`가 `PROJECT.md`에 기록한 `출시일`을 `YYYY-MM-DD`로 옮긴다. 이번
   번역 배포일(이 릴리스 노트를 확정하는 날짜)이 `출시일 + 24개월`(달력 월 기준)보다 이르면 날짜 바로
   뒤에 `*`를 붙인다. 예: 출시 2025-03-27 → 2027-03-27 이전 배포면 `2025-03-27*`, 그날 이후면 `2025-03-27`.
   새 버전을 배포할 때마다 그 배포일로 다시 판정한다. 출시일이 `unknown`이면 `미확인`으로 쓰고 `*`를
   붙이지 않으며, 릴리스 전에 다시 조사한다.
   출시일 기준(우선순위): ① 대상 플랫폼·대상 지역판(예: Switch 일본판) 출시일 → ② 같은 플랫폼의 다른 지역판
   출시일(괄호로 근거, 예: `2025-11-19* (유럽판 Switch 기준)`) → ③ 대상 플랫폼판이 이식판이면 원작 플랫폼 출시일
   (예: `2026-02-27* (원작 PC판 기준, Switch판은 이식판)`). 이 셋으로도 확인되지 않을 때만 `미확인`으로 둔다.
   근거 URL은 `PROJECT.md`의 `출시일` 옆에 남긴다.
   패치 안에 4GiB 이상인 파일이 하나라도 있으면 주의사항에 `SD 카드가 exFAT 형식이어야 함 (4GB를 넘는 파일 포함,
   FAT32 불가)`를 적는다. ZIP은 이때 Zip64가 되며, Switch는 ZIP을 직접 읽지 않으므로 문제는 SD 카드 파일
   시스템뿐이다. 압축률을 높여도 풀린 파일 크기는 그대로라 FAT32 제한은 해결되지 않는다. 릴리스 노트 형식은 이 절을 따르고, 예전 타이틀의 노트를
   양식으로 복사하지 않는다(항목이 빠진 구형 노트가 있다).
   보류 행(`translated_with_held`)이 남아 있으면 주의사항에 "일부 대사 <n>행은 원문 유지"를 적는다. 파일 경로 같은
   내부 정보는 노트에 쓰지 않고, `HELD_FOR_USER.tsv` 경로는 `HANDOFF.md`에 둔다.
   언어 선택 방법은 실제 런타임 시험에서 쓴 방식을 근거로 적는다. 이전의 상세 노트를 대체할 때는
   지우지 말고 `_release/superseded/`로 옮긴다.
3a. **릴리스 스크린샷**: `_release/screenshots/`에 대표 런타임 캡처 4~6장을 둔다. `50_test` 증거
   (예: `50_test/eden/captures_*`)에서 **복사**하며 이동하지 않는다. 최종 빌드 캡처만 고르고, 넣기 전에 직접 열어
   검은 화면·로딩 화면이 아닌지 확인한다. 고르는 장면: 타이틀 화면, 첫 한국어 대사, 메인 메뉴/옵션,
   저장·불러오기 또는 다른 핵심 UI, (있으면) 한국어화한 이미지(로고 등). 파일명은 `NN_<what>.png`
   (예: `01_title.png`, `02_dialogue.png`, `03_menu.png`, `04_saveload.png`, `05_logo.png`).
4. **최종 검증**: 패키지를 깨끗한 mod 환경에 풀어 적용한 뒤, 플랫폼 allowlist의 공식
   사이트 배포용 릴리즈 에뮬레이터를 MCP 없이 직접 실행해 타이틀 화면과 인게임·한글·폰트·
   저장/불러오기·조건부 이미지를 시험한다. 현재 package/build/mod/binary/log/캡처 hash로
   `RELEASE_RUNTIME_QA.json`을 갱신하고 `npm run runtime:validate`를 다시 통과시킨다.
5. **아카이브**: 릴리스 패키지·해시·증거를 플랫폼 어댑터가 지정한 canonical 경로에 보관.
   `PROJECT.md`의 상태는 모든 필수 QA·런타임/하드웨어 정책·체크섬 동기화가 끝난 뒤에만
   `released`로 갱신한다. 버전은 canonical ZIP 파일명과 분리된 원장에서 관리한다.
6. **완료 후 정리**: `gt-project-cleanup` 또는
   `npm run project:cleanup -- --project-root "<타이틀 루트>/_work/<프로젝트 ID>"`로
   Handoff·manifest 기반 `CLEANUP_PLAN.json`과 `CLEANUP_INSTRUCTIONS.md`를 먼저 생성한다.
   계획의 exact 파일을 `approved=true`로 표시한 `--apply`는 cleanup archive로 이동하고
   영구 삭제하지 않는다. 아카이브·프로젝트 전체 재검토 보고서를 사용자에게 상세히
   전달한 뒤 같은 turn에서 멈춘다. 이후 사용자가 별도 요청으로 승인한 경우에만 현재
   trash-plan SHA-256과 `--trash --user-confirmed-trash`로 아카이브 파일을 운영체제
   휴지통에 보낸다. 휴지통 실패 시 영구 삭제로 폴백하지 않는다.
   단순한 `tmp` glob 삭제, active 세션 삭제, 릴리스·QA·cleanup 증거 삭제는 금지한다.
   상태 변경 시 `--review-archive`로 재검토하고 승인을 초기화한다.
7. **커밋(선택)**: 저장소 추적 대상(번역 TSV·용어집·문서)만 명시적 allowlist로 커밋
   (`common/SAFETY.md`의 git 규칙 — `git add .` 금지, 롬/키/추출물/빌드 산출물 제외).

## 산출물

| 파일 | 내용 |
|-----|------|
| `<adapter release path>/<canonical>.zip` | 배포 패키지 (+ SHA-256). NSW: `atmosphere/contents/<BASE_TITLE_ID>/romfs/`와 선택적 `atmosphere/contents/<BASE_TITLE_ID>/exefs/main`; Steam/PC: `patch/` + root `PATCH_MANIFEST.tsv` |
| `<adapter release path>/INSTALL.md` | 설치 가이드 |
| `<adapter release path>/RELEASE_NOTES.md` | 릴리스 노트 |
| `<adapter release path>/SHA256SUMS.txt`, `RELEASE_PACKAGE.json` | 해시·entry 원장 (생성기가 기록) |
| `<adapter release path>/screenshots/NN_<what>.png` | 대표 런타임 캡처 (`50_test`에서 복사) |
| `<adapter release path>/superseded/` | 교체된 이전 ZIP (이전 이름 유지) |

NSW·Steam/PC의 `<adapter release path>`는 타이틀(설치) 루트의 `_release/`다(`_work/` 옆).

## 완료 기준

- [ ] 패키지 내용물 전수 목록 검사; NSP/XCI·키·펌웨어가 없고 NSW 전체 컨테이너
      교체에는 타이틀별 명시적 사용자 지시가 기록됨
- [ ] 깨끗한 환경 적용 스모크 테스트 통과 (증거 보존)
- [ ] 공식 사이트 배포용 릴리즈를 직접 실행했고 `mcp_used=false`, URL·버전·바이너리 SHA-256·현재 build/mod/evidence가 검증됨
- [ ] `npm run runtime:validate` 및 플랫폼 구조 검증(NSW `project:validate -- --strict`,
  Steam/PC `project:validate:steam -- --strict`) 통과; MCP-only 결과나 `PENDING_RUNTIME`으로 릴리스하지 않음
- [ ] INSTALL.md / RELEASE_NOTES.md 완비, 해시 기록
- [ ] RELEASE_NOTES.md의 게임 출시일이 `PROJECT.md`와 일치하고, 배포일 기준 24개월 미경과 시 `*`가 붙음
- [ ] `_release/screenshots/`에 최종 빌드 대표 캡처(`NN_<what>.png`)를 복사했고 검은/로딩 화면이 없음
- [ ] Handoff 기반 cleanup plan·지시서가 생성되고 보존 anchor와 승인 allowlist가 검증됨
- [ ] 승인된 정리를 적용했다면 plan SHA-256·아카이브 경로·전수 재검토·사용자 상세 보고가 기록됨
- [ ] 이후 별도 승인으로 휴지통 이동했다면 trash-plan SHA-256·backend·원래 아카이브 경로·`TRASH_RECEIPT.json`·플랫폼 구조 검증 결과가 기록됨
- [ ] canonical 파일명·경로·ZIP root·파일 allowlist가 어댑터 계약과 exact 일치
- [ ] NSW이면 `release:validate:nsw`가 entry 경로·CRC-32·SHA-256과 canonical RomFS/ExeFS를 전수 대조해 통과
- [ ] 공식 배포 릴리즈 런타임·하드웨어 상태와 `released` 판정이 서로 혼동되지 않음
