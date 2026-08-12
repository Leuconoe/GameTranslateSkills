# MCP 에뮬레이터 세션·아티팩트 수명주기 규칙

NSW의 기본 반복 시험에는 `eden-mcp`를 사용한다. `ryubing-mcp`는 Eden으로 재현할 수 없는
진단 등 구체적인 예외 사유가 있을 때만 선택한다. 두 backend를 합쳐 **타이틀당 한 개의
canonical 세션**만 허용하며, 빌드나 실행 시각마다 세션을 추가하지 않는다.

이 MCP 시험은 smoke/진단 단계다. 최종 QA는 MCP 세션을 사용하지 않고
`common/release-runtime-contract.md`의 공식 사이트 배포용 릴리즈를 직접 실행한다.

## 1. 단일 소유 원장

역사적 경로 이름은 호환성을 위해 유지하지만 아래 원장은 Eden-MCP와 Ryubing-MCP가 공유한다.

- `50_test/eden/SESSION.json`: 프로젝트당 정확히 하나
- `50_test/eden/ARTIFACT_MANIFEST.tsv`: 프로젝트당 정확히 하나

세션 키는 다음 exact 조합이다.

```text
backend + project_id + title_id + profile_path + profile_sha256 + emulator_version
```

`build_id`와 시각은 키에 넣지 않는다. 같은 identity에서 빌드만 바뀌면 세션을 새로 만들지
않고 동일 세션에서 타이틀만 재시작한다. 원장은 현재/마지막 세션 ID, generation, 예외 횟수와
사유, 두 MCP에서 관찰한 Title ID별 목록, remote close 증거를 보존한다.

`50_test/eden/sessions/`, `runs/`, `session-*`, `run-*`, `SESSION-2.json`, `(1)`·`copy`
산출물은 금지한다. 로그와 캡처도 canonical 논리 키를 갱신한다.

## 2. 생성 전 fail-closed 게이트

모든 `prepare` 직전에 같은 Title ID로 다음을 수행한다.

1. Eden-MCP와 Ryubing-MCP의 capability를 각각 확인하고 세션 목록/status를 각각 조회한다.
2. 두 조회를 `--inventory-backend eden-mcp --inventory-backend ryubing-mcp`로 명시한다.
3. 발견한 세션을 `--observed-title-session backend,status,session-id`로 빠짐없이 기록한다.
4. active/pending 세션이 하나면 그 exact ID를 재사용한다. 둘 이상이면 즉시 `blocked`다.
5. canonical active ID가 remote의 유일한 live ID와 다르면 새 세션을 만들지 않는다.
6. live 세션이 없고 generation이 0일 때만 첫 Eden 세션을 `CREATE_REQUIRED`로 만든다.

```text
npm run project:qa-session -- --project-root "<title>/_work/<TITLE_ID>" --action prepare \
  --backend eden-mcp --title-id "<TITLE_ID>" --profile-path "<isolated profile>" \
  --profile-sha256 "<SHA-256>" --emulator-version "<exact version>" --build-id "<build>" \
  --remote-inventory-checked --inventory-backend eden-mcp --inventory-backend ryubing-mcp
```

`CREATE_REQUIRED`가 나온 경우에만 remote create를 한 번 호출한다. 응답 유실이나 오류가 나도
create를 재호출하지 않고 양쪽 inventory를 다시 확인한다. 생성된 단 하나의 ID를 같은 명령의
`--session-id`와 `--observed-title-session eden-mcp,active,<ID>`로 등록한다.
중복 때문에 `blocked`가 된 경우에는 소유하지 않은 세션을 임의 삭제하지 않는다. 별도 정리 후
양쪽 inventory가 canonical active ID 하나로 수렴하면 같은 identity로 `prepare`를 다시 실행해
원장을 `active`로 복구한다. 수렴하지 않으면 계속 fail-closed다.

## 3. 재사용·예외 교체·종료

- 기본 시험은 Eden 세션을 재사용한다. Ryubing 선택, backend 교체, 두 번째 generation에는
  최소 10자의 구체적인 `--exception-reason`이 필요하다.
- 두 번째 generation은 이전 exact ID가 backend에서 종료되었고 `last_session_id`와
  `remote_close_session_id`가 일치하며 `--previous-session-id`로 다시 증명할 때만 허용한다.
- `pending` 상태에서는 새 create를 금지하고 양쪽 inventory를 대조한다.
- 소유권을 증명할 수 없는 세션을 종료·삭제하지 않는다. 전역 close, 이름 기반 프로세스 종료,
  다른 타이틀 세션 조작도 금지한다.
- 반복 시험 중에는 title run만 stop하고 canonical MCP 세션은 재사용한다. 타이틀 작업 종료나
  불가피한 교체 시 exact remote close 뒤에만 `--action close --remote-closed --session-id <ID>
  --close-reason <구체적 사유>`를 기록한다.

## 4. 아티팩트 중복 방지

```text
artifact_key = <project_id>/<stage>/<logical_name>
```

- 같은 키는 새 행이나 새 파일을 만들지 않고 현재 canonical 행을 갱신한다.
- 같은 키가 여러 경로에 있으면 `BLOCKED (duplicate artifact)`다.
- 변경 파일은 같은 디렉터리의 `tmp-*`에서 완성·검증한 뒤 원자 교체한다.
- historical evidence가 반드시 필요한 경우에만 구체적 사유와 만료 조건을 Handoff에 남기고
  승인된 `attempt-N` 논리 키를 사용한다.
- MCP smoke 증거를 `50_test/RELEASE_RUNTIME_QA.json`의 직접 실행 증거로 재사용하지 않는다.
