# NSW 최종 산출물과 배포 패키징

> 출처: 실전 한글화 작업 노하우에서 일반화 이식 (2026-08)

## 전제

배포물은 사용자가 보유한 게임에 덮어쓰는 LayeredFS 파일을 담는다. 타이틀별 사용자가
전체 컨테이너 교체를 명시적으로 허용한 경우, 수정된 컨테이너 안의 원본과 동일한
멤버는 패키징 금지 사유로 삼지 않는다. 원본 NSP/XCI, 키, 펌웨어는 포함하지 않는다.

## 1. 최종 산출물 생성 방식

1. 각 프로젝트의 핸드오프 또는 빌드 문서에 **실제로 다시 실행할 수 있는 최종 생성 명령**을 기록한다. 깨끗한 입력 경로, staging 경로, 주입·재패킹 스크립트, 통합 순서, 검증 명령, 출력 경로를 생략하지 않는다.
2. 최종 통합 트리는 검증된 텍스트+폰트 LayeredFS를 깨끗하게 복제한 뒤, 각각 **독립 검증을 통과한** 이미지·매뉴얼 등의 번들만 덮어써서 만든다. 이전 통합 트리나 기존 ZIP을 다시 패치하지 않으며, 빌드 전 예상 파일 집합과 다른 stale 파일이 있으면 실패시킨다.
3. 하나의 릴리스 작업과 베이스 Title ID에서는 **패치 ZIP을 정확히 한 개만** 생성한다.
   - canonical 위치는 `<타이틀 루트>/_release/`이고(`_work/` 옆, 프로젝트 루트 `<타이틀 루트>/_work/<BASE_TITLE_ID>` 기준 `../../_release`) ZIP은 그 폴더 바로 아래에 둔다(버전·candidate 하위 폴더 금지). 프로젝트 경계 밖으로 쓰는 유일한 허용 위치이며 링크/정션이면 실패한다. `RELEASE_PACKAGE.json`의 `archive_path`는 타이틀 루트 기준 `_release/<파일명>`이다. `<BASE_TITLE_ID>`는 대문자 16자리 16진수다.
   - ZIP 이름은 기본 `<한국어 제목> - <BASE_TITLE_ID>.zip`이다(예: `지뢰계 마법소녀 사쿠라 - 01006D202294E000.zip`). 한국어 제목은 `--korean-title` → 타이틀 루트의 빈 한국어 라벨 폴더(`<타이틀 루트>/<한국어 제목>/`, `_work` 옆) → `PROJECT.md`의 `- Korean title:` 순서로 정하고, 어느 것도 없으면 패키징하지 않는다(fail closed). `[Title ID]` 표기·Windows 금지 문자(`\ / : * ? " < > |`)·제어 문자는 지우고 `~ ∬ ,` 같은 나머지 문자는 그대로 둔다. Title ID 접미사는 필수이며 검증기가 프로젝트 Title ID와 대조한다. 예전 `<BASE_TITLE_ID>.zip`은 `--legacy-name`을 명시할 때만 쓴다.
   - 같은 폴더에 `RELEASE_NOTES.md`, `INSTALL.md`(있으면), `SHA256SUMS.txt`, `RELEASE_PACKAGE.json`을 둔다. `--replace`로 교체된 이전 ZIP은 지우지 않고 `_release/superseded/`로 옮기며 이전 이름을 유지한다.
   - 예전 위치(`_work/<ID>/60_release/`, `_work/<ID>/40_build/releases/`)는 legacy로, 검증기가 `_release/`를 먼저 찾고 없을 때만 경고와 함께 읽는다. legacy 프로젝트는 다음 릴리스 때 `_release/`로 옮긴다.
   - 위 형식 외에 게임명·날짜·언어·버전·구성요소·준비 상태·진단용 접두사/접미사를 붙이지 않는다.
   - 표준형·SD-ready·텍스트 전용·폰트 전용·이미지 전용·진단용·단계별·루트 변형 ZIP을 병렬로 만들지 않는다. 중간·진단 빌드는 폴더와 보고서로만 유지한다.
   - 패키징 전에 SD 카드 루트에 바로 풀어 덮어쓰는 설치 방식을 확정하고, 검증된 canonical ZIP만 **원자적으로 교체**한다.
   - canonical ZIP은 프로젝트가 정한 최종 위치에 두며, 다른 전달·설치 폴더로의 복사·이동은 사용자의 선택이므로 자동 수행하지 않는다.
   - 여러 베이스 Title ID는 한 ZIP에 합치지 않고 Title ID별로 별도 생성한다.
4. ZIP의 유일한 최상위 루트는 `atmosphere/`다. RomFS 패치 파일 `data/foo.bin`은
   `atmosphere/contents/<BASE_TITLE_ID>/romfs/data/foo.bin`, 선택적 ExeFS 교체 파일은
   `atmosphere/contents/<BASE_TITLE_ID>/exefs/main`이어야 한다. ZIP 파일명은
   기본 `<한국어 제목> - <BASE_TITLE_ID>.zip`이며, SD 카드 루트에 압축을 풀어 한 번에 덮어쓴다.
   Eden에는 ZIP의 `contents/<BASE_TITLE_ID>/` 아래 `romfs`와 `exefs`를 한 모드 폴더에 복사한다.
   최상위 `romfs/`나 `<BASE_TITLE_ID>/`만 두거나, 게임명·버전·candidate 폴더를 루트에 두거나,
   별도 적용기와 delta 파일을 넣는 자체 포맷은 NSW canonical 빌드가 아니다.
5. 패키징 도구는 다음을 **실패 조건**으로 검사한다.
   - 예상 번들/파일 수 불일치
   - 다른 Title ID 혼입 (0건이어야 함)
   - 깨끗한 원본과 비교한 내부 자산 identity 훼손
   - 타이틀에서 증명한 자산 ID↔외부 파일 매핑 위반 (원본에서 내부 identity와 외부 파일명이 원래 다르면 문자 동일성을 강제하지 말고 동일 외부 파일의 원본 identity 보존을 검증)
   - 수정된 컨테이너의 파싱·리로드 실패
   - 대상 변경 누락 또는 비대상 무결성 훼손
   - 필수 정적 QA 미통과
6. 생성 직후 단 하나의 정식 ZIP 파일명·크기·mtime·SHA-256을 다시 계산하고 `40_build/BUILD_MANIFEST.tsv`, `_release/SHA256SUMS.txt`, `_release/RELEASE_NOTES.md`, `50_test/TEST_LOG.md`에 **같은 값**을 기록한다. 현재 파일에서 다시 계산한 값만 유효하며 이전 해시는 폐기한다. 하드웨어 실행이 불가능하면 해당 항목만 `PENDING (hardware)`로 둘 수 있지만, 공식 사이트 배포용 릴리즈 에뮬레이터의 MCP 없는 직접 실행과 `RELEASE_RUNTIME_QA.json` 검증은 생략할 수 없다.

## 2. 패키징 강제 규칙 (재발 방지)

- 사용자가 **“빌드 생성”** 또는 **“패치 생성”**을 요청하면 NSW에서는 후보 폴더·delta
  생성이 아니라 canonical LayeredFS 패키징 요청으로 해석한다. 최종 입력을 먼저
  `40_build/layeredfs/<BASE_TITLE_ID>/romfs/` 및 선택적 `exefs/main`에 확정한 다음 아래 공용 명령을 실행한다.

  ```text
  npm run release:package:nsw -- --project-root "<타이틀 루트>/_work/<BASE_TITLE_ID>" --replace
  npm run release:validate:nsw -- --project-root "<타이틀 루트>/_work/<BASE_TITLE_ID>"
  ```

  결과는 오직 `<타이틀 루트>/_release/<한국어 제목> - <BASE_TITLE_ID>.zip`이며 ZIP 내부는
  `atmosphere/contents/<BASE_TITLE_ID>/romfs/<패치파일>`와 선택적 `atmosphere/contents/<BASE_TITLE_ID>/exefs/main`이다. `--replace`는 기존 canonical ZIP의 현재 hash를
  확인하고 새 ZIP 전수 검증이 끝난 뒤 원자 교체할 때만 사용한다.
- 공용 패키저는 프로젝트 폴더명·요청 Title ID·LayeredFS 폴더의 Title ID가 exact 일치하지
  않거나, 패치 파일이 0개이거나, link/reparse path·NSP/XCI·키·`*.gldelta`·별도 패처가
  섞이면 실패해야 한다. 생성 후 ZIP을 다시 열어 모든 entry의 경로·크기·CRC-32·SHA-256을
  원본 canonical RomFS/ExeFS와 전수 비교한다.
- ZIP > 4 GiB uses Zip64; standard extractors (Windows 10+ Explorer, 7-Zip, unzip 6.0) support it.
  공용 패키저는 크기·오프셋이 `0xFFFFFFFF` 이상인 entry에만 Zip64 extra(0x0001, version-needed 45)를,
  EOCD 필드가 넘칠 때만 Zip64 EOCD record+locator를 쓴다(APPNOTE 4.5). 4 GiB 미만 ZIP은 이전과 바이트 동일하며,
  검증기는 Zip64 크기·오프셋·EOCD64를 읽어 같은 entry 수·크기·CRC-32·SHA-256 검사를 한다.
- 콘솔은 ZIP을 읽지 않으므로 Zip64는 압축을 푸는 PC에서만 의미가 있다. 그러나 4 GiB 이상인 LayeredFS 파일은
  FAT32 SD 카드에 저장할 수 없으므로, 그런 릴리스는 `RELEASE_NOTES.md` 주의사항에 SD 카드가 exFAT여야 함을 적는다
  (예: `- SD 카드가 exFAT 형식이어야 함 (4GB를 넘는 파일 포함, FAT32 불가)`). 패키저·검증기는 4 GiB 이상 entry가 있는데
  ZIP 옆 `RELEASE_NOTES.md`에 `exFAT` 언급이 없으면 `WARNING`을 출력한다.

- **최종 패키징은 문서가 아니라 빌드 스크립트의 출력명부터 canonical 규칙과 맞춘다.** 스크립트가 임시 통합명을 만들고 사람이 나중에 이름만 바꾸는 흐름은 매니페스트·README·해시 불일치를 만든다. 스크립트가 처음부터 정해진 이름(기본 `<한국어 제목> - <BASE_TITLE_ID>.zip`)을 원자적으로 생성하게 하고, 릴리스 파일명이 그 이름과 다르면 즉시 실패시킨다. 이름 형식을 바꿀 때 다른 형식의 같은 Title ID ZIP이 있으면 bytes가 같을 때만 새 이름으로 바꿔 재사용하고, 다르면 `--replace` 없이는 교체하지 않는다. 정확한 파일 allowlist·ZIP root·리로드를 검사한 뒤 현재 SHA-256을 모든 릴리스 기록에 동기화한다.
- **canonical 파일명 규칙은 빌드 불변조건이다.** 빌드·릴리스 검증기는 실제 경로·basename·확장자·대소문자가 규칙과 다르면 실패하고, 임의 접두사/접미사, 중복 확장자, 빌드 뒤 수동 이름 변경, 진단·후보 ZIP의 릴리스 전달을 거부해야 한다.
- **여러 하위 시스템을 합친 최종 트리는 exact allowlist로 다시 검증한다.** 폰트·문자열·이미지 verifier가 혼합 디렉터리를 검사할 때 "추가 파일 허용"을 임의 파일 허용으로 구현하지 말고, 다른 하위 시스템의 이미 검증된 파일명 집합만 허용한다. 대상 집합 간 중복 경로 0, 누락·미등록 파일 0을 확인하고, 깨끗한 입력에서 **두 번 조립해 파일별·ZIP SHA-256 결정성**을 증명한 뒤 ZIP을 다시 열어 정렬된 `atmosphere/contents/<BASE_TITLE_ID>/{romfs,exefs}/` entry와 payload를 전수 대조한다.
- **공식 배포 릴리즈 런타임 증거가 생긴 뒤에만 릴리스 상태를 동기화한다.** 컴파일 성공,
  ZIP 재로드, Eden/Ryubing MCP smoke는 런타임 PASS가 아니다. `runtime-emulators.json`에 등록된
  공식 release의 바이너리를 직접 실행해 URL·버전·binary hash, 입력 build, Title ID, 활성
  mod 전수 hash, 애플리케이션 로드, 수정 경로별 스크린샷·로그를 보존하고
  `npm run runtime:validate`를 통과한 뒤 릴리스 보고서와 checksum을 갱신한다.

## 3. 릴리스 버전 관리

- 패치 릴리스 버전은 **canonical ZIP 파일명과 분리된 원장**에서 관리한다. 버전이 필요한 프로젝트는 `vMAJOR.MINOR.PATCH`, 날짜, build ID, canonical 파일, 크기, 현재 SHA-256, 에뮬레이터·실기 상태를 `40_build/RELEASE_VERSION.tsv`(또는 동등한 단일 원장)에 기록한다. canonical 파일명에는 버전 접두사·접미사를 붙이지 않는다.
- payload가 바뀌면 버전을 올리고, 깨끗한 입력에서 같은 경로로 **두 번 결정론적 빌드**를 수행한 뒤 현재 파일의 해시를 매니페스트·체크섬·설치 문서·시험 로그·핸드오프에 동기화한다.
- 문서만 바꾸거나 이전 해시를 재사용해 새 버전을 선언하지 않는다.

## 4. 완료 기준

릴리스로 인정하기 전에 다음을 모두 충족한다.

- 화면에 보이는 모든 텍스트 종류의 담당 파일과 상태가 확인됨
- 제어 코드와 자리표시자 검증 통과
- 용어집 표기 통일
- 일반·소형·선택·비활성·루비 글자에서 한글 정상 표시
- 존재하는 타이틀 화면, 설정, 저장·불러오기, 백로그, 시나리오, 매뉴얼·튜토리얼, 엔딩 경로를 **실제 항목 선택부터 번역 콘텐츠 표시와 완료·복귀까지** 시험 완료
- 최종 LayeredFS 트리에 대상 Title ID 파일만 존재
- 공식 사이트 배포용 릴리즈 에뮬레이터를 MCP 없이 직접 실행한 canonical receipt가 현재
  binary/build/mod/evidence hash로 검증되고 `qa_status=passed`
- 릴리스 ZIP을 제거했을 때 다른 게임과 원본 실행에 영향이 없음 (패치는 원본을 변경하지 않는 overlay여야 함)
- canonical ZIP의 이름이 `<BASE_TITLE_ID>.zip`(요청 시 `<게임 제목> - <BASE_TITLE_ID>.zip`)이고 모든 entry가
  `atmosphere/contents/<BASE_TITLE_ID>/romfs/<패치파일>` 또는 선택적 `atmosphere/contents/<BASE_TITLE_ID>/exefs/main`이며 별도 패처·delta·키·NSP/XCI가 없음
- 완료 후 프로젝트 `_work` 아래 `tmp-*`, `tmp_*`, `*.tmp` 후보를 dry-run으로 확인하고, 불필요한 항목만 명시적 allowlist로 정리한 뒤 후보 0건과 `project:validate -- --strict` 결과를 `WORK_LOG.md`에 기록

## 3. 릴리스 스크린샷

- `_release/screenshots/`에는 대표 런타임 캡처 몇 장(보통 4~6장)만 둔다. `50_test` 증거(예: `50_test/eden/captures_*`)에서 **복사**하고 이동하지 않는다. 원본 증거와 해시는 `50_test`에 그대로 남는다.
- 고르는 장면: ① 타이틀 화면 ② 첫 한국어 대사 ③ 메인 메뉴/옵션 ④ 저장·불러오기 또는 다른 핵심 UI ⑤ (있으면) 한국어화한 이미지(로고 등).
- 최종 빌드에서 찍은 캡처만 쓴다. 넣기 전에 이미지를 직접 열어 검은 화면·로딩 화면·다른 빌드 캡처가 아닌지 확인한다.
- 파일명은 `NN_<what>.png`(예: `01_title.png`, `02_dialogue.png`, `03_menu.png`, `04_saveload.png`, `05_logo.png`).
- `RELEASE_NOTES.md`의 `스크린샷` 절에서 파일 목록을 참조할 수 있다.
