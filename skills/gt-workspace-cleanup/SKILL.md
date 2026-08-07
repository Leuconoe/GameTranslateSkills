---
name: gt-workspace-cleanup
description: "Generate a safe, Handoff-based cleanup plan for a game-translation workspace root, detect unscoped title/session/duplicate artifacts, and apply only an explicitly approved allowlist. Use when cleaning the root of NSW or another translation workspace, reconciling title folders, or investigating storage growth without deleting active project data."
---

# gt-workspace-cleanup — 작업장 루트 정리

작업장 루트의 타이틀 컨테이너·공용 도구·미등록 산출물·세션 잔재를 조사하고,
`HANDOFF.md`와 프로젝트 manifest를 근거로 정리 지시서를 만든다. 기본 동작은
읽기 전용 계획 생성이며, 계획에 명시적으로 승인된 경로만 적용한다.

## 필수 입력

- 작업장 루트의 literal 절대 경로
- 각 타이틀의 `_work/<프로젝트 ID>/PROJECT.md`, `WORK_LOG.md`, 존재하면 `HANDOFF.md`
- `50_test/eden/SESSION.json`과 `ARTIFACT_MANIFEST.tsv`의 local 상태
- active 프로세스·Eden remote 세션 상태와 `git status`
- `$GT_HOME/common/SAFETY.md`, `project-structure.md`, `cleanup-contract.md`

루트 경로가 실제 작업장인지, `_title`/`_titles` 컨테이너가 무엇인지 확정하지 못하면
정리하거나 이동하지 말고 `BLOCKED` 지시서만 만든다.

## 절차

1. 루트 직계 항목과 모든 `_work` 프로젝트를 inventory한다. 타이틀 ID 중복, 실제
   패키지가 없는 임의 `title` 폴더, `data`·`output`·`temp`·`romfs`·`sessions`·`runs`
   같은 비정규 루트 작업 폴더를 후보로 표시하되 즉시 삭제하지 않는다.
2. 모든 프로젝트의 Handoff에서 `open` evidence 경로를 추출하고, PROJECT/WORK_LOG/
   manifest/QA/릴리스 문서가 참조하는 경로를 보존 anchor로 수집한다.
3. 활성 세션 또는 소유권이 불명확한 세션은 삭제 후보에서 제외한다. `last_session_id`와
   `remote_close_session_id`가 exact 일치해 remote close가 증명된 이전 세션만
   `SESSION.json`의 수명주기와 대조해 정리 후보로 제시한다.
4. 동일 `artifact_key`, 동일 canonical logical name, 동일 해시, 중복 세션 파일·폴더,
   `(1)`·`copy`·timestamp 복사본을 관계·참조·해시와 함께 대조한다. 파일명 하나만으로
   중복이나 삭제 가능성을 확정하지 않는다.
5. `npm run workspace:cleanup -- --workspace-root "<루트>" --report "<계획 경로>"`를
   실행해 `CLEANUP_PLAN.json`과 `CLEANUP_INSTRUCTIONS.md`를 생성한다. 계획은 대상 밖
   경로·link/reparse point·active 세션을 `BLOCKED`로 표시해야 한다.
6. 지시서에서 각 후보의 `approved`를 검토·승인한다. 계획에 없는 경로를 추가하거나
   `git add .`, 재귀 삭제, 프로세스 이름 기반 세션 종료를 수행하지 않는다.
7. 적용이 필요하면 계획 파일의 해시를 다시 확인하고, 스크립트가 제공하는 명시적
   `--apply --plan` 경로로 `approved=true`인 승인 항목만 처리한다. 완료 뒤 `project:validate`와 루트
   재inventory를 실행하고 결과를 작업 로그에 기록한다.

## 완료 기준

- [ ] 타이틀 루트·프로젝트·활성 세션의 소유권이 모두 분리 확인됨
- [ ] Handoff·manifest·로그·QA·릴리스 anchor가 보존 목록에 들어감
- [ ] 삭제 없이 정리 계획과 사람이 읽는 지시서가 생성됨
- [ ] 적용했다면 승인된 exact allowlist만 제거되고 link·프로젝트 밖 경로는 건드리지 않음
- [ ] 세션 수·artifact_key·Title ID 중복을 재검증함

정리 계획 생성은 프로젝트 완료나 릴리스 PASS를 의미하지 않는다.
