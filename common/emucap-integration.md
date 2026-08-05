# emucap 선택적 런타임 QA 연동

emucap은 번역·추출 도구가 아니라 실행 중 에뮬레이터를 관찰·제어하고 실험 증거를 기록하는
**선택적 QA 백엔드**다. `gt-qa` 6단계에서만 사용한다. emucap이 없거나 해당 플랫폼 어댑터가
지원하지 않으면 기존 플랫폼의 에뮬레이터·실기 절차를 사용하며, emucap 설치를 번역 작업의
전제 조건으로 만들지 않는다.

상류 프로젝트와 인터페이스는 베타 상태이므로 도구 이름·인자를 고정해서 추측하지 않는다.
항상 두 MCP의 `bootstrap`과 Control MCP의 `status`가 현재 capability를 광고하는지 확인하고,
광고되지 않은 기능은 호출하지 않는다.

## 플랫폼별 사용 범위

| 플랫폼 | emucap 사용 | 원칙 |
|---|---|---|
| SFC | 선택 | Mesen2/SNES capability가 실제로 광고될 때만 사용 |
| PS1 | 선택 | Mednafen/PSX capability가 실제로 광고될 때만 사용 |
| PS2 | 선택 | PCSX2 capability가 실제로 광고될 때만 사용 |
| NSW | 사용하지 않음 | Eden·Ryujinx 호환 런타임·실기 절차 유지 |
| Steam | 보통 사용하지 않음 | 직접 실행 시험 절차 유지 |

이 문서의 `emucap`은 [상류 저장소](https://github.com/mcpads/emucap)의 Control MCP와
Tracking MCP를 뜻한다. 두 MCP는 별도 서버이며, Tracking MCP가 Control MCP를 자동 호출하지
않으므로 에이전트가 필요한 값을 명시적으로 전달한다.

## 프로젝트 경계와 경로 계약

`PROJECT_ROOT`는 현재 타이틀의 `_work/<BASE_TITLE_ID>` 절대경로로 먼저 확정한다. 아래 경로를
벗어나면 emucap 실행을 시작하지 않는다.

```text
EMUCAP_TRACK_ROOT=<PROJECT_ROOT>/50_test/emucap
```

- Tracking MCP `bootstrap`에서 `ledger_path_source`가 명시적 환경변수(`env`)이고,
  `ledger_path`가 위 경로 아래인지 확인한다. 기본 Git 루트의 `.emucap`이나 MCP 서버의
  현재 디렉터리 fallback은 사용하지 않는다.
- `screenshot.save_path`, `record_window.output_root`, `save_state`·`load_state`,
  `dump_memory`, `output_path`는 모두 `PROJECT_ROOT/50_test/` 아래의 **정규화된 절대경로**로
  지정한다. 경로가 없으면 먼저 부모 폴더를 만들고, 프로젝트 밖 경로는 거부한다.
- Tracking MCP `log_artifact.path`도 절대경로를 사용한다. 상대경로는 MCP 서버가 아닌 작업
  Git 루트 기준으로 해석될 수 있어 타이틀 경계를 흐릴 수 있다.
- 원본 ROM/ISO/패키지, `$GT_TOOLS`, 플러그인 저장소, 활성 모드 원본에는 캡처·세이브스테이트·
  덤프를 쓰지 않는다. 원본은 읽기 전용으로 유지한다.

## 시작 순서

1. `$GT_HOME/common/SAFETY.md`와 현재 플랫폼의 `PLATFORM.md`·`build-test.md`를 읽는다.
2. Control MCP와 Tracking MCP 각각에서 `bootstrap`을 호출한다. Control의 `launch_plan`·
   `status`, Tracking의 `ledger_path`·지원 작업이 모두 보이지 않으면 stale MCP로 보고
   재빌드·재연결을 요청한다.
3. Control `status`에서 시스템, 실행 세대, 소유권, 지원 capability를 확인한다. 사용자가
   지정한 게임·에뮬레이터·패치 경로와 일치하지 않으면 `blocked`로 기록한다.
4. `launch_plan`이 반환한 검증 인자로만 `launch`한다. 성공 뒤 `status`를 다시 호출해 실제
   런타임 identity와 활성 입력·모드 경로를 확인한다.
5. Control `get_rom_info`에서 `rom_sha1`을 읽어 원본/패치 대상의 content identity와 대조하고,
   값을 `WORK_LOG.md`·`TEST_LOG.md`에 기록한다. 그 값을 Tracking
   `run_start(rom_sha1=..., connection_ref=...)`에 전달한다.
6. 실행 시험의 목적, build ID, 환경, 사용한 패치 경로를 `PROJECT.md` 또는 `TEST_LOG.md`에
   먼저 기록한다.

## 실행과 증거 기록

- emucap 실행은 전체 번역·독립 검수·주입·정적/왕복 검증·최종 staging이 끝난 후보에서 1회만
  수행한다. 사용자가 별도 재현을 요청한 경우에만 추가 실행한다.
- `write_memory`, `set_input`/입력, `load_state`, `reset`, 미디어 교체 같은 상태 변경은
  Control MCP가 Tracking MCP에 자동 기록하지 않는다. 재현에 영향을 주는 각각의 변경 직후
  `log_intervention`을 호출해 작업명, 이전/이후 상태, 이유, build ID를 기록한다.
- Control의 분석 결과는 결과 반환만으로 완료 증거가 아니다. 필요한 경우 Tracking의
  `log_gate(kind=machine|judgment)` 또는 `log_metric`으로 기록하고, 사람의 화면 판정은
  `judgment`로 분리한다.
- 화면·로그·세이브스테이트·덤프·emucap 번들은 `50_test/` 아래에 보존하고 Tracking
  `log_artifact`로 파일 경로와 SHA-256을 기록한다. 캡처 하나만으로 패치 성공을 판정하지
  않는다.
- emucap의 에뮬레이터 PASS와 실기 PASS는 서로 대체하지 않는다. 실제 입력, 화면 전이,
  저장/불러오기, 활성 Title ID·mod 경로, 입력 패키지·파일 해시를 함께 확인한다.

## 종료와 실패 처리

- `status.runtime_instance.launch_id`를 읽어 현재 세대에 일치하는 경우에만
  `stop(launch_id=...)`를 호출한다. `taskkill`, `pkill`, `killall`, 프로세스 이름 기반 종료나
  다른 세션의 입력·일시정지는 금지한다.
- timeout이나 `connected=false`는 에뮬레이터 종료·실패의 증거가 아니다. `status`의
  continuity/runtime identity와 `get_failure_context`를 확인하고, 보존된 로그·캡처를 먼저
  기록한다.
- capability가 없거나 path/세대/소유권 검증에 실패하면 기능을 강제로 우회하지 말고
  `PENDING_RUNTIME` 또는 `blocked`와 해제 조건을 `TEST_LOG.md`에 남긴다. 플랫폼의 대체
  에뮬레이터나 실기 시험으로 판정을 분리할 수 있다.
- Tracking `run_finish`는 실제 결과가 `done`, `failed`, `aborted` 중 무엇인지와 이유를
  명시한다. MCP 연결이 끊겨도 증거 파일을 삭제하거나 새 run으로 성공을 덮어쓰지 않는다.

## 설치·배포 경계

emucap은 Rust/C 컴파일러와 에뮬레이터별 별도 빌드가 필요한 외부 GPL-2.0-or-later
프로젝트다. `setup/tools.manifest.json`이나 플러그인 패키지에 바이너리·펌웨어·BIOS·ROM을
추가하지 않는다. MCP 등록은 외부 프로젝트의 문서와 사용자의 명시적 환경에서 수행하며,
등록된 바이너리의 버전과 commit을 `WORK_LOG.md`에 기록한다.
