# Handoff 기반 정리·청결화 계약

정리는 파일명이 `tmp`인지 여부만으로 결정하지 않는다. 프로젝트의 `HANDOFF.md`,
`PROJECT.md`, `WORK_LOG.md`, canonical manifest, 활성 세션 상태와 파일 해시를 함께 읽는다.
모든 정리는 다음 상태 전이만 허용한다.

```text
PLAN (이동·삭제 0건)
  → ARCHIVED (승인 파일을 복구 가능한 아카이브로 이동, 영구 삭제 0건)
  → REVIEWED_AND_REPORTED (전체 재검토 결과를 사용자에게 상세 보고하고 turn 종료)
  → PURGED (이후 별도 사용자 승인으로 아카이브 exact 파일만 영구 삭제)
```

`PLAN`에서 `PURGED`로 바로 진행하거나 같은 사용자 요청/turn에서 `ARCHIVED`와 `PURGED`를
연속 실행하지 않는다.

## 1. 계획

1. 대상 루트와 프로젝트를 literal 절대 경로로 확정하고 `git status`, 활성 프로세스,
   Eden remote/local 상태를 읽는다.
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

아카이브 transaction과 그 manifest·보고서·delete plan은 보존 anchor다. 일반 cleanup
inventory나 glob 정리의 후보로 다시 넣지 않는다.

## 3. 전체 재검토와 상세 보고

아카이브 직후 다음 범위를 처음부터 다시 조사한다.

- 아카이브 manifest의 모든 파일: 존재, regular file 여부, 크기, SHA-256
- 모든 원래 경로: 이동 완료 여부와 예상치 않은 재생성 여부
- Handoff 상태와 evidence, PROJECT/WORK_LOG/manifest/QA/릴리스 문서 해시
- local/remote 세션 소유권·상태, 보존 anchor, 남은 cleanup 후보와 차단 항목
- 작업장 정리라면 전체 프로젝트 목록, 중복 Title ID, active/pending 세션

결과를 `CLEANUP_ARCHIVE_REVIEW.md`에 파일별 원래/아카이브 경로·크기·해시와 함께 기록하고
`DELETE_PLAN.json`을 생성한다. delete plan의
`review_reported_to_user`, `user_delete_approval`, 모든 항목의 `approved`는 `false`다.

에이전트는 상세 보고서의 경로·해시, 이동 파일 전수 목록, 총 개수·크기, 재검토 결과,
남은 후보·차단 항목, 복원 방법, 영구 삭제 0건을 사용자에게 보고하고 현재 turn을 종료한다.
보고 뒤 상태가 바뀌면 `--review-archive`로 다시 전수 검토하며 삭제 승인을 모두 초기화한다.

## 4. 이후 별도 사용자 승인에 따른 purge

상세 보고 이후 사용자가 새로운 명시적 요청으로 영구 삭제를 승인한 경우에만 다음을 모두
충족시킨다.

1. `DELETE_PLAN.json`의 `review_reported_to_user=true`와
   `user_delete_approval=true`를 기록한다.
2. manifest의 모든 exact 항목을 다시 읽고 각 `approved=true`로 개별 승인한다.
3. 현재 delete-plan SHA-256과 `--purge --delete-plan --user-confirmed-delete`를 사용한다.
4. CLI가 archive manifest·review report 해시, 원본 위치 부재, 모든 아카이브 파일 해시,
   전체 cleanup 범위 fingerprint가 보고 시점과 같은지 재검증하게 한다.

검증 중 하나라도 다르면 영구 삭제를 거부하고 전체 재검토·사용자 상세 보고부터 반복한다.
직접 `rm`, `Remove-Item`, glob, 재귀 삭제로 우회하지 않는다. purge는 원래 작업 트리가
아니라 아카이브 transaction의 exact 파일만 삭제하며 `PURGE_RECEIPT.json`을 남긴다.

## 5. 복원과 보존 우선 목록

사용자가 삭제를 승인하지 않거나 복원을 요청하면 아카이브 파일을 manifest의 원래 경로로
되돌리고 크기·SHA-256을 재검증한다. 원래 경로에 새 파일이 생겼으면 덮어쓰지 않고
`BLOCKED`로 보고한다.

다음은 기본 보존한다: `PROJECT.md`, `WORK_LOG.md`, `HANDOFF.md`, 원본 inventory, 번역
manifest·용어집·스타일, font/image/text QA 보고서, build/release manifest, 릴리스 패키지,
`50_test/TEST_LOG.md`, canonical `SESSION.json`·`ARTIFACT_MANIFEST.tsv`, 현재 staging,
런타임 증거, 모든 cleanup archive·review·receipt 증거.
