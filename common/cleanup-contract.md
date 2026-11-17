# Handoff 기반 정리·청결화 계약

정리는 파일명이 `tmp`인지 여부만으로 결정하지 않는다. 프로젝트의 `HANDOFF.md`,
`PROJECT.md`, `WORK_LOG.md`, canonical manifest, 활성 세션 상태와 파일 해시를 함께 읽는다.
export·번역 중간물·테스트 산출물/스크립트는
[`artifact-layout-contract.md`](artifact-layout-contract.md)와
`90_tools/PROJECT_ARTIFACT_MANIFEST.tsv`의 lifecycle을 추가로 읽는다. `canonical`·`evidence`는
보존 anchor이며, `reproducible`·`disposable` 중 현재 hash가 일치하는 exact 파일만 후보가
될 수 있다. managed root의 미등록 파일은 자동 삭제하지 않고 `BLOCKED`로 보고한다.
모든 정리는 다음 상태 전이만 허용한다.

```text
PLAN (이동·삭제 0건)
  → ARCHIVED (승인 파일을 복구 가능한 아카이브로 이동, 영구 삭제 0건)
  → REVIEWED_AND_REPORTED (전체 재검토 결과를 사용자에게 상세 보고하고 turn 종료)
  → TRASHED_RECOVERABLE (이후 별도 사용자 승인으로 아카이브 exact 파일만 OS 휴지통 이동)
```

`PLAN`에서 `TRASHED_RECOVERABLE`로 바로 진행하거나 같은 사용자 요청/turn에서 `ARCHIVED`와
`TRASHED_RECOVERABLE`을 연속 실행하지 않는다. 이 계약의 기본 흐름에는 영구 삭제 상태가 없다.
예외는 §6 **완료 타이틀 최종 정리**에서 사용자가 처리 방식을 명시적으로 고른 경우뿐이다.

## 1. 계획

1. 대상 루트와 프로젝트를 literal 절대 경로로 확정하고 `git status`, 활성 프로세스,
   Eden-MCP/Ryubing-MCP 양쪽 remote inventory와 공유 local 상태를 읽는다.
2. `HANDOFF.md`의 `open` evidence는 보존 anchor로 취급한다. `applied`·`rejected`도
   manifest·로그가 더 이상 참조하지 않는지 확인하기 전에는 후보로 승격하지 않는다.
3. PROJECT/WORK_LOG/manifest/QA/릴리스 문서와 canonical 파일을 보존한다. 참조 불일치는
   삭제로 해결하지 않고 `BLOCKED` 또는 `WARN`으로 기록한다.
4. 세션·런 아티팩트는 소유권·해시와 exact remote close를 증명한 경우에만 후보로 만든다.
5. 중복 이름·동일 basename·`tmp`·`copy` 패턴은 근거 하나일 뿐이다. 문서 참조, logical
   key, 해시, 현재 사용 여부를 함께 확인한다.
6. 기본 실행은 파일을 이동하거나 삭제하지 않고 `CLEANUP_PLAN.json`과
   `CLEANUP_INSTRUCTIONS.md`를 만든다. 후보에는 exact 경로, 종류, 크기, SHA-256, 이유,
   위험도, 차단 조건, `approved=false`를 기록한다.

## 2. 아카이브 적용

사용자가 계획의 exact 파일 범위를 승인한 경우에만 해당 항목을 `approved=true`로 표시하고
현재 plan SHA-256과 `--apply --plan`을 사용한다. `--apply`는 영구 삭제가 아니라 다음
아카이브 동작이다.

1. 원본 파일의 크기와 SHA-256을 계획의 현재 값과 다시 비교한다.
2. 프로젝트 정리는 프로젝트 내부 `90_tools/cleanup-archive/<transaction>/files/`에,
   작업장 정리는 작업장 밖 계획 파일 옆
   `workspace-cleanup-archive/<transaction>/files/`에 동일 상대경로로 복사한다.
3. 아카이브 사본의 크기·SHA-256을 원본과 exact 비교한다.
4. 검증된 사본이 있을 때만 원래 위치에서 이동 처리한다. 실패하면 원본 또는 검증된 사본을
   보존하고 transaction을 `blocked`로 남긴다.
5. `ARCHIVE_MANIFEST.json`에 원래 경로, 아카이브 경로, 크기, SHA-256, 상태를 기록한다.

아카이브 transaction과 그 manifest·보고서·trash plan은 보존 anchor다. 일반 cleanup
inventory나 glob 정리의 후보로 다시 넣지 않는다.

## 3. 전체 재검토와 상세 보고

아카이브 직후 다음 범위를 처음부터 다시 조사한다.

- 아카이브 manifest의 모든 파일: 존재, regular file 여부, 크기, SHA-256
- 모든 원래 경로: 이동 완료 여부와 예상치 않은 재생성 여부
- Handoff 상태와 evidence, PROJECT/WORK_LOG/manifest/QA/릴리스 문서 해시
- local/remote 세션 소유권·상태, 보존 anchor, 남은 cleanup 후보와 차단 항목
- 작업장 정리라면 전체 프로젝트 목록, 중복 Title ID, active/pending 세션

결과를 `CLEANUP_ARCHIVE_REVIEW.md`에 파일별 원래/아카이브 경로·크기·해시와 함께 기록하고
`TRASH_PLAN.json`을 생성한다. trash plan의
`review_reported_to_user`, `user_trash_approval`, 모든 항목의 `approved`는 `false`다.

에이전트는 상세 보고서의 경로·해시, 이동 파일 전수 목록, 총 개수·크기, 재검토 결과,
남은 후보·차단 항목, 아카이브 복원 방법, 영구 삭제 0건을 사용자에게 보고하고 현재 turn을
종료한다. 보고 뒤 상태가 바뀌면 `--review-archive`로 다시 전수 검토하며 휴지통 이동 승인을
모두 초기화한다.

## 4. 이후 별도 사용자 승인에 따른 휴지통 이동

상세 보고 이후 사용자가 새로운 명시적 요청으로 아카이브 파일의 휴지통 이동을 승인한 경우에만 다음을 모두
충족시킨다.

1. `TRASH_PLAN.json`의 `review_reported_to_user=true`와
   `user_trash_approval=true`를 기록한다.
2. manifest의 모든 exact 항목을 다시 읽고 각 `approved=true`로 개별 승인한다.
3. 현재 trash-plan SHA-256과 `--trash --trash-plan --user-confirmed-trash`를 사용한다.
4. CLI가 archive manifest·review report 해시, 원본 위치 부재, 모든 아카이브 파일 해시,
   전체 cleanup 범위 fingerprint가 보고 시점과 같은지 재검증하게 한다.

검증 중 하나라도 다르면 휴지통 이동을 거부하고 전체 재검토·사용자 상세 보고부터 반복한다.
Windows에서는 `SendToRecycleBin`, macOS에서는 Finder 휴지통, Linux에서는 GIO Trash를
사용한다. 지원되지 않는 볼륨·플랫폼·도구이거나 처리에 실패하면 exact 파일을 제자리에
보존하고 `BLOCKED`로 중단한다. 직접 `rm`, `Remove-Item`, glob, 재귀 삭제나 영구 삭제 API로
우회하거나 휴지통 실패를 영구 삭제로 폴백하지 않는다. 완료하면 `TRASH_RECEIPT.json`에
backend, 원래 아카이브 경로, 시각, 복구 지침, `permanent_deletions=0`을 남긴다.

예전 `--purge`, `--delete-plan`, `--delete-plan-sha256`, `--user-confirmed-delete`와
`DELETE_PLAN.json`은 이전 transaction을 위한 호환 입력이다. 이 경로도 영구 삭제하지 않고
동일한 운영체제 휴지통으로만 이동한다.

## 5. 복원과 보존 우선 목록

사용자가 휴지통 이동 전 복원을 요청하면 아카이브 파일을 manifest의 원래 경로로 되돌리고
크기·SHA-256을 재검증한다. 휴지통 이동 후라면 먼저 운영체제 휴지통에서 receipt의
`original_archive_path`로 복원한 다음 manifest에 따라 원래 작업 경로로 되돌린다. 어느
단계든 목적지에 새 파일이 생겼으면 덮어쓰지 않고 `BLOCKED`로 보고한다.

다음은 기본 보존한다: `PROJECT.md`, `WORK_LOG.md`, `HANDOFF.md`, 원본 inventory, 번역
manifest·용어집·스타일, font/image/text QA 보고서, build/release manifest, 릴리스 패키지,
`50_test/TEST_LOG.md`, canonical `SESSION.json`·`ARTIFACT_MANIFEST.tsv`, 현재 staging,
런타임 증거, 모든 cleanup archive·review·receipt 증거.

## 6. 완료 타이틀 최종 정리 (사용자 선택 모드)

사용자가 "완료한 게임은 최종 패치만 남기고 반복 작업을 정리"처럼 여러 완료 타이틀을 한 번에
정리하라고 요청하면 이 절을 따른다. 실제 완료 프로젝트 36개를 정리하며 확인한 내용이다.

### 6.1 먼저 사용자에게 물을 것 (한 번에 묻는다)

| 질문 | 권장 기본값 |
|---|---|
| 남길 범위 | **재현 가능 최소셋**: 루트 문서, `00_source`, `20_reference`, canonical 릴리스 ZIP과 그 기록, 최종 payload 트리, 번역 소스(manifest·glossary·STYLE·최종 이미지·폰트), 스크립트·환경, 최종 QA 캡처·로그 |
| `10_extract` | 정리(원본 NSP/XCI에서 재추출 가능). 5MB 이하 텍스트 inventory는 남김 |
| 처리 방식 | 승인 후 OS 휴지통으로 바로 이동(같은 볼륨은 rename이라 임시 공간 불필요). 표준 아카이브 절차, 영구 삭제도 선택지로 제시 |
| 휴지통 한도 초과분 | 사용자가 정한다(이번 사례: 초과분은 영구 삭제) |
| 핸드오프 | 프로젝트 루트 `FINAL_HANDOFF.md`(기존 append-only `HANDOFF.md`는 보존) |

보호 타이틀(AGENTS.md 등)과 프로젝트 밖 형제 폴더(오타 Title ID 폴더, 중첩 폴더, 예전 경로 사본,
타이틀 루트의 에뮬레이터 프로필)는 따로 묻는다.

### 6.2 계획: 자동 계획기 + 타이틀별 판단

`project:cleanup` 계획기는 이름 중복 같은 작은 후보만 잡고 공간 대부분을 차지하는 반복 작업
(후보 빌드 staging, 시험마다 복사한 payload·에뮬레이터 프로필·NAND, 이전 회차 work 캐시)은
놓친다. 그래서 타이틀마다 문서를 읽어 최종본을 확정하고 다음 세 파일을 만든다(읽기 전용 분석,
타이틀별로 병렬 가능).

- `FINAL_HANDOFF.md`: 요약, 최종 패치(경로·크기·SHA-256·ZIP 구조·설치·언어 설정), 번역 범위,
  재현·수정 방법(재추출 명령 포함), 검증 기록, 알려진 한계, 작업 이력, 정리 계획, 재개 지점
- `90_tools/cleanup/FINAL_CLEANUP_PLAN_<날짜>.tsv`: `action path kind files bytes reason`.
  모든 파일이 정리 대상인 폴더는 폴더 한 줄로 쓰되, 보존 항목을 품은 폴더는 쓰지 않는다
- `90_tools/cleanup/FINAL_KEEP_<날짜>.tsv`: 보존한 주요 항목과 크기

최종 ZIP은 문서의 SHA-256과 다시 계산한 값이 같아야 한다. 판단이 갈리면 보존하고 "확인 필요"로 보고한다.

### 6.3 실행 전 검증 (하나라도 걸리면 그 프로젝트 전체를 건너뜀)

- 경로가 프로젝트 안이고 `..`가 없으며 실제로 존재하고 종류(file/dir)가 맞는다.
- 항목 자체·상위·내부 어디에도 junction/symlink가 없다. 다른 위치(예: 사용자 Ryujinx 폴더)를
  가리키는 링크가 있는 폴더는 계획에서 빼고 보고한다.
- 보존 항목이거나 보존 항목을 품은 경로가 아니고, 항목끼리 중첩되지 않는다.
- 현재 파일 수·바이트가 계획과 같다(분석 뒤 바뀌었으면 재분석).
- 패키지(NSP/XCI/NSZ/XCZ)와 티켓(`.tik`): 원본은 타이틀 폴더 최상위에 있고 `_work` 안의 것은 추출·QA용
  **사본**이다. 사용자 승인 범위에서 `_work` 안의 사본은 정리할 수 있되, **타이틀 최상위에 원본 패키지가
  남아 있을 때만** 허용한다. 최상위 원본과 `_work` 밖 패키지는 항상 보호한다. 원본이 없으면 멈추고 묻는다.
- `*.keys`는 프로비저닝된 원본 키(예: `%APPDATA%/eden/keys`)와 hash가 같은 **사본**일 때만 허용한다.
  원본과 다른 키(예: 마스터에 없는 title key가 든 `title.keys`)는 지우기 전에 사용자에게 묻고, 보존을
  고르면 정리 대상이 아닌 `_work/<TID>/90_tools/private_keys/`에 1부를 복사·hash 대조한 뒤 나머지를 정리한다.
  키 내용은 출력·기록하지 않는다.
- 실행기는 한 번에 하나만 돈다(잠금 파일, 실제 실행 중인지까지 확인). 하드디스크에서 두 정리를 동시에 돌리면
  탐색이 겹쳐 크게 느려진다. 중간에 끊겨도 영수증(`FINAL_TRASH_RECEIPT`)을 기준으로 이미 지운 항목을
  건너뛰고 이어서 실행한다.
- 삭제는 백그라운드 I/O 우선순위의 실행기 프로세스 안에서 하고 일정 건수마다 잠깐 쉰다. `rd /s /q` 같은
  자식 프로세스는 우선순위가 이어지지 않아 HDD를 포화시키고, 부모만 종료하면 계속 지운다.
- 사용자가 중단을 요청하면 실행기의 **프로세스 트리 전체**(`taskkill /T /F /PID <pid>`)를 종료하고,
  남은 자식 프로세스가 없는지 확인한 뒤 중단됐다고 보고한다.

### 6.4 휴지통 한도와 처리 순서

- 실행 전에 대상 드라이브의 휴지통 최대 용량과 현재 사용량을 확인한다. 한도를 넘는 항목은
  휴지통에 들어가지 못하고 영구 삭제되거나, 오래된 휴지통 항목이 자동으로 비워질 수 있다.
- 휴지통 예산은 `한도 × 0.95 − 현재 사용량`으로 잡는다. 다시 만들기 어려운 항목부터 휴지통에 넣고,
  넘치는 분량은 사용자가 정한 방식으로 처리한다. 영구 삭제를 골랐다면 원본에서 재추출할 수 있는
  `10_extract`부터 영구 삭제한다.
- 항목마다 결과를 `90_tools/cleanup/FINAL_TRASH_RECEIPT_<날짜>.tsv`(`time path files bytes result`,
  result는 `recycled`/`deleted`/`FAILED ...`)에 남긴다.
- 끝나면 `FINAL_HANDOFF.md`에 실제 정리 결과(휴지통·영구 삭제 용량)를 덧붙이고, 기존 `HANDOFF.md`
  끝에 `FINAL_HANDOFF.md` 링크 한 줄을 추가한다.
- 타이틀 폴더 자체를 지우거나 이름을 바꾸면 `GAME_REGISTRY.tsv` 해당 행을 같은 작업에서 고치고
  (`removed; <날짜> <사유>` 또는 새 `release_folder`) `npm run registry:check`로 0 error를 확인한다.
