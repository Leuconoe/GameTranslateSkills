---
name: gt-project-cleanup
description: "Archive exact cleanup candidates for one game title project, fully re-review and report them, then move separately approved files only to the recoverable operating-system Trash. Use when cleaning a title's _work project after QA/release or when stale session and duplicate artifacts are consuming storage."
---

# gt-project-cleanup — 타이틀 프로젝트 정리

하나의 `<타이틀 루트>/_work/<16자리 프로젝트 ID>`만 대상으로 Handoff·manifest·세션
상태를 추론한다. 정리는 `계획 → 아카이브 이동 → 전체 재검토·사용자 상세 보고 → 이후
별도 승인에 따른 운영체제 휴지통 이동` 순서로만 수행한다. 원래 위치나 아카이브의 파일을
영구 삭제하지 않는다.

## 읽기 순서와 보존 anchor

먼저 `$GT_HOME/common/SAFETY.md`, `project-structure.md`, `cleanup-contract.md`,
`qa-session-rules.md`와 프로젝트의 `PROJECT.md`, `WORK_LOG.md`, `HANDOFF.md`를 읽는다.
다음 항목은 참조가 줄어도 기본 보존한다.

```text
PROJECT.md / WORK_LOG.md / HANDOFF.md
00_source/ inventory
30_translation/ manifest·glossary·STYLE·분석·QA 보고서·폰트/이미지 보고서
40_build/ BUILD_MANIFEST.tsv·현재 staging·canonical release
50_test/ TEST_LOG.md·screenshots·logs·emucap 증거
50_test/eden/SESSION.json·ARTIFACT_MANIFEST.tsv
90_tools/ 재현 스크립트·환경 선언·cleanup-archive
```

Handoff의 `open` evidence, manifest가 참조하는 파일, 현재 active session이 사용하는
파일은 후보로 만들지 않는다. `applied`/`rejected`도 참조·해시 재확인 전에는 보존하거나
`WARN`으로 둔다.

## 1. 정리 계획 생성

1. 프로젝트 경로가 정확한 `_work/<16-hex>`인지 확인하고 다른 프로젝트를 순회하지 않는다.
2. `SESSION.json`과 remote 상태를 비교한다. active/pending/소유권 불명 세션의 파일은
   `BLOCKED`로 둔다. 이전 세션은 `last_session_id`와 `remote_close_session_id`가 exact
   일치하기 전까지 승인하지 않는다.
3. `ARTIFACT_MANIFEST.tsv`, Handoff, PROJECT, WORK_LOG, QA·릴리스 문서와 파일 해시를
   대조해 exact 파일 후보와 보존 anchor를 나눈다. 디렉터리·glob은 승인하지 않는다.
4. 다음 명령으로 canonical 계획과 지시서를 생성한다.

   ```text
   npm run project:cleanup -- --project-root "<프로젝트 루트>"
   ```

   이 명령은 `90_tools/CLEANUP_PLAN.json`과 `CLEANUP_INSTRUCTIONS.md`만 갱신하며 파일을
   이동하거나 삭제하지 않는다. 모든 후보는 기본 `approved=false`다.

## 2. 승인 후보 아카이브

사용자가 정리 범위를 승인하면 지시서의 exact 파일만 `approved=true`로 바꾸고 현재 plan
SHA-256과 함께 다음을 실행한다.

```text
npm run project:cleanup -- --project-root "<프로젝트 루트>" --plan "<CLEANUP_PLAN.json>" --apply --plan-sha256 "<SHA-256>"
```

`--apply`는 삭제 옵션이 아니다. 각 파일을 프로젝트의
`90_tools/cleanup-archive/<transaction>/files/`로 복사하고 원본·사본 SHA-256과 크기를
검증한 뒤 원래 위치에서 이동 처리한다. 이어서 다음 증거를 만든다.

- `ARCHIVE_MANIFEST.json`: 원래 경로, 아카이브 경로, 크기, SHA-256
- `CLEANUP_ARCHIVE_REVIEW.md`: 아카이브 무결성, 원래 위치 부재, Handoff·세션·보존
  anchor·남은 후보를 다시 조사한 상세 보고서
- `TRASH_PLAN.json`: 휴지통 이동을 위한 별도 계획. 모든 승인 필드는 기본 `false`

아카이브 경로는 후속 cleanup inventory에서 보존 영역으로 취급한다. 아카이브가 완전한
복구본임을 증명하지 못하면 `BLOCKED`로 중단하고 삭제 단계로 이동하지 않는다.

## 3. 전체 재검토와 사용자 상세 보고

아카이브 후 전체 프로젝트를 다시 inventory하고 문서 해시, Handoff 상태, 세션 상태,
보존 경로, 남은 후보, 원래 위치 부재, 아카이브 파일의 크기·SHA-256을 전수 확인한다.
상태가 바뀌었거나 재검토가 필요하면 다음 명령을 사용한다.

```text
npm run project:cleanup -- --project-root "<프로젝트 루트>" --review-archive --archive-manifest "<ARCHIVE_MANIFEST.json>" --archive-manifest-sha256 "<SHA-256>"
```

재검토는 `CLEANUP_ARCHIVE_REVIEW.md`와 `TRASH_PLAN.json`을 다시 만들며 모든 휴지통 이동 승인을
초기화한다. 보고서의 파일별 원래/아카이브 경로·크기·해시, 차단 항목, 남은 후보, 복원
방법을 사용자에게 상세히 보고한 뒤 현재 turn을 종료한다. 같은 사용자 요청/turn에서
아카이브와 휴지통 이동을 연속 실행하지 않는다.

## 4. 별도 승인 후 휴지통 이동

사용자가 상세 보고를 받은 뒤 **새로운 명시적 요청으로** 아카이브 파일의 휴지통 이동을 승인한
경우에만 진행한다. 에이전트가 승인 의사를 추론하거나 미리 표시하지 않는다.

1. `TRASH_PLAN.json`의 `review_reported_to_user=true`, `user_trash_approval=true`를
   기록하고 모든 exact 항목을 다시 확인해 각 `approved=true`로 바꾼다.
2. 현재 trash-plan SHA-256을 계산한다.
3. 다음 명령만 사용한다. `Remove-Item`, `rm`, glob, 재귀 삭제나 영구 삭제 API로 우회하지 않는다.

   ```text
   npm run project:cleanup -- --project-root "<프로젝트 루트>" --trash --trash-plan "<TRASH_PLAN.json>" --trash-plan-sha256 "<SHA-256>" --user-confirmed-trash
   ```

`--trash`는 승인된 아카이브 exact 파일만 Windows 휴지통, macOS 휴지통 또는 Linux GIO
휴지통으로 보낸다. 휴지통을 지원하지 않는 볼륨·플랫폼이거나 명령이 실패하면 파일을
그대로 보존하고 `BLOCKED`로 중단하며 영구 삭제로 폴백하지 않는다. 보고 이후 프로젝트
상태·문서·아카이브 해시가 바뀌면 거부하고 3단계부터 다시 수행한다. 완료 후
`TRASH_RECEIPT.json`의 backend·원래 아카이브 경로·개수·해시·복구 지침을 보고하고
`project:validate -- --strict`를 재실행한다. 예전 `--purge`와 `DELETE_PLAN.json`은 호환
입력일 뿐이며 실행 결과는 동일한 휴지통 이동이다.

## 완료 기준

- [ ] 기본 실행은 파일 이동·삭제 없이 계획만 생성함
- [ ] `--apply`는 exact 승인 파일을 아카이브하고 영구 삭제 0건을 보고함
- [ ] 아카이브 전체와 프로젝트 전체를 다시 검사한 상세 보고서가 생성됨
- [ ] 상세 보고를 사용자에게 전달한 뒤 같은 turn에서 멈춤
- [ ] 휴지통 이동은 이후 사용자의 별도 명시적 승인과 현재 trash-plan SHA-256으로만 수행됨
- [ ] 변경 감지 시 휴지통 이동 승인이 초기화되고 재검토됨
- [ ] 승인 파일은 영구 삭제되지 않고 복구 가능한 운영체제 휴지통으로만 이동함
- [ ] 이동했다면 `TRASH_RECEIPT.json`과 backend·복구 경로·검증 결과가 남음
