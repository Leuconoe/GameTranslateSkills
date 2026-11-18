# Eden 짧은 런타임 QA (vars: P, TID, CANDIDATE, PREFIX, TAG; optional RELEASE=yes)

상시 런타임 승인 범위다. 보고는 한국어 15줄 이내: 판정(완수/미완수), 체크리스트, 결함+캡처 경로, (릴리스 시) ZIP 경로·SHA-256·크기.

1. 읽기: RESUME.md State 줄, `P\50_test\eden\ROUTE.json`(있으면), `E:\NSW\AGENTS.md`의 Eden/MCP 절.
2. 도구는 공용 `scripts/eden/eden_tools.py`만 쓴다(eden-mcp venv python). 작업 폴더 `P\50_test\eden\broker`.
   - `broker <workdir>` → `READY.json` 확인
   - 세션 생성/시작은 `call`로 `eden_create_session`/`eden_start_game`(base+update 경로, `wait_until=game_ready`)
   - 게시: `publish TID <sid> CANDIDATE PREFIX TAG P\50_test\eden\retired_load` (이 TID의 유일한 활성 패치가 된다)
   - 조작·캡처: `step <workdir> <sid> P\50_test\eden\captures_TAG <name> <ops...>`
   - 종료: `eden_stop`(eden_stop_session 아님) → PID 소멸 확인 → `call <workdir> __quit__ {}`
3. ROUTE.json이 있으면 그 경로를 재생하고 판정 캡처만 본다. 없으면 탐색하면서 ROUTE.json을 새로 기록한다.
4. 범위: 부팅·타이틀(한국어 메뉴) → 새 게임 첫 장면(글리프·줄바꿈·화자명) → 옵션·확인창 → 세이브→타이틀→로드 →
   번역 UI 아트. 갤러리·후반부·장시간 플레이는 하지 않는다.
5. 결함은 캡처와 함께 기록하고 이번 실행에서 고치지 않는다. 부팅이 멈추면 빌드 단계별로 하나씩 켜서 원인 파일을 좁힌다.
6. `P\50_test\EDEN_QA_TAG.md`, RESUME.md State 줄, WORK_LOG 1줄을 갱신한다. MCP 문제는 eden-mcp HANDOFF.md에 적는다.
7. RELEASE=yes이고 완수면 `briefs/release.md`를 이어서 수행한다.
