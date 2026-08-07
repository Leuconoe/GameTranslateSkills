# Handoff 기반 정리·청결화 계약

정리는 파일명이 `tmp`인지 여부만으로 결정하지 않는다. 프로젝트의 `HANDOFF.md`,
`PROJECT.md`, `WORK_LOG.md`, canonical manifest, 활성 세션 상태와 파일 해시를 함께
읽어 **정리 지시서**를 만든 뒤, 지시서의 명시적 allowlist만 적용한다.

## 기본 동작

1. 대상 루트와 프로젝트를 literal 절대 경로로 확정하고 `git status`, 활성 프로세스,
   Eden remote/local 상태를 읽는다.
2. `HANDOFF.md`의 `open` 엔트리와 해당 evidence 경로는 보존 anchor로 취급한다.
   `applied`·`rejected` 엔트리도 manifest·로그가 더 이상 참조하지 않는지 확인하기 전에는
   삭제 후보로 승격하지 않는다.
3. `PROJECT.md`, `WORK_LOG.md`, `*_MANIFEST.tsv`, QA 보고서·캡처·릴리스 파일이 참조하는
   경로와 canonical 파일은 보존한다. 참조 경로가 존재하지 않으면 삭제하지 말고 `BLOCKED`
   또는 `WARN`으로 지시서에 기록한다.
4. 세션·런 아티팩트는 `SESSION.json`과 `ARTIFACT_MANIFEST.tsv`의 소유권·해시가
   확인되고, `SESSION.json`의 `last_session_id`와 `remote_close_session_id`가 exact로
   일치해 remote close가 증명된 경우에만 정리 후보로 만든다. 소유권을 증명하지 못한
   세션은 삭제하지 않는다.
5. 중복 후보는 같은 `artifact_key`, 같은 canonical logical name, 동일 basename, 또는
   `session-*`/`run-*`/`(1)`/`copy` 패턴을 **근거 중 하나로만** 사용하지 않는다. manifest·
   handoff·해시·참조 관계가 함께 맞을 때만 후보로 제시한다.
6. 기본 실행은 삭제하지 않고 `CLEANUP_PLAN.json`과 사람이 읽는
   `CLEANUP_INSTRUCTIONS.md`를 만든다. 각 후보에는 경로, 이유, 보존/삭제 근거, 위험도,
   필요한 확인, `approved=false`를 기록한다.
7. 적용은 사용자가 지시서의 exact 후보를 검토해 `approved=true`로 표시하고, 현재
   지시서 해시를 다시 확인한 뒤 `--apply --plan <path>`를 명시했을 때만 수행한다.
   계획에 없는 경로·link/reparse point·프로젝트 밖 경로는 항상 거부한다.

## 보존 우선 목록

`PROJECT.md`, `WORK_LOG.md`, `HANDOFF.md`, 원본 inventory, 번역 manifest·용어집·스타일,
font/image/text QA 보고서, build/release manifest, 릴리스 패키지, `50_test/TEST_LOG.md`,
canonical `50_test/eden/SESSION.json`·`ARTIFACT_MANIFEST.tsv`, 현재 staging과 런타임 증거는
정리 계획에서 기본 보존한다. Handoff가 이 목록 밖의 파일을 근거로 지목하면 그 파일도
보존 anchor로 추가한다.

## 세션·중복 정리 순서

```text
remote status 확인
  → 현재 프로젝트 소유 여부 확인
  → exact session_id 1회 close
  → local SESSION.json을 closed로 갱신
  → manifest 중복·참조·해시 조사
  → 지시서 승인
  → 후보만 원자적으로 정리
  → project:validate 재실행
```

현재 세션이나 소유권 불명 세션을 먼저 지우고 새 세션을 만드는 우회는 금지한다.
