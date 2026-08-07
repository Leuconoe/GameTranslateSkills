---
name: gt-project-cleanup
description: "Generate a Handoff- and manifest-based cleanup plan for one game title project, identify stale session and duplicate artifacts without confusing them with evidence, and apply only an explicitly approved project-local allowlist. Use when cleaning a title's _work project after QA/release or when session/file duplication is consuming storage."
---

# gt-project-cleanup — 타이틀 프로젝트 정리

하나의 `<타이틀 루트>/_work/<16자리 프로젝트 ID>`만 대상으로 Handoff·manifest·세션
상태를 추론해 정리 지시서를 만든다. `tmp` 파일만 지우는 방식은 사용하지 않으며,
기본 실행은 계획 생성만 한다.

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
90_tools/ 재현 스크립트·환경 선언
```

Handoff의 `open` evidence, manifest가 참조하는 파일, 현재 active session이 사용하는
파일은 정리 후보로 만들지 않는다. `applied`/`rejected`도 참조·해시 재확인 전에는
보존 또는 `WARN`으로 남긴다.

## 정리 계획 생성

1. 프로젝트 경로가 정확한 `_work/<16-hex>`인지 확인하고 타이틀 루트에 원본 패키지가
   직접 있는지 확인한다. 다른 프로젝트를 함께 순회하지 않는다.
2. `SESSION.json`과 remote 상태를 비교한다. active/pending/소유권 불명 세션이 있으면
   세션·런 아티팩트를 삭제 후보에 넣지 않고 `BLOCKED`로 기록한다. 이전 세션은
   `last_session_id`와 `remote_close_session_id`가 exact 일치하기 전까지 후보로 승인하지 않는다.
3. `ARTIFACT_MANIFEST.tsv`의 `artifact_key`, canonical path, build/session ID, 해시를
   읽어 duplicate key·duplicate path·timestamp/session/copy 파일을 찾는다.
4. Handoff·PROJECT·WORK_LOG·manifest·보고서에서 경로를 수집해 보존 anchor와 후보를
   구분한다. 후보 이유에는 관찰된 경로·상태·해시·참조 부재·해결 조건을 적는다.
5. 다음 명령으로 계획을 생성한다.

   ```text
   npm run project:cleanup -- --project-root "<프로젝트 루트>"
   ```

   이 명령은 프로젝트의 canonical `90_tools/CLEANUP_PLAN.json`과
   `90_tools/CLEANUP_INSTRUCTIONS.md`를 갱신하며, 삭제하지 않는다. 별도 위치가
   필요하면 `--report "<계획 파일 경로>"`를 사용한다.

## 적용 게이트

- 지시서의 exact 후보만 `approved=true`로 표시한다. 전체 폴더·glob·파일명 패턴을
  승인하는 표현은 허용하지 않는다.
- `npm run project:cleanup -- --project-root "<프로젝트 루트>" --plan "<계획>" --apply`
  실행 전 계획 파일 해시와 승인 수를 다시 확인한다.
- 스크립트는 project root 밖, link/reparse point, active session, 보존 anchor,
  계획에 없는 경로를 거부해야 한다.
- 적용 후 `SESSION.json`이 canonical 하나인지, artifact key/path가 유일한지,
  `npm run project:validate -- --titles-root "<컨테이너>" --strict`가 통과하는지 확인한다.

## 완료 기준

- [ ] 정리 지시서에 Handoff 기반 근거와 보존 목록이 있음
- [ ] 세션 remote close·local 상태가 일치함
- [ ] 중복 파일·세션·artifact key가 계획에서 분리 판정됨
- [ ] 기본 실행은 삭제 없이 완료됨
- [ ] 적용했다면 승인된 exact allowlist만 제거되고 검증이 재실행됨
