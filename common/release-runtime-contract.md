# 공식 배포용 릴리즈 런타임 최종 QA 계약

이 계약은 MCP 기반의 빠른 반복 시험과 릴리즈 승인용 최종 런타임 시험을 분리한다.

## 판정 경계

- NSW 기본 반복 시험은 `eden-mcp`를 사용하며 타이틀당 canonical 세션 하나를 재사용한다.
  Steam/PC는 `direct-native`, session scope `none`으로 설치 게임을 직접 실행한다.
- `eden-mcp` 또는 `ryubing-mcp` 결과는 smoke/진단 증거일 뿐 최종 QA 통과를 만들지 못한다.
- 최종 QA는 `platforms/<platform>/runtime-emulators.json`에 등록된 **공식 사이트의 배포용
  릴리즈 또는 공식 배포 설치본**을 MCP 없이 직접 실행해야 한다. 파일명은 역사적 호환을
  위해 유지하며 Steam adapter에서는 native runtime allowlist를 담는다.
- nightly, development, CI artifact, MCP 번들·전용 빌드, 출처를 확인할 수 없는 미러는
  최종 QA 입력으로 인정하지 않는다.
- 공식 배포용 릴리즈가 실제로 실행되지 않았거나 아래 증거가 현재 바이트와 일치하지 않으면
  `qa_status`는 `runtime_pending` 또는 `blocked`이며 `passed`/`released`로 승격하지 않는다.

## Canonical 증거

최종 시험은 프로젝트당 다음 canonical 파일을 하나씩 유지한다.

```text
50_test/RELEASE_RUNTIME_QA.json
50_test/release-runtime/ACTIVE_MOD_MANIFEST.tsv
```

schema 1 에뮬레이터 영수증은 다음을 모두 기록한다.

- 현재 Title ID와 최종 `build_id`
- 현재 `40_build/BUILD_MANIFEST.tsv`의 SHA-256 및 그 안의 유일한 build 행
  (`device_result=PASS (official-release-runtime)`)
- `execution_surface=official-distribution-release`, `launch_mode=direct`, `mcp_used=false`
- 에뮬레이터 이름·정확한 버전·`release_channel=official-release`
- 정확한 에뮬레이터 버전과 tag가 일치하는 공식 릴리즈 페이지 및 공식 다운로드 URL
- 실제 실행한 외부 바이너리의 절대경로와 현재 SHA-256
- `한국`/`대한민국` 지역, `한국어` 시스템 언어
- 실제 활성 mod 루트와 그 파일을 전수 열거한 canonical manifest
- 에뮬레이터 로그, 타이틀 화면, 게임플레이 화면의 project-relative 경로와 SHA-256
- boot/title/gameplay/Korean text/font/save-load/image 항목별 판정과 최종 `result=pass`
- 실행 시각
- `PROJECT.md`의 승인된 runtime authorization과 확정된 `image_scope`

필드 이름은 다음 schema 1 골격과 정확히 맞춘다. `<...>` 값과 해시는 실제 시험에서 계산한
값으로 교체하며 placeholder가 남으면 검증 실패다.

```json
{
  "schema_version": 1,
  "stage": "final-qa",
  "platform": "nsw",
  "title_id": "<16-HEX-TITLE-ID>",
  "final_build_id": "<build-id>",
  "final_build_manifest_path": "40_build/BUILD_MANIFEST.tsv",
  "final_build_manifest_sha256": "<sha256>",
  "execution_surface": "official-distribution-release",
  "launch_mode": "direct",
  "mcp_used": false,
  "emulator_name": "<allowlisted-name>",
  "emulator_version": "<exact-version>",
  "release_channel": "official-release",
  "official_release_page": "<allowlisted-https-release-page>",
  "official_download_url": "<allowlisted-https-download-url>",
  "emulator_binary_path": "<absolute-external-binary-path>",
  "emulator_binary_sha256": "<sha256>",
  "system_region": "대한민국",
  "system_language": "한국어",
  "active_mod_root": "<absolute-external-mod-root>",
  "active_mod_manifest_path": "50_test/release-runtime/ACTIVE_MOD_MANIFEST.tsv",
  "active_mod_manifest_sha256": "<sha256>",
  "emulator_log_path": "50_test/logs/release-emulator.log",
  "emulator_log_sha256": "<sha256>",
  "title_screen_evidence_path": "50_test/screenshots/release-title.png",
  "title_screen_evidence_sha256": "<sha256>",
  "gameplay_evidence_path": "50_test/screenshots/release-gameplay.png",
  "gameplay_evidence_sha256": "<sha256>",
  "checks": {
    "boot": "pass",
    "title_screen": "pass",
    "gameplay_entry": "pass",
    "korean_text": "pass",
    "font_glyphs": "pass",
    "save_load": "pass",
    "image_assets": "pass"
  },
  "result": "pass",
  "tested_at": "<ISO-8601>"
}
```

Steam/PC 직접 실행은 `platforms/steam/build-test.md`의 schema 2를 사용한다. 이 schema는
에뮬레이터 필드 대신 project ID, Steam App ID/build ID, 현재 appmanifest, install root,
game EXE, runtime log를 기록한다. 공통 build/active patch/screenshot/check/result 증거는 schema
1과 동일하게 검증한다. 비 Steam PC 배포처는 해당 공식 출처 allowlist가 adapter에 추가되기
전까지 최종 PASS로 승격하지 않는다.

활성 mod manifest의 헤더는 다음과 정확히 같고 데이터 행이 한 개 이상이어야 한다.

```tsv
relative_path\tsha256\tsize_bytes
```

manifest는 활성 mod 루트의 모든 regular file을 정확히 한 번씩 포함해야 한다. 누락·추가·중복,
심볼릭 링크, 경로 이탈, 크기 또는 해시 불일치는 최종 QA 실패다. 타이틀/게임플레이 증거는
실제 dimensions를 가진 서로 다른 PNG 바이트여야 하며 같은 파일·같은 해시 복제는 거부한다.
이미지가 프로젝트 범위에
없으면 `checks.image_assets=not-applicable`만 허용하며 나머지 필수 항목은 모두 `pass`여야 한다.

## 검증과 릴리즈 게이트

다음 명령은 영수증과 현재 파일 바이트를 다시 읽어 fail-closed로 검증한다.

```text
npm run runtime:validate -- --project-root "<title>/_work/<TITLE_ID>" \
  --receipt "<title>/_work/<TITLE_ID>/50_test/RELEASE_RUNTIME_QA.json"
```

`qa_status=passed` 또는 `release_status=released`이면 프로젝트 검증기가 이 명령을 자동으로
실행한다. 영수증이 없거나 공식 출처 allowlist와 불일치하거나 외부 바이너리/활성 mod/로그/
스크린샷/빌드 manifest 중 하나라도 달라졌으면 릴리즈를 차단한다. 과거 MCP 캡처를 이
영수증으로 복사하거나 `mcp_used=false`로 바꾸어 기록하는 것은 허용하지 않는다.
