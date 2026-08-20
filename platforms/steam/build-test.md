# Steam/PC overlay 빌드와 직접 실행 QA

## 1. canonical overlay

빌드 결과는 설치 루트 기준 상대경로를 그대로 가진 `40_build/overlay/`에 둔다. 깨끗한
translation/font/plugin 입력에서 `40_build/staging/`을 새로 만들고 정적 검증을 통과한 파일만
overlay로 승격한다. 설치 게임 폴더를 build output으로 사용하지 않는다.

`40_build/PATCH_MANIFEST.tsv` 헤더는 정확히 다음과 같다.

```tsv
relative_path\ttarget_path\tpayload_kind\tredistribution_status\tsource_license\tsha256\tsize_bytes
```

- `relative_path`와 `target_path`는 동일한 install-relative forward-slash 경로다.
- `payload_kind`: `translation-map`, `plugin`, `font`, `config`, `binary-delta`, `documentation`.
- `redistribution_status`: 정식 패키징 가능한 행은 `cleared`만 허용한다.
- `source_license`: `project-authored`, SPDX 식별자, 또는 구체적 permission evidence. `unknown`,
  `pending`, `unverified`는 실패한다.
- hash/size는 현재 overlay bytes와 exact 일치해야 한다.

원본 `Assembly-CSharp.dll`, `GameAssembly.dll`, `UnityPlayer.dll`, Steam API DLL, Unity
`.assets/.resource/.bundle`, game archive/installer/executable은 canonical release payload로
거부한다. 원본 기반 수정이 필요하면 저작권상 안전한 delta 또는 런타임 plugin/map 방식으로
전환하고, 전환할 수 없으면 개인용 build와 배포 release를 분리해 `BLOCKED`로 기록한다.

## 2. 정적 빌드 검사

1. `npm run project:boundary -- --stage build`로 staging/overlay/release 경로를 검사한다.
2. 모든 translation map의 key·delimiter·escape·newline·markup round-trip을 검사한다.
3. plugin은 대상 framework/architecture, dependency, load target과 build ID를 기록한다.
4. 폰트는 전체 visible codepoint coverage와 실제 consumer/fallback render probe를 통과한다.
5. `BUILD_MANIFEST.tsv`에 하나의 final build row와 overlay aggregate hash를 기록한다.
6. 패키징 전 `release:validate:steam`의 동일 inventory 검사를 수행한다.

## 3. 활성 패치 적용

활성 설치는 프로젝트 overlay와 별도 상태다.

1. 대상 게임 프로세스와 실제 install root를 snapshot한다.
2. 같은 타이틀 프로세스가 실행 중이면 active 파일을 교체하지 않는다.
3. 기존 대상 파일이 있으면 프로젝트 `50_test/` 증거에 현재 path/hash를 기록하고 복구 가능한
   백업 계획을 만든다. 임의 `backup-1`, 날짜 복사본을 release overlay에 넣지 않는다.
4. 같은 볼륨의 고유 임시 파일로 복사하고 hash를 확인한 뒤 파일 단위 atomic rename/replace한다.
5. `ACTIVE_MOD_MANIFEST.tsv`로 활성 patch root의 regular file을 전수 기록한다.
6. 게임을 새로 시작한다. 이전 프로세스의 화면은 새 build 증거가 아니다.

## 4. 반복 smoke

- backend: `direct-native`, session scope: `none`.
- boot, title, 실제 입력, gameplay 진입, 한국어 map 소비, 글리프, 저장/불러오기를 확인한다.
- plugin loader 생존이나 번역 파일 load log만으로 PASS하지 않는다.
- online/API text는 네트워크 응답 시점과 build ID를 함께 기록한다.
- emucap/MCP는 선택적 보조 캡처일 수 있지만 Steam 직접 실행을 대체하지 않는다.

## 5. 최종 런타임 receipt (schema 2)

Steam 최종 QA는 `50_test/RELEASE_RUNTIME_QA.json`에 다음 native 필드를 사용한다.

```json
{
  "schema_version": 2,
  "stage": "final-qa",
  "platform": "steam",
  "project_id": "steam-123456",
  "distribution": "steam",
  "steam_app_id": "123456",
  "distribution_build_id": "12345678",
  "final_build_id": "final-001",
  "final_build_manifest_path": "40_build/BUILD_MANIFEST.tsv",
  "final_build_manifest_sha256": "<sha256>",
  "execution_surface": "official-distribution-release",
  "launch_mode": "direct",
  "mcp_used": false,
  "runtime_name": "steam-native",
  "runtime_version": "12345678",
  "release_channel": "official-release",
  "official_store_page": "https://store.steampowered.com/app/123456/",
  "distribution_manifest_path": "<absolute-appmanifest-path>",
  "distribution_manifest_sha256": "<sha256>",
  "installation_root": "<absolute-game-install-root>",
  "game_binary_path": "<absolute-game-exe>",
  "game_binary_sha256": "<sha256>",
  "system_region": "대한민국",
  "system_language": "한국어",
  "active_mod_root": "<absolute-active-patch-root>",
  "active_mod_manifest_path": "50_test/release-runtime/ACTIVE_MOD_MANIFEST.tsv",
  "active_mod_manifest_sha256": "<sha256>",
  "runtime_log_path": "50_test/logs/release-runtime.log",
  "runtime_log_sha256": "<sha256>",
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

`distribution_build_id`와 `runtime_version`은 appmanifest의 현재 buildid와 일치해야 한다.
`game_binary_path`는 install root 안이면서 project root 밖이어야 한다. 활성 mod·로그·두 PNG·
build manifest의 현재 hash가 하나라도 바뀌면 receipt는 무효다.

## 6. 판정

- `PASS (bench)`: 구조·round-trip·manifest 정적 검사만 통과.
- `PASS (runtime)`: schema 2 receipt와 현재 appmanifest/game EXE/active patch/evidence 전부 통과.
- `PENDING_RUNTIME`: 설치본·호환 plugin·실제 화면 증거가 없음.
- `BLOCKED`: build ID drift, 실행 중 파일 교체 위험, 원본 payload 포함, 활성 patch inventory 불일치.
