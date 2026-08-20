# Steam/PC 플랫폼 어댑터

> Windows 네이티브 게임의 설치 폴더를 읽기 전용 원본으로 사용하고, 프로젝트 작업물·패치·시험
> 증거를 설치 폴더의 `_work/<프로젝트 ID>/`에 격리하는 어댑터다. Steam은 App ID와
> `appmanifest_<APP_ID>.acf`의 build ID를 기준으로 식별한다. 다른 PC 배포판은 `pc-<slug>`와
> 배포처별 build ID를 쓰되, 정식 런타임 PASS 전에 해당 배포처의 공식 출처 allowlist를 이
> 어댑터에 추가해야 한다.

## 1. 플랫폼 개요·전제

- 대상: 사용자가 합법적으로 보유한 Windows PC 게임의 실제 설치 폴더.
- Steam 프로젝트 ID: `steam-<APP_ID>` (예: `steam-123456`).
- 다른 PC 배포판 프로젝트 ID: `pc-<safe-slug>`.
- 원본 설치 파일은 분석 입력이다. 추출·빌드 단계에서 직접 수정하지 않는다.
- 게임 업데이트, Steam 무결성 검사, 모드 로더 갱신은 게임 binary/build ID와 패치 호환성을
  바꿀 수 있으므로 실행 전마다 appmanifest·실행 파일·활성 패치 해시를 다시 읽는다.
- 엔진 처리(Unity, VN 계열, LucaSystem 등)는 `engines/` 모듈이 담당한다. 이 어댑터는 설치
  원본 식별, 프로젝트 경계, overlay 빌드, 직접 실행 QA, 배포 ZIP을 담당한다.

## 2. 도구 체인

| 도구 | 용도 | 배치 경로 규약 |
|---|---|---|
| Steam appmanifest | App ID·build ID의 설치 증거 | Steam이 관리하는 외부 `steamapps/appmanifest_<APP_ID>.acf`; 복사·수정하지 않음 |
| 엔진별 추출기 | 텍스트·이미지·폰트 분석 | 공용 도구는 `$GT_TOOLS`, 출력은 프로젝트 `10_extract/` 또는 `90_tools/work/extract/` |
| BepInEx/XUnity 계열 | 게임이 실제로 사용하는 경우의 런타임 map/plugin 방식 | 특정 게임에서 호환성을 증명한 파일만 `40_build/overlay/`; 범용 필수 도구가 아님 |
| 프로젝트 스캐폴드 | Steam/PC 프로젝트 생성 | `npm run project:new:steam` |
| 경계·구조 검증기 | 설치 원본과 `_work` 출력 격리 | `npm run project:boundary`, `npm run project:validate:steam` |
| 릴리스 패키저 | 결정적 `patch/` overlay ZIP | `npm run release:package:steam`, `npm run release:validate:steam` |
| 직접 실행 | 반복 smoke와 최종 QA | 설치된 게임 EXE를 직접 실행; MCP/emucap으로 최종 PASS 대체 금지 |

## 3. 프로젝트 생성과 구조

Steam 프로젝트는 실제 설치 폴더와 appmanifest를 명시한다.

```powershell
npm run project:new:steam -- `
  --install-root 'D:\SteamLibrary\steamapps\common\Example Game' `
  --game-executable 'ExampleGame.exe' `
  --game-name 'Example Game' `
  --app-id '123456' `
  --steam-manifest 'D:\SteamLibrary\steamapps\appmanifest_123456.acf'
```

다른 PC 배포판은 `--app-id/--steam-manifest` 대신 `--project-id pc-<slug> --build-id <id>`를
사용한다. 이 경로는 정적 작업과 패키징을 지원하지만, 정식 런타임 PASS는 공식 배포처의
project-specific allowlist가 추가되기 전까지 `BLOCKED`다.

```text
<게임 설치 폴더>/
  <게임>.exe                       설치 원본(수정 금지)
  _work/<steam-APP_ID|pc-slug>/
    PROJECT.md
    WORK_LOG.md
    HANDOFF.md
    00_source/SOURCE_INVENTORY.tsv
    10_extract/source_snapshot/     분석에 필요한 선택 파일의 프로젝트 사본
    10_extract/decompiled/
    20_reference/
    30_translation/
    40_build/
      PATCH_MANIFEST.tsv
      BUILD_MANIFEST.tsv
      staging/
      overlay/                      설치 루트 기준 변경분만 배치
      releases/<project-id>.zip
    50_test/
      RELEASE_RUNTIME_QA.json
      release-runtime/ACTIVE_MOD_MANIFEST.tsv
      logs/
      screenshots/
    90_tools/
```

설치 폴더 전체를 `00_source/`에 복제하지 않는다. 실행 파일·appmanifest의 해시와 필요한
원본 inventory를 기록하고, 엔진 분석에 필요한 선택 파일만 `10_extract/source_snapshot/`에
복사한다. 원본 전체가 필요한 도구는 설치 폴더를 읽기 전용 입력으로 받고 출력을 프로젝트
내부로 명시한다.

## 4. 추출 절차

- 상세 계약: [extract.md](extract.md)
- appmanifest, 게임 EXE, 핵심 engine marker의 크기·SHA-256을 먼저 기록한다.
- 확장자만으로 엔진을 단정하지 않고 PE/managed metadata, Unity data folder, archive magic,
  실제 문자열 consumer를 확인한다.
- 런타임 번역 map은 원문 exact key, escape/newline/markup, 중복 fan-out을 보존한다.
- 디컴파일·export·임시 산출물은 각각 canonical project root와 artifact manifest에 등록한다.

## 5. 빌드·실행 시험

- 상세 계약: [build-test.md](build-test.md)
- 빌드 입력은 `40_build/overlay/` 하나다. 경로는 게임 설치 루트 기준 target path다.
- `PATCH_MANIFEST.tsv`의 각 파일은 payload 종류, 재배포 승인, 라이선스/저작 근거, 현재
  SHA-256·크기를 가져야 한다.
- 활성 설치는 build와 분리한다. 실행 중인 게임 파일을 덮지 않고, 종료 후 백업·동일 볼륨
  임시 파일·원자 교체·재시작 순서로 적용한다.
- 반복 smoke와 최종 QA 모두 네이티브 직접 실행이다. 최종 QA는 현재 Steam build ID, 게임
  EXE, 활성 patch 전수 manifest, 로그, 서로 다른 title/gameplay PNG를 schema 2 receipt에 묶는다.

## 6. 배포 패키징 규격

- 상세 계약: [release.md](release.md)
- canonical 파일: `40_build/releases/<project-id>.zip`
- ZIP root: `patch/`; 루트에 검증된 `PATCH_MANIFEST.tsv`도 포함한다.
- 설치 파일 전체, 원본 game assembly/assets/archive, 실행 파일, installer, 비승인 폰트·서드파티
  binary는 포함하지 않는다.
- 정식 릴리스는 `release:validate:steam`, native runtime receipt, 구조 검증을 모두 통과해야 한다.

## 관련 문서

- [추출·원본 inventory](extract.md)
- [overlay 빌드·직접 실행 QA](build-test.md)
- [결정적 ZIP·설치/제거 규격](release.md)
- [공통 프로젝트 경계](../../common/workspace-boundary-contract.md)
- [공식 배포 런타임 QA](../../common/release-runtime-contract.md)
