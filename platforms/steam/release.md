# Steam/PC 배포 패키징 계약

## 1. canonical 입력·출력

| 항목 | 경로/값 |
|---|---|
| 입력 overlay | `40_build/overlay/` |
| 재배포 원장 | `40_build/PATCH_MANIFEST.tsv` |
| 출력 | `40_build/releases/<project-id>.zip` |
| ZIP patch root | `patch/` |
| ZIP metadata | 루트 `PATCH_MANIFEST.tsv` |
| version/hash 원장 | `40_build/releases/RELEASE_PACKAGE.json`, `SHA256SUMS.txt` |

Steam App ID가 123456이면 파일명은 정확히 `steam-123456.zip`이다. 버전·날짜·candidate를
파일명이나 하위 폴더에 붙이지 않고 `RELEASE_PACKAGE.json`과 release notes에 기록한다.

```powershell
npm run release:package:steam -- --project-root '<install-root>\_work\steam-123456'
npm run release:validate:steam -- --project-root '<install-root>\_work\steam-123456'
```

기존 canonical ZIP과 입력 bytes가 같으면 재사용한다. 다르면 검토 후 `--replace`를 명시한다.

## 2. 포함 허용·금지

허용은 `PATCH_MANIFEST.tsv`에서 `redistribution_status=cleared`이고 현재 hash/size가 일치하는
overlay 파일뿐이다. 대표 패턴은 프로젝트가 작성한 번역 map, 호환성이 검증된 project plugin,
재배포 라이선스가 확인된 폰트·config, 원본을 복원하지 못하는 binary delta다.

다음은 자동 거부한다.

- 게임 EXE, installer, Steam API DLL
- 원본/수정 `Assembly-CSharp.dll`, `GameAssembly.dll`, `UnityPlayer.dll`
- Unity `.assets`, `.resource`, `.bundle/.unity3d`
- 원본 game archive·disc/package (`.pak`, `.cpk`, `.arc`, `.vpk`, `.iso` 등)
- `source_license=unknown|pending|unverified`인 font/plugin/third-party payload
- link/reparse path, project `_work` 파일, manifest 미등록 파일

확장자 차단을 피하려 이름만 바꾸는 것은 허용하지 않는다. 안전한 map/plugin/delta 배포형으로
바꾸지 못하면 개인용 적용본과 공개 release를 분리하고 릴리스를 `BLOCKED`로 유지한다.

## 3. INSTALL.md 필수 내용

- 대상 App ID/배포처, 검증한 build ID, 게임 EXE hash
- ZIP의 `patch/` 내용을 설치 root에 적용하는 exact 경로
- 필요한 mod loader와 버전·공식 입수처(패키지에 포함하면 라이선스 근거)
- 기존 파일 backup과 제거/복원 절차
- 게임과 Steam client를 종료한 뒤 설치하고 게임을 재시작해야 한다는 안내
- Steam 업데이트/무결성 검사 뒤 patch 호환성을 다시 확인해야 한다는 안내
- 알려진 미번역, image scope, font/온라인 텍스트 제한

## 4. RELEASE_NOTES.md 필수 내용

- 패치 버전과 canonical ZIP SHA-256
- 번역 text/image/font/plugin 범위와 보류 항목
- 검증한 Steam build ID, executable hash, loader/plugin version
- schema 2 runtime QA의 시험 시각·화면 범위·save/load 결과
- 포함 payload별 저작/라이선스 근거와 크레딧

## 5. 릴리스 완료 게이트

- [ ] `release:validate:steam`이 ZIP entry/hash/CRC/source inventory를 전수 통과
- [ ] `PATCH_MANIFEST.tsv`의 모든 파일이 재배포 허용 상태이고 원본 게임 payload 0건
- [ ] `PROJECT.md`의 font/text/image review 게이트 통과
- [ ] 현재 공식 Steam appmanifest build ID와 game EXE hash 확인
- [ ] 깨끗한 active patch root에 ZIP을 적용하고 게임을 직접 재시작
- [ ] title/gameplay/한국어/글리프/save-load/조건부 image 실제 확인
- [ ] `npm run runtime:validate`가 schema 2 receipt를 통과
- [ ] `npm run project:validate:steam -- --strict` 통과
- [ ] INSTALL.md, RELEASE_NOTES.md, SHA256SUMS.txt 완비

패키징 성공은 `review_candidate`를 만들 수 있을 뿐 `released`를 뜻하지 않는다. runtime receipt가
없거나 MGCM 같은 과거 plugin backup만 있고 현재 설치/호환성/consumer render가 없으면
`PENDING_RUNTIME` 또는 `BLOCKED`를 유지한다.
