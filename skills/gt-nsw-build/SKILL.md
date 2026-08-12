---
name: gt-nsw-build
description: "Create or validate the one canonical NSW LayeredFS patch ZIP when the user asks for 빌드 생성, 패치 생성, an NSW build, or a Title-ID/romfs archive; reject alternate candidate, delta-applier, game-name, or update-Title-ID packages."
---

# gt-nsw-build — NSW canonical 패치 빌드 전담

NSW 패치의 입력·출력·ZIP root를 하나의 계약으로 강제한다. 이 스킬은 패키징만 담당하며,
통합 QA와 정식 릴리스 판정은 `gt-qa`와 `gt-release`가 담당한다.

> `$GT_HOME`은 이 스킬이 설치된 플러그인 루트다. 시작 전에
> `$GT_HOME/common/SAFETY.md`, `$GT_HOME/common/project-structure.md`,
> `$GT_HOME/common/preflight-checks.md`, `$GT_HOME/common/pipeline-contract.json`,
> `$GT_HOME/platforms/nsw/release.md`를 읽는다.
> 프로젝트의 `PROJECT.md`, `HANDOFF.md`, `WORK_LOG.md`와 canonical Title ID를 확인한다.
> 문서·실제 파일·Title ID가 충돌하면 빌드하지 않고 `BLOCKED`와 근거를 `HANDOFF.md`에
> append-only로 기록한다.

## 호출 조건과 책임 경계

- 사용자가 NSW 프로젝트에서 **`빌드 생성`** 또는 **`패치 생성`**이라고 하면 이 스킬을
  직접 사용한다. `gt-release`의 일반 패키징 절차나 임의 ZIP 제작으로 대체하지 않는다.
- `NSW 빌드`, `LayeredFS ZIP`, `Title ID/romfs ZIP`, 설치용 모드 ZIP 생성·검증 요청도
  이 스킬의 범위다.
- 이 스킬의 성공은 `review_candidate` 패키지 생성을 뜻할 수 있다. 그 자체로
  `release_status=released`, QA 통과, 실기 검증 완료를 선언하지 않는다.
- 정식 릴리스 요청이면 canonical ZIP을 만든 뒤 `gt-release`로 돌아가 runtime receipt,
  문서, 해시, 상태 게이트를 계속 검증한다.

## 유일한 패키지 계약

| 항목 | exact 값 |
|---|---|
| 프로젝트 루트 | `<타이틀 루트>/_work/<BASE_TITLE_ID>` |
| 유일한 입력 | `40_build/layeredfs/<BASE_TITLE_ID>/romfs/` |
| 유일한 ZIP | `40_build/releases/<BASE_TITLE_ID>.zip` |
| ZIP entry | `<BASE_TITLE_ID>/romfs/<패치파일>` |
| 생성기 | `$GT_HOME/scripts/create-nsw-release.mjs` |
| 검증기 | `$GT_HOME/scripts/validate-nsw-release.mjs` |

`BASE_TITLE_ID`는 대문자 16자리 hex여야 한다. update/DLC Title ID, NSP 파일명에서 추측한
다른 ID, 게임명, 버전, 날짜, `candidate`를 ZIP 이름이나 중간 출력 폴더에 넣지 않는다.

다음은 패치 산출물이 아니므로 입력·ZIP 어디에도 허용하지 않는다.

- `apply_patch.py`, `*.gldelta` 또는 다른 별도 적용기/델타 묶음
- `*.nsp`, `*.xci`, `*.keys`, prod/title keys, 펌웨어, 원본 게임 데이터
- symlink, junction, reparse point, canonical RomFS 밖에서 끌어온 파일
- `40_build/releases/v*/...`, `*-candidate/...`, 게임명 ZIP, `<UPDATE_TITLE_ID>.zip`
- `romfs/<패치파일>`처럼 BASE_TITLE_ID root가 빠진 ZIP entry

## 절차

1. **Preflight**
   - 플랫폼이 NSW인지, 프로젝트 디렉터리명·`PROJECT.md`·LayeredFS 경로의
     `BASE_TITLE_ID`가 exact 일치하는지 확인한다.
   - canonical RomFS가 존재하고 실제 패치 파일이 하나 이상인지 확인한다.
   - 원본/키/금지 payload, link/reparse point, 다른 Title ID staging이 하나라도 있으면
     `BLOCKED`로 중단한다. 임의 후보 폴더에서 파일을 복구하거나 추측해 패키징하지 않는다.

2. **생성**
   - `$GT_HOME`에서 아래 공용 생성기만 실행한다. 처음에는 `--replace`를 붙이지 않는다.

     ```text
     npm run release:package:nsw -- --project-root "<타이틀 루트>/_work/<BASE_TITLE_ID>"
     ```

   - 기존 canonical ZIP과 입력이 byte-identical이면 생성기가 이를 재사용한다.
   - 기존 ZIP의 bytes가 다르면 자동 덮어쓰지 않는다. 기존
     `RELEASE_PACKAGE.json`·`SHA256SUMS.txt`와 현재 RomFS 차이를 확인하고 `HANDOFF.md`에
     기록한다. 사용자의 현재 빌드/패치 생성 요청 범위 안에서 교체가 맞다는 근거가
     확인된 경우에만 다음을 실행한다.

     ```text
     npm run release:package:nsw -- --project-root "<타이틀 루트>/_work/<BASE_TITLE_ID>" --replace
     ```

3. **독립 검증**
   - 생성 직후 반드시 공용 검증기를 별도로 실행한다.

     ```text
     npm run release:validate:nsw -- --project-root "<타이틀 루트>/_work/<BASE_TITLE_ID>"
     ```

   - ZIP entry 전수 목록, CRC-32, SHA-256, canonical RomFS bytes, `RELEASE_PACKAGE.json`,
     `SHA256SUMS.txt`가 일치해야 한다.
   - `40_build/releases/` 아래 다른 `.zip`이나 version/candidate 하위 ZIP이 있으면 이를
     별도 산출물로 인정하지 않는다. 경로와 해시를 보고하고 canonical 선택이 모호하면
     `BLOCKED`로 남긴다. 사용자의 명시적 정리 승인 없이 삭제하지 않는다.

4. **기록과 인계**
   - 실행 명령, BASE_TITLE_ID, 입력/ZIP 경로, entry 수, SHA-256, 검증 결과,
     reused/replaced 여부를 `WORK_LOG.md`와 `HANDOFF.md`에 기록한다.
   - QA/정식 릴리스 게이트가 끝나지 않았으면 `release_status`를 변경하지 않고
     `review_candidate`라고 명시한다.
   - 정식 릴리스 흐름이면 `gt-release`에 canonical ZIP과 검증 receipt를 인계한다.

## 완료 기준

- [ ] 산출물이 정확히 `40_build/releases/<BASE_TITLE_ID>.zip`
- [ ] 모든 ZIP entry가 `<BASE_TITLE_ID>/romfs/<패치파일>` 아래에 있음
- [ ] `apply_patch.py`, `*.gldelta`, NSP/XCI/keys, 원본 데이터, link가 없음
- [ ] `release:validate:nsw` PASS 및 manifest/hash 동기화
- [ ] 기존 noncanonical ZIP을 성공 산출물로 보고하거나 임의 삭제하지 않음
- [ ] `HANDOFF.md`에 패키징 증거와 남은 QA/릴리스 상태를 기록
- [ ] `gt-release` 게이트 전에는 `release_status=released`를 선언하지 않음
