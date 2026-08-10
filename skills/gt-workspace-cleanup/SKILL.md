---
name: gt-workspace-cleanup
description: "Archive exact cleanup candidates from a game-translation workspace, fully re-review the archive and workspace state, report every result to the user, and permit permanent deletion only after a separate explicit approval. Use when reconciling title folders, unscoped root artifacts, stale sessions, or workspace storage growth."
---

# gt-workspace-cleanup — 작업장 루트 정리

작업장 루트의 타이틀 컨테이너·공용 도구·미등록 산출물·세션 잔재를 조사한다. 정리는
`계획 → 작업장 밖 아카이브 이동 → 전체 재검토·사용자 상세 보고 → 이후 별도 승인에 따른
아카이브 삭제` 순서로만 수행한다. 원래 위치의 후보를 즉시 영구 삭제하지 않는다.

## 필수 입력과 차단 조건

- 작업장 루트의 literal 절대 경로
- 각 프로젝트의 `PROJECT.md`, `WORK_LOG.md`, `HANDOFF.md`, canonical manifest
- `50_test/eden/SESSION.json`과 `ARTIFACT_MANIFEST.tsv`, remote 세션 상태
- active 프로세스와 `git status`
- `$GT_HOME/common/SAFETY.md`, `project-structure.md`, `cleanup-contract.md`

루트 경계와 `_title`/`_titles` 컨테이너를 확정하지 못하거나 계획·보고서·아카이브를
작업장 밖에 둘 수 없으면 이동하지 말고 `BLOCKED` 지시서만 만든다.

## 1. 계획 생성

1. 루트 직계 항목과 모든 `_work` 프로젝트를 inventory한다. 비정규 루트 폴더·복사본·
   세션 잔재는 이름만으로 판정하지 않는다.
2. 모든 Handoff의 `open` evidence와 PROJECT/WORK_LOG/manifest/QA/릴리스 참조를 보존
   anchor로 수집한다.
3. active/pending/소유권 불명 세션과 link/reparse point는 `BLOCKED`로 둔다. 파일만 exact
   후보로 만들며 디렉터리는 child-level 계획 없이는 승인하지 않는다.
4. 다음 명령으로 작업장 밖에 계획과 지시서를 만든다.

   ```text
   npm run workspace:cleanup -- --workspace-root "<루트>" --report "<외부 보고서 경로>"
   ```

   기본 실행은 외부 `CLEANUP_PLAN.json`과 `CLEANUP_INSTRUCTIONS.md`를 만들 뿐 이동·
   삭제하지 않으며 모든 후보는 `approved=false`다.

## 2. 승인 후보 아카이브

사용자가 정리 범위를 승인하면 exact 파일만 `approved=true`로 바꾸고 현재 plan SHA-256을
사용한다.

```text
npm run workspace:cleanup -- --workspace-root "<루트>" --plan "<외부 CLEANUP_PLAN.json>" --apply --plan-sha256 "<SHA-256>"
```

`--apply`는 계획 파일 옆 `workspace-cleanup-archive/<transaction>/files/`로 파일을 옮긴다.
원본·사본 SHA-256과 크기를 확인한 뒤에만 원래 위치에서 이동 처리하며 영구 삭제하지
않는다. 다음 파일을 작업장 밖 transaction에 생성한다.

- `ARCHIVE_MANIFEST.json`: 원래 경로, 아카이브 경로, 크기, SHA-256
- `CLEANUP_ARCHIVE_REVIEW.md`: 모든 프로젝트·Handoff·세션·Title ID·남은 루트 후보와
  아카이브 무결성을 다시 조사한 상세 보고서
- `DELETE_PLAN.json`: 영구 삭제용 별도 계획. 모든 승인 필드는 기본 `false`

## 3. 전체 재검토와 사용자 상세 보고

아카이브 후 작업장 전체를 다시 inventory하고 각 프로젝트 문서 해시, Handoff 상태,
active/pending 세션, 중복 Title ID, 남은 후보, 원래 위치 부재, 모든 아카이브 파일의
크기·SHA-256을 전수 확인한다. 상태가 바뀌면 다음 명령으로 다시 검토한다.

```text
npm run workspace:cleanup -- --workspace-root "<루트>" --review-archive --archive-manifest "<ARCHIVE_MANIFEST.json>" --archive-manifest-sha256 "<SHA-256>"
```

재검토는 상세 보고서와 delete plan을 다시 만들고 모든 삭제 승인을 초기화한다. 파일별
원래/아카이브 경로·크기·해시, 구조 문제, 차단 항목, 남은 후보, 복원 방법을 사용자에게
상세히 보고한 뒤 현재 turn을 종료한다. 같은 사용자 요청/turn에서 아카이브와 영구 삭제를
연속 실행하지 않는다.

## 4. 별도 승인 후 영구 삭제

사용자가 상세 보고를 받은 뒤 **새로운 명시적 요청으로** 아카이브 삭제를 승인한 경우에만
진행한다. `DELETE_PLAN.json`에 `review_reported_to_user=true`,
`user_delete_approval=true`, 모든 exact 항목의 `approved=true`를 기록하고 현재 해시로
다음을 실행한다.

```text
npm run workspace:cleanup -- --workspace-root "<루트>" --purge --delete-plan "<DELETE_PLAN.json>" --delete-plan-sha256 "<SHA-256>" --user-confirmed-delete
```

직접 `Remove-Item`, `rm`, glob, 재귀 삭제로 우회하지 않는다. `--purge`는 승인된 외부
아카이브 파일만 삭제한다. 보고 이후 작업장 상태·문서·아카이브 해시가 바뀌면 삭제를
거부하고 전체 재검토와 사용자 보고부터 다시 수행한다. 완료 후 `PURGE_RECEIPT.json`과
root/project 재inventory 결과를 보고한다.

## 완료 기준

- [ ] 기본 실행은 파일 이동·삭제 없이 계획만 생성함
- [ ] `--apply`는 exact 승인 파일을 작업장 밖 아카이브로 이동하고 영구 삭제 0건을 보고함
- [ ] 아카이브 전체와 작업장 전체의 재검토 상세 보고서가 생성됨
- [ ] 상세 보고를 사용자에게 전달한 뒤 같은 turn에서 멈춤
- [ ] 영구 삭제는 이후 사용자의 별도 명시적 승인과 현재 delete-plan SHA-256으로만 수행됨
- [ ] 변경 감지 시 삭제 승인이 초기화되고 재검토됨
- [ ] 삭제했다면 아카이브 exact 파일만 제거되고 receipt·재inventory 증거가 남음

정리 계획·아카이브·삭제는 프로젝트 완료나 릴리스 PASS를 의미하지 않는다.
