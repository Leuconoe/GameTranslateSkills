# Eden 세션·런타임 아티팩트 수명주기 규칙

NSW QA에서 `eden-mcp`를 사용할 때 적용한다. 세션과 파일을 매번 새로 만들지 않고,
현재 프로젝트·타이틀·격리 프로파일에 귀속된 하나의 세션과 canonical 산출물만 재사용한다.
`eden-mcp`의 실제 도구명은 버전별 capability discovery 결과를 따르며, 문서에 없는
메서드명을 추측해 호출하지 않는다.

## 1. 세션 식별자와 canonical 상태

세션 키는 다음 값의 exact 조합으로 계산한다.

```text
backend=eden-mcp
project_id=<PROJECT.md의 베이스 Title ID>
title_id=<실행 대상 Title ID>
profile_path=<격리 프로파일 절대경로>
profile_sha256=<프로파일 설정 해시>
emulator_version=<실행 파일 버전>
```

`build_id`와 시도 시각은 세션 키에 포함하지 않는다. 같은 타이틀·프로파일·에뮬레이터의
새 빌드는 동일 세션을 재사용하고, 새 패치를 반영해야 할 때만 해당 세션에서 재시작한다.
세션을 재사용할 수 없는 backend라면 기존 세션을 먼저 정확한 ID로 종료한 뒤 하나만 새로
만든다.

프로젝트에는 다음 두 파일만 세션·런타임 아티팩트의 기준점으로 둔다.

- `50_test/eden/SESSION.json`: 프로젝트당 **정확히 1개**. 현재/마지막 세션 ID, 세션 키,
  프로파일 해시, 현재 build ID, `active|pending|closed|blocked` 상태를 기록한다.
  `closed`에 `last_session_id`가 있으면 remote close가 성공한 exact ID를
  `remote_close_session_id`에도 기록한다.
  `pending`은 remote create 요청이 진행 중인 상태이므로 새 create를 재호출하지 않는다.
  `closed`에 `last_session_id`가 남아 있으면 그 ID의 remote close를 증명한 뒤에만 다음
  세션을 만들 수 있다.
- `50_test/eden/ARTIFACT_MANIFEST.tsv`: 프로젝트당 **정확히 1개**. `artifact_key`는
  유일해야 하며, 같은 키를 다른 경로에 추가하지 않고 canonical 행을 갱신한다.

`50_test/eden/sessions/`, `session-<시각>`, `run-<시각>`, `SESSION-2.json`,
`(1)`·`copy` 접미사 파일은 만들지 않는다. 테스트 로그·캡처도 세션 ID나 현재 시각을
파일명에 붙이지 말고 프로젝트가 정한 canonical 경로에 기록한다. 재시험 시 동일한
`artifact_key`의 해시가 같으면 재사용하고, 다르면 기존 파일을 덮어쓰기 전에
`tmp-qa-replace-<목적>.<ext>`로 같은 디렉터리에 원자 교체한 뒤 불필요한 임시 파일을 정리한다.

## 2. 실행 전 세션 게이트

1. `50_test/eden/SESSION.json`과 `ARTIFACT_MANIFEST.tsv`를 literal 경로로 읽고, 현재
   프로젝트·Title ID·프로파일·에뮬레이터 버전·canonical staging 해시를 확인한다.
2. `eden-mcp` capability를 조회하고 세션 목록/status를 확인한다. `SESSION.json`의
   `active` 세션이 있고 세션 키가 exact로 일치하면 **새 세션을 만들지 않고 재사용**한다.
3. 이전 세션이 현재 프로젝트 소유이고 stale이거나 현재 build를 읽고 있으면 backend가
   제공하는 정확한 `close/stop` 동작을 현재 세션 ID로 한 번만 호출한다. 종료 성공 응답과
   시각을 `SESSION.json`·`WORK_LOG.md`에 기록한 뒤에만 새 세션을 만들 수 있다.
4. 소유권·Title ID·프로파일·세션 ID를 증명할 수 없는 세션은 삭제하거나 조작하지 않는다.
   상태를 `BLOCKED`/`INVALID (cross-session)`로 기록하고 새 세션을 추가 생성하지 않는다.
5. `CREATE_REQUIRED`일 때만 launch/create를 **한 번** 수행한다. 실패했다고 무작정 재호출하지
   말고 먼저 세션 목록과 canonical 상태를 다시 읽어 이미 생성된 세션을 재사용할 수 있는지
   확인한다.

`SESSION.json`이 `pending`이면 backend 응답이 유실되었을 가능성이 있으므로 상태를
`blocked`로 전환하고 remote 목록/status를 재조회한다. `closed`이고
`last_session_id`가 있으면 `project:qa-session --action prepare`에
`--previous-session-id <동일한 ID>`를 전달하지 않는 한 새 세션 생성은 거부한다.
이 규칙은 테스트를 반복할 때 remote 세션을 계속 쌓는 실수를 차단한다.

`npm run project:qa-session -- --project-root "<타이틀 루트>/_work/<프로젝트 ID>" --action
prepare ...`는 로컬 canonical 상태를 검사·갱신하는 guard다. 이 명령은 원격 Eden 세션을
직접 종료하지 않으며, backend의 정확한 종료 성공을 확인한 뒤에만 `--action close
--remote-closed`를 실행한다.

## 3. 실행·종료 수명주기

- 번역 배치·정적 검사마다 세션을 만들지 않는다. 기본 실행은 최종 후보 1회다.
- 세션을 재사용할 때도 패치 변경은 hot reload로 가정하지 말고, 동일 세션에서 타이틀을
  재시작한 뒤 현재 staging의 파일 목록·SHA-256을 다시 확인한다.
- 실행 중인 다른 프로젝트·다른 Title ID·다른 프로파일의 세션에는 입력·캡처·종료를
  수행하지 않는다.
- 테스트가 끝나면 현재 실행을 `run/stop`하고, backend가 세션 종료를 지원하면 현재
  `session_id`로 한 번만 close한다. 종료하지 못하면 `active`로 남기고 `HANDOFF.md`에
  원인과 다음 정리 조건을 기록한다. 프로세스 이름 기반 강제 종료는 금지한다.
- 새 세션을 만든 뒤에는 `SESSION.json`의 `last_session_id`와 `ARTIFACT_MANIFEST.tsv`의
  canonical 행을 갱신한다. 이전 세션 폴더·로그·캡처를 보존해야 한다면 별도 복사 대신
  기존 canonical artifact의 hash/status를 갱신하고, 역사 보존이 정말 필요한 경우에만
  Handoff에 근거와 만료 조건을 기록한 `attempt-N` logical key를 추가한다.
- `SESSION.json`의 `active`와 remote status가 다르면 새 세션을 만들지 말고 `BLOCKED`로
  중단한 뒤 상태를 동기화한다.

## 4. 중복 산출물 방지 게이트

모든 산출물은 다음 논리 키로 먼저 예약한다.

```text
artifact_key = <project_id>/<stage>/<logical_name>
```

- canonical 경로가 이미 있으면 먼저 크기·해시·manifest 행을 비교해 exact reuse한다.
- 같은 논리 키가 다른 경로에 있으면 새 파일을 만들지 말고 `BLOCKED (duplicate artifact)`로
  기록한 뒤 canonical 하나를 결정한다.
- 최종 파일은 직접 덮어쓰지 않는다. 같은 디렉터리의 `tmp-*` 파일에 완성·검증하고 원자적
  rename/replace한다. 실패한 tmp 후보는 완료 정리 게이트에서 제거한다.
- `ARTIFACT_MANIFEST.tsv`에는 동일 `artifact_key` 행을 두 번 넣지 않는다. 재시험은 기존
  행의 build ID·해시·결과를 갱신하고, 과거 증거가 별도로 필요할 때만 사용자 승인된
  명시적 `attempt-N` 논리 키를 사용한다.
- 생성 전에 디렉터리를 재귀적으로 만들더라도 이미 존재하는 canonical 디렉터리를 복제하지
  않는다. 작업 루트·타이틀 루트·저장소 루트에 `title`, `sessions`, `output`, `temp` 같은
  보조 작업 폴더를 새로 만들지 않는다.
- `50_test/eden` 아래에 `sessions/`, `runs/`, `session-*`, `run-*`, `SESSION-2.json`,
  `(1)`·`copy` 파일을 만들지 않는다. 검증기가 하나라도 발견하면 새 런타임을 시작하지
  않고 `BLOCKED`로 돌려보낸다.
