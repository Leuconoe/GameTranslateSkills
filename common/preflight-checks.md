# 공통 사전 경고 게이트

게임 번역 스킬을 직접 호출하거나 `game-translate` 파이프라인을 시작할 때
가장 먼저 적용하는 공통 점검이다. 이 문서는 작업을 빠르게 진행하기 위한 체크리스트가
아니라, 서로 다른 문서·타이틀·세션의 규칙을 잘못 섞는 것을 막는 fail-closed 게이트다.

## 0. 언어·지역판·기존 작업 이력 사전조사

신규/재개 및 개별 스킬 직접 호출에서도 [언어 사전조사](language-preflight.md)를
먼저 적용한다. 새 프로젝트 생성/대량 추출 전에 기존 세션·관련 타이틀/완료 목록의
번역 이력을 확인하고, 같은 게임 또는 유사 제목의 기록이 있으면 이전 범위·상태·
결과물과 이번 대상의 관계를 사용자에게 먼저 알린다. 같은 게임은 재사용/차이 작업을
기본으로 하며 전체 재번역을 자동 시작하지 않는다. 권한 경계를 지킨 메타데이터 검색과
관련 기록 확인만 허용한다. 대량 추출·번역·폰트/이미지 수정·패치 제작 전에 공식 언어 지원과
동일 게임의 지역판 관계를 조사하고 보유 입력/업데이트와 대조한다. 공식 한국어
지원판이 있으면 먼저 안내하며, 사용자 목적과 기존 지시에 맞는 작업만 진행한다.
근거가 없거나 충돌하면 의존하는 변경을 보류하고 읽기 전용 조사를 계속한다.
유효한 동일 입력의 기존 조사는 재사용하며 기존 산출물은 자동 정리하지 않는다.

## 1. 읽기 순서와 기준

작업을 변경하기 전에 다음을 읽고 현재 상태를 기록한다.

1. `$GT_HOME/common/SAFETY.md`
2. `$GT_HOME/common/project-structure.md`
3. `$GT_HOME/platforms/<platform>/PLATFORM.md`와 현재 단계의 플랫폼 문서
4. `$GT_HOME/common/workspace-boundary-contract.md`와 현재 단계의 모든 output/temp/cache에
   대한 `project:boundary --stage ... --assert-output ...` 결과
5. 프로젝트의 `PROJECT.md`, `WORK_LOG.md`, 존재하면 `HANDOFF.md`
6. 현재 입력 manifest·검수 시트·출력 폴더의 수정 시각, 크기, SHA-256, `git status`
7. export·번역 중간물·테스트 산출물/스크립트가 있으면
   `$GT_HOME/common/artifact-layout-contract.md`, `90_tools/PROJECT_ARTIFACT_MANIFEST.tsv`,
   `npm run project:artifacts -- --project-root "<프로젝트>" --validate` 결과
8. 현재 문서가 참조하는 상대 경로의 존재 여부와 대소문자·폴더 위치
9. NSW QA이면 `$GT_HOME/common/qa-session-rules.md`와 `50_test/eden/SESSION.json`,
   `ARTIFACT_MANIFEST.tsv`
10. 최종 QA/릴리스이면 `$GT_HOME/common/release-runtime-contract.md`,
   `platforms/<platform>/runtime-emulators.json`, `50_test/RELEASE_RUNTIME_QA.json`

규칙의 우선순위는 다음과 같다.

```text
안전·권한 규칙
  > 플랫폼 어댑터 계약
  > 공통 구조·배치 스키마
  > 중앙 작업 지침
  > PROJECT.md의 명시적 타이틀별 override
  > WORK_LOG/HANDOFF의 관찰·증거
```

`WORK_LOG.md`나 `HANDOFF.md`의 과거 기록은 규칙을 조용히 바꾸지 않는다. 규칙을
바꿔야 하면 `PROJECT.md`의 override와 근거를 함께 갱신한다.

## 2. 프로젝트 정책 필드

`PROJECT.md`에는 가능하면 다음 정책을 기계 판독 가능한 표 또는 YAML/front matter로
명시한다. 누락된 필드는 `WARN (policy missing)`으로 기록하며, 배치·사용자 승인·릴리스
계약처럼 안전성에 직접 영향을 주는 필드는 추측하지 않고 작업을 멈춘다.

```text
batch_size: 80                         # 공통 기본값
batch_size_override_reason: <근거>     # 80이 아닌 경우 필수
glossary_path: 30_translation/text/glossary.tsv
runtime_policy: static-first           # static-first | slot-probe | final-only
runtime_authorization: pending         # pending | approved | not_required
basic_test_backend: eden-mcp           # Steam/PC는 direct-native
mcp_session_scope: one-per-title       # Steam/PC는 none
final_qa_runtime: official-distribution-release
final_qa_mcp_allowed: false
release_runtime_receipt: 50_test/RELEASE_RUNTIME_QA.json
target_language_slot: pending          # 증명 전에는 pending
image_scope: pending                   # pending | required | N/A; 분석 후에는 required/N/A
image_model: provider-selected         # 내장 imagegen이 모델을 선택하며 임의 모델명 주장 금지
image_quality: provider-managed        # 호출 옵션 대신 best-of-3 합격 게이트 적용
image_input_fidelity: provider-managed # prompt 불변 조건과 decoded-pixel QA로 검증
text_review_policy: prepare-only       # prepare-only | user-gate
image_review_policy: prepare-only      # prepare-only | user-gate
text_review_approval: not_required     # prepare-only: not_required; user-gate: pending | approved
image_review_approval: not_required    # prepare-only: not_required; user-gate: pending | approved
font_status: pending                   # pending | verified | blocked
project_status: registered              # pipeline-contract.json의 project_status
text_status: pending                   # pipeline-contract.json의 text_status
image_status: pending                  # pipeline-contract.json의 image_status
qa_status: pending                     # pipeline-contract.json의 qa_status
release_status: pending                # pipeline-contract.json의 release_status
release_contract: platform-adapter    # 플랫폼 문서의 정확한 경로·파일명 사용
qa_session_state: 50_test/eden/SESSION.json
artifact_manifest: 50_test/eden/ARTIFACT_MANIFEST.tsv
project_artifact_manifest: 90_tools/PROJECT_ARTIFACT_MANIFEST.tsv
```

- 공통 번역 배치는 편집 대상 80행이다. 타이틀이 40행을 사용해야 하면 `PROJECT.md`에
  명시적 근거를 남기고, 모든 배치·검수·manifest가 같은 값을 사용한다.
- 용어집의 canonical 경로는 `30_translation/text/glossary.tsv`다. 대소문자만 다른
  경로를 새로 만들거나 `GLOSSARY.tsv`를 참조하지 않는다.
- `runtime_policy` 기본값은 `static-first`다. `slot-probe`는 원본/안전 문자열 확인이
  꼭 필요할 때만 사용자 승인과 증거 경로를 함께 기록한다. 이 정책은 중간 실행 빈도만
  조절하며 최종 공식 배포 릴리즈 직접 실행을 생략하지 않는다.
- 릴리스 파일명·폴더·ZIP 루트는 공통 스킬이 추측하지 않고 플랫폼 어댑터가 결정한다.

## 3. 즉시 경고·중단 조건

다음 항목은 경고만 남기고 진행하지 않는다.

- 40행과 80행 등 문서 간 숫자·상태·경로 계약이 다르며 적용할 `PROJECT.md` override가 없음
- 대상 프로젝트, Title ID, 입력 manifest, 출력 경로를 정확한 literal 경로로 확정하지 못함
- 추출 도구가 종료 코드 0을 반환했지만 파일 수·크기·매직·파싱·해시가 검증되지 않음
- `text_review_policy=user-gate` 또는 `image_review_policy=user-gate`인데 검수 시트·전 행
  상태·명시적 승인 기록이 없음
- `prepare-only` 정책인데 review 단계가 사용자 응답을 기다리거나, 반대로 `user-gate`를
  명시했는데 사용자 승인 없이 다음 단계로 진행함
- `prepare-only`인데 approval 필드가 `not_required`가 아니거나, `user-gate`인데 해당
  approval 필드가 `pending`/`approved`가 아니며, `review_ready`인데 `approved`가 아님
- 전체 가시 코드포인트·폰트 glyph 매핑·아틀라스 rect·metrics·왕복·render probe가 없거나
  `font_status=verified`가 아닌데 text/image review-ready를 선언함
- `image_scope: N/A`인데 이미지 대상이 남아 있거나, 반대로 이미지 대상이 없는데 가짜 후보·검수 행을 만든 경우
- 기본 이미지 경로의 후보가 내장 `image_gen.imagegen` schema 3 receipt, 검증된 canvas-size-only schema 4,
  또는 best-of-3 alpha mask composition schema 5 receipt이며 같은 reference/prompt의 최소 3개
  독립 호출, 정확히 하나의 전 QA 합격 선택 후보를 증명하지 못하거나 API/CLI·로컬 raster
  생성기로 폴백한 경우
  명시 PROJECT의 exact key/source SHA override 행도 공통 계약의 1~2회 imagegen 또는 schema 6
  typeset 분기와 사용자 근거·실패 provenance·기존 픽셀/구조 gate를 충족하지 못하면 차단한다.
- 기본 smoke 전에 Eden-MCP와 Ryubing-MCP 양쪽 Title inventory를 확인하지 않았거나,
  합쳐서 active/pending 세션이 둘 이상이거나, 구체적 예외 없이 Ryubing/새 세션을 만들려 함
- 최종 QA를 MCP 결과로 대체하거나 공식 릴리즈 페이지·download host·정확한 버전·외부
  바이너리 해시·현재 build/mod/log/캡처를 증명하지 못함
- `qa_status=passed`/`release_status=released`인데 `mcp_used=false`인 canonical
  `RELEASE_RUNTIME_QA.json`과 `runtime:validate` 통과 증거가 없음
- 플랫폼 릴리스 계약과 다른 ZIP 이름·폴더·루트·파일 집합이 발견됨
- 입력 대상 수가 0이거나 예상 수와 다르고, 유효한 `N/A` 범위 근거 없이 빈 반복문·빈 report를 PASS로 만들 가능성이 있음
- 문서·스크립트가 참조한 상대 경로가 없거나 같은 파일을 대소문자만 다르게 가리킴
- 이전 candidate·다른 타이틀·다른 세션의 파일이 섞였거나 source/staging의 해시가 바뀜
- 타이틀 루트에 직접 `.nsp`/`.xci`가 없거나, 패키지가 없는 상위 폴더 아래에 임의의 `title`
  작업 폴더를 만들려 함
- `SESSION.json`의 active 세션과 remote Eden/Ryubing inventory가 다르거나, 같은 소유 키의 세션을
  확인하지 않고 새 세션·timestamp 세션 폴더를 만들려 함
- 동일 `artifact_key`가 여러 경로에 있거나 `SESSION-2.json`, `session-*`, `run-*`, `(1)`·`copy`
  산출물이 발견됨
- managed artifact root에 미등록 파일·link가 있거나 project artifact manifest의 class 경로·
  lifecycle·producer·재생성 명령·SHA-256이 실제 파일과 일치하지 않음

경고는 다음처럼 분류한다.

```text
WARN                 전제 누락·문서 drift. 증거를 보강하기 전에는 다음 게이트로 이동하지 않음
BLOCKED              안전성·구조·입력 계약을 증명할 수 없음
PENDING_RUNTIME      정적/bench 검증은 가능하지만 런타임 증거가 아직 없음
PASS (bench)         정적·왕복·패키지 검증만 통과. 런타임 PASS가 아님
PASS (mcp-smoke)     단일 Eden-MCP 세션의 기본 진단 통과. 최종 QA/릴리스 통과가 아님
PASS (runtime)       공식 사이트 배포 릴리즈를 MCP 없이 직접 실행하고 현재 build/mod/증거가 검증됨
```

`WARN`, `BLOCKED`, `PENDING_RUNTIME`을 번역 완료·사용자 승인·릴리스 완료로 자동
승격하지 않는다.

## 4. 불일치 핸드오프

문서와 실제가 다르거나, 이 게이트에 없는 우회가 필요하면 즉시 프로젝트
`HANDOFF.md`에 다음을 append-only로 남긴다.

```text
date | type | observed | impact | decision | evidence | status(open/applied/rejected)
```

원인을 알 수 없는 상태에서 숫자·경로·상태값을 임의로 보정하지 않는다. 동일한
불일치가 반복되면 공통 문서 또는 플랫폼 어댑터를 수정하고, 해당 계약을 다시 검증한다.

## 5. 최소 실행 체크

각 스킬은 실제 변경 전에 다음을 확인한다.

- [ ] 기존/완료/유사 타이틀 번역 이력의 검색 범위·관계·재사용 여부가 기록되고, 관련 이력이 있으면 새 번역 전에 사용자에게 안내됨
- [ ] 공식 UI/자막/음성 언어·지역판 관계·보유 버전의 조사 근거와 작업 범위가 기록되고, 한국어 지원판이 있으면 사용자에게 안내됨
- [ ] 프로젝트 루트와 Title ID가 literal 경로로 확정됨
- [ ] `PROJECT.md`·최근 로그·manifest의 최신 해시를 읽음
- [ ] 현재 단계의 입력 게이트와 review 정책(`prepare-only`/`user-gate`)이 증명됨
- [ ] `font_status=verified`와 폰트 아틀라스 검증 증거가 증명됨
- [ ] 이미지 대상이 없으면 `PROJECT.md`·분석 결과에 `image_scope: N/A`와 근거가 기록됨
- [ ] 배치 크기·용어집 경로·런타임 정책·릴리스 계약이 서로 일치함
- [ ] 대상 수가 0이 아니거나 명시적 `N/A` 근거가 있으며, 실패·미확인 항목은 `blocked` 또는 `PENDING`으로 기록됨
- [ ] 불일치는 `HANDOFF.md`에 기록했고, 추측으로 진행하지 않음
- [ ] 타이틀 루트가 플랫폼 원본(NSP/XCI 또는 Steam/PC 게임 EXE) 직접 보유 폴더이고 `_work/<프로젝트 ID>`가 그 아래에 있음
- [ ] MCP 플랫폼이면 Eden/Ryubing 양쪽 inventory와 공유 세션 키·소유권이 local `SESSION.json`과 일치하고,
  live 세션이 타이틀당 최대 하나이거나 불일치가 `BLOCKED`로 기록됨
- [ ] 최종 QA/릴리스라면 공식 사이트 배포 릴리즈 직접 실행 receipt가 현재 바이트로 재검증됨
- [ ] 생성할 산출물의 canonical 경로·논리 키가 기존 manifest와 중복되지 않음

## 6. 도구 호출 중복 방지

- 호출 전에 `프로젝트 ID / 작업 종류 / 입력 identity·hash / 유효 인자 / canonical 출력`을
  대조한다. 동일 작업이 완료됐고 입력·출력이 유효하면 결과를 재사용한다. 같은 문서나
  대용량 원본을 변화 근거 없이 반복해서 전문 읽기·해싱·추출하지 않는다.
  QA·관측의 예약키는 `primary/FP + candidate SHA + operation`으로 고정하고 같은 키는 sole dispatcher·단일 lease로 한 번만 read/view한다.
  queued duplicate는 닫힌 receipt 핀만 재전달하며 새 read/view/hash/output을 만들지 않는다. candidate SHA가 달라지면 새 QA로 분리한다.
- 모든 mkdir·write 직전 실제 계산된 target의 undefined·null·빈값을 거부하고 절대경로로 resolve한 뒤,
  명시된 expected project prefix·allowed root와 비교하고 유한 ancestor/reparse 검사를 통과시키며, 의도한 다른 경로의 guard로 대신하지 않는다.
  외부 추출·디컴파일·변환 도구는 실행 전에 검증된 출력 디렉터리를 실제 생성한다. 출력 인수 해석과 CWD/실행파일 위치 fallback을 조사하고, 공용 설치
  폴더에 출력할 수 있으면 프로젝트 전용 도구 복사본과 격리 CWD를 사용한다.
  Windows 자동화는 긴 title/work·stage/run CWD 대신 검증된 짧은 exact project root CWD와 절대 script·입력·출력·argv 및 `__file__` 기준 자원 경로를 사용하고 본문 선택이 CWD와 무관함을 확인하며, 새 junction·temp 단축 경로를 만들지 않고 CreateProcess error267은 자식 생성 전 거부인지 구분하여 원인 교정 없이 같은 호출을 반복하지 않는다.
- 장시간 실행은 반환된 `session_id`/`cell_id`와 마지막 상태를 유지한다. 완료 여부가
  불명확한 작업을 새로 시작하지 말고 기존 세션에서 확인한다. 폴링 간격은 예상 작업
  시간과 변화 주기에 맞추며, 상태 변화가 없으면 간격을 늘린다. 같은 로그 전문을 다시
  출력하지 않고 새 오류·완료·진척 요약만 읽는다.
  SQLite 관찰은 필요한 행을 메모리에 수거한 즉시 read transaction/connection을 종료한 뒤 직렬화·fsync·보고하여,
  원장 관찰로 writer lock을 연장하지 않는다.
  첫 실패부터 종료 코드와 상한을 둔 stderr·실제 예외를 타이틀 작업 경로에 보존하고,
  종료 코드만으로 메모리 실패 등의 원인을 단정하지 않는다.
  서브에이전트가 연 장기 실행 handle의 상태 확인·종료는 원소유자가 맡으며, 다른 에이전트의 Unknown handle 오류만으로
  종료·재시작을 판정하지 않고 원소유자의 같은 handle 응답 또는 정확한 PID·생성 시각·CLI로 재확인한다.
  venv launcher PID와 실제 scheduler/worker PID를 구분해 실제 로그의 PID·세션으로 진척을 집계하고,
  launcher 글롭 결과 0건만으로 작업 정지를 판정하지 않는다.
  Windows venv python.exe launcher와 실제 interpreter PID가 다를 수 있으므로 fakechild ownership fixture는 실제 base interpreter를
  직접 실행하거나 실제 생성 process identity를 정확히 연계하되, 실제 producer의 owner 검증은 약화시키지 않는다.
  Windows venv `Scripts/python.exe`가 실제 interpreter 자식을 만드는 redirector이면 Job `ActiveProcessLimit=1`과 충돌할 수 있으므로, 실행 전 비게임 fixture로 exact interpreter 구조를 확인하고 이미 실패한 같은 구성을 다시 실행하지 않는다.
  검증된 base Python 직접 실행과 필요한 child-only 환경 또는 승인된 descendant-aware process limit을 사용하되 사용자 hard 시간 상한·작업별 메모리 제한·단독 source worker 권한을 유지한다.
  NumPy/UnityPy source worker의 one-worker 선언은 thread 1을 보장하지 않으므로 import 전에 child-only 환경에 OPENBLAS_NUM_THREADS=1·OMP_NUM_THREADS=1·MKL_NUM_THREADS=1·NUMEXPR_NUM_THREADS=1을 명시한다.
  redirector/prechild 실패는 실제 source pass·완료 상태와 분리해 기록한다.
  Python 소유 process는 서버단 Python.exe/Pythonw.exe 필터로 좁힌 뒤 exact 타이틀 inventory/gate/approval/plan argv로 판정하고,
  공유 producer 코드 경로만으로 소유권을 판단하지 않는다.
  자동화 집계·번역·검증의 메모리 유지에는 대화형 Python/PTY 대신 비대화형 단일 pass 스크립트와
  작은 구조화 checkpoint·메모리 cache를 사용한다. bare python/REPL 오류를 반복하지 않으며,
  사용자가 명시한 대화형 작업에는 이 제한을 적용하지 않는다.
  Windows Python child 호출에는 `-B -X utf8`를 명시하고 appender·JSON stdin/stdout도 UTF-8로 고정하며,
  CP949 혼용에 따른 partial append는 완료 prefix를 보존하고 suffix만 복구한다.
  Windows의 대형 JSON·한글 명령문은 길이 오류 206을 기다리지 말고 apply_patch 또는 literal scriptfile·입력 파일과 짧은 file-arg로 운반하며 긴 -c/argv에 본문을 넣지 않는다.
  powershell.exe 출력을 encoding='utf-8'로 읽기만 해서는 출력 인코딩이 바뀌지 않으므로 시작 시
  `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding;` 등으로
  실제 UTF-8 출력을 고정하고 1회 파싱 검증한다.
  원 실행·실패 증거를 보존하고 source 진입 전 오류는 새 semantic lease 소비로 처리하지 않되 동일 오류를 맹목 반복하지 않는다.
- 추출 worker는 batch 전체 제한과 컨테이너별 제한을 구분하고 사용자 최신 상한을 실제 CLI·프로젝트 기록에 고정한다.
  사용자 hard 상한과 내부 close soft 목표를 구분해 hard 상한 내 정상 owned terminal·durable receipt·완료 집합을 충족한 soft 목표 초과를 실패로 판정하지 않으며, receipt 완료 elapsed는 최종 fsync 이후 시점으로 기록한다.
  사용자가 제한을 변경하면 새 호출·plan·auth·실제 CLI에 함께 반영하고,
  실행 중 worker는 기존 snapshot·증거를 보존한 안전 경계에서 새 제한으로 전환한다.
  상한을 자동 상향하거나 이전 default로 되돌리지 않고,
  아직 처리하지 않은 새 컨테이너의 작은 실제 표본으로 먼저 측정한다. fresh/resume을 분리해
  환경·표본별 elapsed·중앙값·최대·timeout 수를 기록하고 관측에 따라 조정하되 완료분을
  측정용으로 재실행하거나 적은 표본을 전체 P95·최적 상한 확정으로 과장하지 않는다.
  추출 batch=1 같은 실행 스케줄은 전체 TXT 일괄 번역의 고정 분량을 1줄·소배치로 재분할하는 지시가 아니다.
  byte-seek가 검증된 비압축 입력의 큰 단일 작업만 구간 ledger·양수 soft-checkpoint 시간으로 나누고,
  사용자 시간 상한을 유지하며 durable contiguous offset의 다음 미처리 구간부터 이어 읽는다.
  원 partial과 입력 지문·범위·hash·quota를 보존하고, compressed stream의 임의 seek·앞부분 반복 decode나
  근거 없는 timeout 증가는 하지 않는다. 별도 RAW spool의 staged RAW_READY를 canonical 주입·런타임 완료로 승격하지 않는다.
  동시 I/O 등 조건이 다른 실측 차이의 원인을 chunk 코드만으로 단정하거나 일반 속도 배율로 주장하지 않는다.
  timeout·cap·에이전트 수 변경 전 2~3개 완료 cycle의 decode/read/write/fsync/checkpoint/metadata replay 시간을
  분리 측정하고, 포함 관계의 구간은 중복 합산하지 않으며 지배 구간부터 최적화한다.
  검증 생략이나 LIVE worker 변경을 속도 개선 수단으로 삼지 않는다.
- 에이전트 진척은 실제 live status와 현재 입력 pin에 연결된 최종 출력 mtime·실독 receipt로
  `준비`·`실행 중`·`완료`를 구분한다. 메시지 전송이나 과거 완료 proof만으로 현재 작업을
  실행 중·완료로 승격하지 않는다. 입력 identity·실제 대조 범위가 같은 기존 완료 proof는 재사용한다.
  done 총수만으로 COMPLETE를 선언하지 않고 마지막 commit 뒤 close·receipt·terminal 실패, rc0_timeout 또는 영수증 누락은 정상 종료 증거 확인 전 HOLD로 유지하되 성공 객체는 재decode하지 않는다.
  OS Software Keyboard 등 modal 중 render-surface capture가 timeout이면 같은 캡처·재launch 대신 status를 한 번 확인하고 지원된 owned PID modal 직접 캡처(예: PrintWindow)로 상태를 확인한 뒤 입력·닫힘을 확인하고 render capture로 복귀하며, timeout만으로 게임 crash·로컬라이제이션 FAIL을 판정하지 않는다.
  input script completed는 UI 전이 증거가 아니므로 연속 tap이 기대 전이를 만들지 않았다면 동일 script를 반복하지 않고 explicit down·wait·up과 새 화면 postcondition을 한 번 검증하며, 그 관측만으로 tap protocol 버그를 단정하지 않는다.
  patch inspection의 파일 수 상한·truncated 목록만으로 누락을 판정하지 말고 frozen expected manifest와 exact staged inventory를 전수 대조한 결과를 재사용하며, 그 대조는 한 번 수행하고 출력 잘림만을 이유로 재복사·재build하지 않는다.
- `send_message`는 메시지 전달이며 completed/idle 에이전트의 작업 재개를 보장하지 않는다.
  의존 입력이 준비되면 owner가 정확한 기존 handle에 `followup_task`로 고정 입력·출력 경로·
  단일 writer 소유권을 명시해 재개한다. producer의 최종 CLOSED SHA 및 QA→solewriter의 실제 합류는 배정된 idle owner를 `followup_task`로 한 번 직접 재개하고 root callback을 기다리지 않되, completed producer는 수정·배정된 후속 제작이 있을 때만 재개하며 단순 PASS 통지는 `send_message`만 사용하고 수신확인 응답·도구실행이나 업무 없는 coordinator의 status/receipt 재발행을 요구하지 않는다. 이미 running이면 추가 followup으로 중복 작업을
  유발하거나 같은 범위를 새 에이전트에 예약하지 않는다.
  아직 CAS 전인 독립 승인 delta는 한 정상 PLAN/CAS/post로 합류하되 미승인·미도착 후보를 기다리지 않고, 진행·완료 CAS의 성공 prefix는 취소·재실행하지 않으며 같은 컨테이너는 최신 객체 union을 검증해 root 재승인 대기 없이 처리한다.
  중단·오류 agent 재배정·재개는 옛 요약의 actual0을 믿지 말고 현재 authoritative pointer·hash·terminal 소유 상태를 coordinator와 먼저 맞추며, capacity 오류 전 파일쓰기·등록 미수행을 추정하지 않고 exact frontier·receipt·registry의 최신 mtime·hash·성공 prefix를 대조해 이미 닫힌 범위 재launch 없이 미실행 tail만 이어간다.
  이때 기존 소형 `CURRENT_WORK_FRONTIER`의 actual-closed 논리키를 legacy `NEXT*` 계획보다 우선 확인하고, 교체 writer는 old writer terminal 확인 뒤 단독 lease·CAS로 인계한다.
- 작업 인계는 최초 병렬 dispatch부터 immutable TASK fullpath·SHA, 필수 입력 경로·SHA·스키마,
  own rank·단일 writer 소유자·권한, 출력 경로·완료 조건을 하나의 고정 계약으로 전달하고 `준비`·`승인`·`실행` 상태를 구분한다.
  이미 전달된 준비 완료 근거는 재생성·재요청하지 않고 자기 배정 row를 소비하며, 입력 identity·scope가 같은 source probe·guard·공통 renderer 근거를 재사용하되 새 stage에 필요한 별도 검증은 유지한다. 독립 source의 실제 ready checkpoint가 닫히면 해당 선행 gate를 충족한 QA·다음 단계를 다른 source 전체 준비와 독립적으로 진행한다.
  동일 native 결속의 병렬 에이전트는 검증된 공통 processor·guard와 고정 packet schema에 데이터·역할별 설정만 전달해 같은 worker를 따로 작성하지 않으며, 코드 준비·슬롯 예약·worker 실행·실제 완료의 상태와 소요 시간을 구분해 보고한다. CPU 동시 실행 슬롯은 guarded subprocess 실행 직전에 획득해 소유 terminal·종료 확인까지 점유한다. metadata 작성·수동 영역 설계·prompt 준비·실행 없는 의존 대기에는 슬롯을 점유하지 않으며, 실제 동시 프로세스 수·메모리 상한·hard60 guard는 그대로 유지한다.
  준비는 기존 schema와 고정 pin 참조로 유지하고 PREPARED/WAIT 장문 보고서를 연속 생성하지 않는다. 실제 산출 checkpoint가 닫힐 때마다 변경분·actual 호출 횟수·terminal·candidate pin·미해결 blocker만 짧게 한 번 인계하며, 준비·읽음·대기 ACK나 같은 context/status 전체 dump를 반복하지 않는다.
  완료 상세 보고·대형 JSON은 새 handoff·모델 출력에 반복 inline하지 않고 기존 폐쇄 자료의 경로·SHA를 참조하며 새 FP·payload·bundle·proof·case 변경분만 인계한다.
  요약·인계의 증거 중복 최적화와 canonical 기계 입력 계약을 구분하며, 기존 consumer가 지원하는 overlay는 해당 계약대로 사용할 수 있다.
  필수 flat manifest/selection을 consumer 미지원 sparse overlay나 새 schema로 대체하지 않고, 필요한 큰 canonical 파일은 지원되는 기존 형식으로 파일에 한 번 emit·검증한 뒤 모델에는 경로·bytes·SHA와 변경 요약만 출력한다.
  보고는 범위·실제 건수·새 HOLD·단일 handoff pin으로 요약하고, 닫힌 일괄 출판이 허용된 작업은 항목별 정본 CAS를 반복하는 대신 닫힌 묶음의 차집합을 출판한다.
  대용량 manifest·메모리 조회·도구 결과의 JSON·배열은 `typeof`·`Array.isArray`로 타입을 확인한 뒤 고정 scalar 허용목록과 rows의 정확한 소유 subset만 새 객체에 복사하고, `JSON.stringify` 길이를 사전 상한과 대조해 초과하면 원객체·원문 대신 제한된 key·count·파일 pin만 출력한다.
  중첩 exec 결과도 raw output을 바로 `text()`하지 않고 한 번 parse·cache한 뒤 같은 projection을 적용하며, 전체 dump나 `max_output_tokens`의 사후 잘림을 안전장치로 삼지 않는다.
  대용량 JSON에 embedded stdout_raw가 있으면 필요한 키·집계 projection을 먼저 읽고 raw 본문은 오류 분석에 필요한 경우에만 읽는다.
  JSONL/manifest 첫 읽기에서 후속 사용할 레코드·배정 allowlist와 읽은 offset을 즉시 보존해 stdout에는 짧은 집계만 내보내고,
  도구 출력 절단은 원 작업 실패로 판정하지 말고 마지막 확정 offset부터 관찰만 복구한다.
  고해상도 image 반환은 작은 단위로 나누고 모델이 실제 본 범위만 관측 완료로 기록하며, toolcall·재emit·모델 실관측 횟수를 분리한다.
  개별 물리 raster의 완료 분류는 실제 원본에서 확인한 visible-required-role 전수 목록과 해당 scope의 실제 QA를 근거로 정하고, 다른 이미지·프로젝트 전체의 완료 선언과 분리한다.
  canvas 밖 가상 문구의 UNKNOWN·원서체 identity UNKNOWN·승인 S 안 숨은 BG의 byte-exact 부재만으로 영구 partial을 유지하지 않되, 실제 필수 가시 미번역이나 가림·tiny 미확정은 범위와 이유를 그대로 보존하고 근거 없이 whole로 승격하지 않는다.
  여러 줄 설명·여러 경로가 담길 수 있는 output_hint 전체는 별도 raw evidence로 보존하고, typed artifact locator에는 관측된 단일 실제 반환 filepath/URI만 분리해 기록한다.
  도구가 typed data:image URL로 실제 PNG bytes를 반환한 경우에도 artifact bytes·SHA를 보존하고 file locator 미노출만으로 거절하지 않으며, 이를 output_hint의 설명문과 구분한다.
  같은 이미지의 실제 시도 상한은 프로젝트·Title ID가 달라도 source byte hash와 기지 이력을 합산해 0으로 reset하지 않으며, source hash·KO·canvas·anchor·style·보호 mask가 일치하는 닫힌 후보는 출처를 보존해 현재 title 경로로 재사용하여 재생성·재번역하지 않되 다른 title 데이터 재탐색을 자동 허용하지 않고 사용자 요청 범위와 명시적인 관련 재사용에만 한한다.
  출력이 잘려 모델 실관측이 없으면 동일 cached image 재emit을 우선하고 없으면 기존 analysis 이미지 하나만 재전달하며 필요 시 durable checkpoint 뒤 새 turn으로 이어가되, 완료 FP 재처리나 원본 PNG 재read·재hash·재prepare는 하지 않는다.
- 실패한 동일 명령을 그대로 반복하지 않는다. 먼저 오류와 부분 산출물·변경된 원장을
  확인하고 원인을 수정한 뒤 해당 작업만 재시도한다. 변경 근거와 재시도 결과를 남기며,
  같은 실패가 계속되면 그 호출 루프를 중단하고 다른 해결 방법이나 독립 작업으로 진행한다.
  부재 alias는 prefix만 바꿔 다시 열지 말고 old prep와 권위 current JSONpointer를 구분하며, 패키지 archive_path도 물리 stage 상대경로와 구분해 접두사를 중복 결합하지 않고, 같은 entry에 명시된 기존 경로나 사전 캐시도 해당 entry의 expected bytes/SHA와 실제 일치할 때만 재추출 없이 사용한다.
  필수 current machine-path가 실제로 깨졌을 때만 기존 schema의 exact-path-only CAS/post로 수리하고, metadata 후보 치환·전역 fallback·전체 payload 재해시는 하지 않는다.
  실패 항목은 원시 증거·완료분과 함께 보존하고 자동 재시도 없이 서로 다른 pending만 진행할 수 있다.
  연속 무진전 실패에는 유한 중단 조건을 둔다.
  같은 시간 제한으로 timeout 후 재개할 때는 committed checkpoint 또는 remaining binding set의 변화가 입증될 때만 허용하며,
  예약키를 stable source SHA + container/stable key + 현재 doneprefix digest + cap으로 고정해 manifest/runid만 바꾼
  동일 prefix 재호출을 차단하고 zero-progress·미변경 입력은 HOLD로 둔다.
  고정 source의 positive timeout은 닫힌 journal·oldprefix 보존·done_delta>0·새 prefix·미예약 semantic key가 확인된 때만
  사전에 고정한 횟수 상한 내 자동 계속을 허용한다. 현재 승인된 각 worker의 시간·메모리 상한을 유지하고
  complete·zero-progress·기타 fatal·DB 오류에는 즉시 중단한다.
- 외부 도구 실행·원장 등록처럼 **파일 변경 후 검증 오류를 반환할 수 있는 도구**는 비영(非零)
  종료만으로 무변경이라고 가정하지 않는다. 실제 생성·변경 파일과 원장 형식·등록 결과를
  먼저 확인하고, 형식 오류가 남은 원장에 여러 등록 명령을 연속 재전송하지 않는다.
- 병합·다음 단계처럼 앞 단계에 의존하는 작업은 앞 단계의 exit code 0과 실제 산출물
  검증을 모두 확인한 뒤에만 실행한다.
- 독립적인 조회·검증은 한 번에 묶고, 한 producer의 출력·임시 경로를 모아 경계 검사를
  수행한다. 경로·링크·입력 상태가 바뀌면 필요한 검사를 다시 하며, 중복 감소를 이유로
  필수 경계·소유권·무결성 검사를 생략하지 않는다.
  이미 타이틀 전체 boundary/link 감사 근거가 있고 이후 감사 scope·링크·타이틀 구조에 변화나 불확실성이 없으면,
  단계 내 새 exact output은 `--stage <stage> --assert-output <exact-output> --no-link-scan`으로 사전 검사해
  필수 title·managed root·output ancestor 확인은 유지하고 전트리 link scan은 반복하지 않는다.
  링크·타이틀 구조 변경이나 불확실성·최종 전체 감사에는 full scan을 유지하며 scoped PASS를 global PASS로 승격하지 않는다.
- 연속 번역은 `glossary-rules.md` §8의 누적 검사 정책을 따른다. 배치마다 필요한
  ID·제어 코드·불변 필드·병합 검증만 수행하고, 변화 없는 전체 빌드·폰트·카탈로그·
  런타임 검증을 반복하지 않는다. 진행 보고만을 위해 같은 성공 명령을 재실행하지 않는다.

- 사용자가 추출 TXT 전체의 일괄 번역을 명시하면 그 지시를 프로젝트 정책에 기록하고,
  원문·ID·binding을 동결하여 전체 잔여 분량을 처음에 비중첩 고정 배정한다. 문맥이
  다른 동일 원문은 binding별 번역 예외를 허용한다. 모델 입력을 위한 내부 페이지를
  새 예약·재배정·승인·canonical 병합 단위로 삼아 호출 루프를 만들지 않는다.
- 일괄 처리 전환 시 기존 canonical 번역과 완료 후보를 보존·재사용하고 재번역하지
  않는다. 전환된 이전 소규모 예약은 이력으로 남기되 잔여 원문을 영구 잠그지 않는다.
- 명시된 일괄 작업은 전체 초안 완료 뒤 전수 검수·일괄 병합·최종 QA를 수행한다.
  내부 페이지마다 윤문 도구·전체 검수·원장 갱신·병합을 반복하지 않는다. 최종 ID·
  누락·중복·제어 코드·불변 원문 검증은 유지하고, 실패 시 해당 오류만 교정한다.

### 실제 재독을 보존하는 토큰 절약

- 공유 `STYLE`·용어집·화자 역할·입력 identity는 변경 전까지 한 번 로드한다. 이후에는
  ID·source·기존 KO·최소 화자/장면만 읽고, 애매한 행에 필요한 추가 문맥만 조회한다.
  원본문서 전문·기존 성공 로그·변화 없는 상태를 보고용으로 반복 출력하지 않는다.
  재개 시에는 현재 입력 pin에 맞는 완료 receipt와 현재 delta만 읽고, 전체 handoff·로그를 재주입하지 않는다.
- 의미 검수자는 각 검수 단위의 source와 KO를 실제로 대조한 뒤 수정·보류만 희소하게
  작성한다. 실제 대조 완료를 모델이 명시한 read-range receipt에 입력 identity,
  순서 있는 ID(또는 범위·개수), 캐시된 source/target fingerprint를 연결한다.
  잘리거나 미열람인 범위, 누락·불일치 receipt에는 자동 유지 판정을 만들지 않는다.
- 코드는 유효 receipt의 정확한 ID에 한해 원 target을 byte-exact 복사하여 계약상 필수인
  `retain`·빈 findings/overrides를 생성할 수 있다. 모델은 유지 행 전문·반복 notes를
  재출력하지 않는다. 수정·보류를 우선 반영하고 기존 단일 writer의 append 출력 계약을
  유지한다. 이 형식 보완이나 기계 검증 통과를 semantic PASS의 근거로 삼지 않는다.
- 기능키 보존 감사는 held/issue 교집합에 한정하지 않고 해당 source family 전체 keyspace를
  최초 한 번 대조해 결과를 캐시한다. 동일 JA라도 소비 역할·수치 key·voice ID가 다르면
  번역을 자동 전용하지 않는다.
- 검수 재사용은 동일 source **및 동일 KO**, 화자 역할·대상·말투·의미 문맥까지 같은
  대표 단위를 실제 대조했을 때만 허용하고 모든 binding을 보존한다. 서로 다른 KO나
  역할을 합치지 않는다. 이 최적화로 현재 frozen plan/input/기작성 output을 재분할하거나
  소급 변경하지 않으며, 명시된 전체 TXT·고정 병렬 배정(예: 24개)을 유지한다.
- 다단계 대용량 검증은 단계별 입력 hash·scope·완료 결과와 재사용 가능한 중간 필터를
  성공 직후 저장한다. 후속 실패 시 입력·scope가 같은 성공 단계는 재사용하고 실패한
  최소 단계만 원인 교정 후 다시 실행한다. 원 fail/raw 영수증을 보존하고 검증 범위를 줄이지 않는다.
  검증 도구의 0건 카운트 누락·가변 budget 카운터 같은 판정 오류는 원 실패를 보존한 뒤 정확 scope로 교정한다.
  고정 작업 수를 바꾸면 selected count·unique count·approval count·maximum workers 검사를 모두 같은 기준에 맞추고,
  정상·부족·초과·중복 입력의 순수 guard 검증 후 실행한다.
  새 근거 확인에 필수인 한 번의 재읽기는 허용하며, 반복 읽기 금지를 기계적으로 적용해 복구를 중단하지 않는다.
  비용 큰 원본 import·guard 전에 캐시 fixture로 실제 컨테이너 표현(list/tuple 등)의 정규화·expected hash를 검증하고,
  재읽기 없이 실패를 진단할 수 있도록 각 guard의 expected·actual 값과 제한된 형태 정보를 assert 전에 receipt로 저장한다.
  공통 path guard 통과와 별개로 실행 전 pinned decoder의 exact CLI parser·실제 main 경계 pure fixture로 diagnostic target의
  prefix/basename 수용 여부를 확인하고, shared context 설정뿐 아니라 child argv의 diagnostic-log 경로가 producer에게
  같은 값으로 전달되는지 확인한다.
  준비 metadata로 실제 consumer의 delimiter·quoting·JSON·enum 계약을 확인하고 최종 TSV를 같은 파서로 source 접근 없이 preflight하며, JSON 필드가 있다는 이유만으로 CSV 자동 quoting을 적용하지 않는다.
  독립 측정 근거와 selected-byte-copy artifact는 서로 다른 역할·경로로 보존해 같은 파일을 독립 증거로 중복 집계하지 않는다.
  실패의 raw status는 보존하고 consumer가 요구하는 정규 enum으로의 명시적 mapping과 변환 내역을 별도로 기록한다.
  metadata 주소의 절대·상대 표기 정규화는 immutable 실제 invocation을 덮어쓰지 않고 동일 artifact를 가리키는 posthoc typed projection으로 분리하며, 과거 pre-call 증거 완비로 소급 PASS하지 않고 legacy 증거 미충족 범위와 검증 완료한 신규 제작 범위를 분리해 후자의 진행을 막지 않는다.
  대량 shard 실행 전 outer 승인뿐 아니라 실제 CLI가 넘기는 모든 중첩 gate의 exact 필수 필드·핀·경로를 원 entry 계약과 순수 메타데이터로 대조하고, 공통 사전거부가 나면 후속 shard launch를 중단해 원 source claim 미소비를 확인한 뒤 교정본만 실행한다.
  복사한 adapter/harness는 namespace·표면 diff뿐 아니라 실제 public entry의 Title·count·input·timeout과 command-authority의 exact membership을 실행 전에 모두 대조한다.
  SDK identity가 같아도 `Packages/manifest.json`을 검증된 성공 baseline과 비교해 추가·누락·해결 불가 의존성을 확인하며, probe 전 startup 실패는 완료 probe나 품질 실패로 집계하지 않는다.
  파일 권위 SHA는 read_bytes 원본의 byte SHA로 계산하고, CRLF 정규화·read_text 재인코딩 hash는 별도 보조값으로 구분한다.
  encoded container·NPY 파일의 byte SHA와 decoded raw RGBA의 pixel-byte SHA는 대상·표현을 명시해 구분하고 서로 대체 비교하지 않는다.
  투명 RGBA 조판은 alpha_composite의 hidden RGB 변경 여부를 초기 finite fixture로 확인하고 승인된 원문 제거 S·신규 KO K의 편집 union U=S∪K 안에서만 대입하며, semantic 보호 P∖U와 역할을 분리하되 가시 장식·atlas/controller 보호를 일괄 해제하지 않고 U 밖 원 RGBA는 exact 보존한다.
  코덱의 4×4 footprint C와 보호 영역의 교차는 실제 훼손 증거가 아니므로 같은 C 측정·기하만의 HOLD를 반복하지 말고, 닫힌 cached native payload를 우선 재사용하거나 유한 격리 encode/fresh decode로 실제 보호 픽셀 변화를 확인한다.
  C 밖 hidden RGBA·padding·비대상 resource는 exact 보존하고 실제 nonzero·과거 HOLD/실패와 배경 양자화의 개별 시각 채택을 그대로 기록하며, 이를 범용 허용오차·무손실 PASS로 승격하지 않는다.
  원문에 가려진 배경의 원상 복원을 증명할 수 없다는 이유만으로 번역 불가 hard gate를 만들지 말고 승인 edit region·mask 안의 배경 재구성·원스타일 시각 품질과 edit 밖 RGBA·보호 장식 무변경을 분리하며, 실제 노출 G는 고정보호하되 예상 타원·전체 말풍선 도메인을 가려진 glyph S까지 일괄 G로 잡은 S∩G만으로 막지 않으며, S 안 가려진 경계 연결은 승인 재구성으로 실물 평가하고 K 맞춤 G 사후 삭제는 금지하며, 구체적인 새 pixel 가설이 없으면 같은 보류 측정을 반복하는 대신 허용된 편집 경로로 진행한다. 저장된 source/clean/KO 실제 1x에서 잔상·blur·seam·원화 파손이 없는 기존 후보를 숨은 패턴 phase나 복원 모델 holdout 수치 차이만으로 자동 폐기하지 말고, 새 복원 모델 전에 독립 시각 재검토하여 성공 prefix를 재사용한다. 수치 차이는 불확실성으로 기록하되 실제 visible 결함·잘못된 donor geometry·보호 G/밖 U·전체 K fit·alpha/native 기술 gate는 그대로 검증한다.
  bbox xyxy와 rect xywh는 실제 consumer schema를 확인해 명시적으로 변환한 뒤 같은 좌표계에서 검사하며, 형식 오해를 먼저 배제한 뒤 출력 제약·영역 확장을 판단한다.
  첫 실제 read의 raw는 후속 guard·disasm 검증 전에 unverified cache로 저장·fsync해 실패 시 재읽기를 강요하지 않는다.
  Windows content identity는 size·mtime/LastWrite·file ID·device·attributes·기존 hash 등 안정 필드를 같은 API로 비교하고 read로 바뀔 수 있는 atime/LastAccessTime은 whole-equality에서 제외하며, 서로 다른 API의 st_ctime 표현 차이는 의미·단위 정규화 없이 동일 dict로 강제 비교하지 않는다.
  PowerShell ancestor 루프는 terminating error와 유한한 root/iteration 종료 조건을 두고 Split-Path -LiteralPath/-Parent 조합의 실제 지원을 확인하거나 IO.Path.GetDirectoryName 같은 지원되는 유한 대안을 사용한다.
  Path.stat·fstat identity는 각 API의 before/after를 따로 비교하고 API 간에는 공통 필드만 대조하며 모든 identity·attributes를 postguard 전에 cache receipt로 spool해 실패 필드가 보존되지 않은 원인은 UNKNOWN으로 남기고, SHA 일치가 확인된 raw cache는 원본 재read 없이 decode를 재개한다.
  Unity metadata의 __slots__·FileIdentifier 등 serializer는 source open 전에 finite fixture로 검증하고 원본 read·SHA 검증 뒤 직렬화만 실패했다면 실패·코드·terminal을 보존한 채 PRISTINE/cached metadata로 직렬화만 복구하며 원 bundle을 재load·재read하지 않는다.
- 변경 없는 행의 identity·hash와 검증 결과를 캐시하여 changed-only 검증을 적용하고,
  전량 끝에 ID·누락·중복·원문 불변·구조·개행·제어 코드의 전체 integrity gate를 1회
  수행한다. 실패는 원 영수증을 보존하고 해당 오류만 수정한다. 의미 전수 검수와 요청된
  통합 humanize의 실제 run·gate·finalize는 속도를 이유로 생략하지 않는다.
  문자 coverage는 현재 원본 byte SHA·provenance와 정확히 일치하는 요구 charset·fontcmap 집합을 보존·재사용하여
  후속 변경을 집합 차분으로 검사하고 canonical/TXT/SFNT의 대량 재읽기를 피한다.
- 대용량 gate·humanize 실행 전 구현 소스와 입력 문자 수·단위 수를 확인하고, 전역
  `SequenceMatcher(autojunk=False)`·전역 정렬 DP 등의 O(N²)/O(N×M) 시간·행렬 메모리와
  예상 실행 범위를 산정한다. 시간·메모리 예산을 넘으면 소유가 확인된 process만 제한
  중단하고 원본 non-PASS 영수증·부분 결과를 보존한다. 같은 호출을 그대로 반복하지 않는다.
- stable ID 게임 corpus는 한 번 동결한 exact ID 경계와 전량 unchanged의 byte-exact
  hash 증명을 근거로 프로젝트 로컬 scoped adapter를 별도 계약으로 허용할 수 있다.
  행별 공식 지표의 길이 가중합이나 변경 target subset의 공식 함수 실행은 원래 전역
  지표·동일 SSOT와 다를 수 있다. receipt·finalizer에 계산식·대상/제외 범위·원본 non-PASS와
  증명 범위를 남기고, subset 증거나 미검증 범위를 전량 공식 PASS로 승격하지 않는다.
- exact-equivalent 가속은 작은 입력의 공식 구현 대조와 코드 근거를 확보한 뒤 별도
  계약으로 검증한다. 속도를 이유로 gate 생략·미검토 자동 승인·대용량 원문 재윤문이나
  새 run·메모리 알고리즘의 무한 재시도를 절약 정책으로 삼지 않는다.
- 진척은 새 증거·완료 또는 필요한 차단 사유로 보고하고, 상태 조회 루프를 만들지 않는다.
  처리 record 수·출력 문자 수·도구 호출 수로 실제 절감량을 기록한다. 이를 토큰/초당
  속도나 단가·총시간 절감 보장으로 표현하지 않는다.

### 대량 이미지 조판의 재실행 방지

- 실제 frozen 문구를 단일행·여러줄·세로·회전 등 사용하는 모든 renderer 경로로 원본 픽셀 읽기 전에 mask self-test한다. cmap의 문자 존재만으로 분기 지원을 보장하지 않는다. 미지원 기호는 원 코드포인트를 바꾸지 않고 지원 폰트·출처를 기록한 glyph 도형·원 glyph 재사용으로 처리하거나 해당 단위만 HOLD한다. bbox의 float는 소비 직전 floor/ceil 정수 좌표로 정규화하고, 쓰기 대상 NumPy 배열은 writable copy인지 작은 fixture로 확인한다.
- 폰트 bytes는 처음 읽자마자 title-private cache에 고정하고 후속 bounded job은 그 cache를 소비한다. 크기별 FreeType 객체를 무제한 보유하지 않고 소수 LRU와 완료 배열 해제로 메모리를 제한한다. 원 폰트 읽기·자기 cache 재읽기·객체 생성 횟수를 구분해 기록하고, 새 process라는 이유로 원 폰트 재독을 0으로 보고하지 않는다. 각 role의 glyph/effect 렌더 직후 후속 지원문자·source 분류·bbox·metadata 검사보다 먼저 RGBA·uncut alpha/full K·global origin·font parameter를 atomic checkpoint하고 다음 role로 넘어가기 전에 핀을 고정한다. 후속 검사 실패는 저장된 성공 prefix에서 이어가며 boolean K로 AA를 역추정하지 않는다. 저장 전에 실제 소실된 role만 최소 1회 복원하고 그 비용·원인을 정직하게 기록하며 전체를 일괄 재렌더하지 않는다.
- 같은 texture의 source 제거 S를 먼저 전부 적용한 뒤 한국어 K를 전부 합성한다. 단위마다 clear→draw를 반복해 겹치는 다음 S가 이미 그린 K를 지우지 않게 한다. 배경 대표색·alpha는 실제 해당 패널/재질의 역할에서 얻고, canvas 바깥 alpha0 최빈값이나 반투명 배경을 불투명 glyph 배경으로 오인하지 않는다. 반투명 paper 위 원문 glyph의 RGB만 배경색으로 바꾸고 더 높은 원 alpha를 남기면 양성 alpha 잔상이 생길 수 있으므로 source paper RGBA·old glyph alpha·current K/AA를 분리 실측하고 검정·흰 matte 실제 1x에서 A>0 잔흔을 확인한다.
- text bbox/envelope의 안팎만으로 장식 G를 정의하지 않는다. 원 말풍선 선·하트·얼굴·프레임 등의 실제 연결 성분과 글자/AA를 분리하고, 새로 확인한 G가 기존 S에 포함되면 S에서 G를 제외하고 working[G]=source[G]를 복구한 뒤 합성·검증한다. outsideU/G diff0만으로 잘못 정의된 semantic mask나 원문 잔재·필체·획무게 품질을 PASS하지 않는다.
- 교정 예약 전에 source FP/fullkey와 실제 pixel-affecting S/G/K·배경·clip·style plan의 변경을 대조한다. delta0은 기존 후보 포인터를 재사용해 encode/write/view를 건너뛰고, 이미 같은 바이트를 재직렬화한 사실은 보존하되 새 진척에서 제외한다.
  geometry의 배치·공통 scale 후보는 사전 정의한 유한 조합을 한 번 계산해 하나를 선정하고, 선정된 배치만 실제 렌더링한다.
  변경 계획의 fixture는 바뀐 계산·renderer 분기만 검사하고, 영향받지 않은 기존 보조 case는 닫힌 성공 서명을 재사용한다. 공통 helper나 해당 분기를 실제로 바꾼 경우에만 관련 case를 다시 실행하며, 새 출력 폴더나 계획 번호만 달라졌다는 이유로 같은 보조 fixture를 반복하지 않는다. 공통 helper·스키마 변경은 실제 입력의 경로형 fixture와 첫 source packet canary의 exit0·실제 closed pin을 확인한 뒤에만 나머지 배치를 순차 release하며, 공통 원인 실패 시 fan-out을 즉시 중단하고 성공 prefix를 승계해 실패 packet 전량 재실행을 피한다.
  이 단일 후보 원칙은 같은 계획의 반복 생성을 막는 규칙이며 조판 작업 전체의 평생 1회 제한이 아니다. 실제 관측한 결함의 원인과 pixel-affecting 변경이 명확하면 기존 source/font cache와 성공 prefix를 재사용하여 변경 계획당 교정 후보 하나로 계속 진행한다. 후보 예산만으로 고칠 수 있는 작업을 HOLD 종료하거나 재승인 대기로 돌리지 않는다. imagegen 최대 2회와 실패·보호영역 증거는 별도로 유지한다.
  사진 위 원문 효과를 지운 뒤 글자 모양의 평면 패치나 색 얼룩이 반복 관측되면 같은 복원식의 변형을 계속 돌리지 않는다. 기존 목록·캐시에서 동일 장면의 clean BG·원화를 우선 좁게 찾아 가림없는 특징점·known-pixel fit과 무차폐 독립 holdout으로 scale·offset·crop·포즈·색 정합을 검산하고, 확인된 원문·효과 S와 donor coverage의 교집합만 복원한다. DXT·보간 차이와 프레임 밖 한계를 기록하고 사진 전체 교체나 유사 장면 대체로 확대하지 않는다.
  대형 source 이미지의 일괄 관측은 고정 개수만 믿지 않고 decode 시간·RGBA 용량으로 묶음을 조정한다. 묶음이 soft/hard 제한에 걸리면 완료한 spool·page를 재사용하고 미시도 suffix만 더 작게 처리한다. 이 경우 초기 단위는 8FP 또는 RGBA 합계 128MiB 이하 중 작은 쪽으로 잡아 20~30초를 목표로 실측하며, project hard limit은 그대로 유지한다. agent별 controller/worker는 하나씩 실행하고 병렬성은 독립 agent 범위로 확보한다. 완료 packet·원본 읽기·page 생성은 다시 돌리지 않는다.
- 에이전트 등록 수·고정 packet 수와 실제 running 수를 분리하고 completed/pending/error를 활성으로 세지 않는다. thread/usage limit의 동일 활성화 호출을 반복하지 않는다. 실패 호출 뒤 pending이 남을 수 있으므로 소유권을 넘기기 전 옛 lease를 명시 철회하고 exact output 미작성/작업 종료를 확인하여 늦은 중복 시작을 막는다.
- 64-bit stable ID·mtime_ns·file ID가 JSON/JavaScript를 거치면 십진 문자열로 보존한다. 2^53을 넘는 값을 Number로 왕복시켜 identity/CAS 불일치를 만들지 않으며, 이미 손실된 projection은 원시 identity·byte SHA와 구분해 재고정한다.

- 최종 native-size fixture는 실제 고정 문구의 모든 코드포인트(샘플에서 빠진 U3002 등 포함), 다행·세로·기울기 경로, 줄별 잉크 bbox·최소 간격·서로 다른 K-label 교차와 한글 속공간을 먼저 검사한다. 큰 글꼴 크기의 샘플만 보고 무리한 굵기·줄간 충돌을 실제 후보에서 반복 발견하지 않는다.
- 투명 PNG의 A=0 hiddenRGB는 가시 원문 잔획이 아니다. 원문 잔여나 그림 훼손을 판정할 때 실제 alpha를 적용한 검정·흰색 합성 또는 A>0 성분 근거로 확인하고, 오판은 기존 QA를 보존한 reason-only 정정으로 닫는다. 지울 필요가 없으면 후보·S/G·픽셀을 변경하지 않는다.
- 원문과 한국어의 글자 수가 달라 원폭이 맞지 않으면 글자 비율을 유지한 공통 크기·자간·정렬로 먼저 조정한다. 폭만 강제로 늘리거나 압축하여 자모 비례·속공간·광학 크기를 훼손한 후보는 읽힘과 별도로 보류한다.

- 중간 staging의 per-file fsync 비용으로 soft deadline이 반복되면 지연 원인을 확인하기 전에 batch 크기만 줄여 같은 실행을 반복하지 않는다. 중간 복사를 write-close+hash로 처리하는 경우 batch 완료 원장의 flush/fsync와 최종 ZIP의 durable 기록·독립 전량 검증을 실제 계약에 명시하고, 이를 per-file durability로 보고하지 않는다. 완료 prefix를 보존하고 미시도 suffix만 재분배하며 hard 60초·768MiB 제한과 원 source 재독 방지를 유지한다. private 검토 staging은 명시 relative allowlist와 부모별 최초 boundary/reparse guard 캐시를 사용하되 새 부모는 반드시 검사하고 미검증 link는 통과시키지 않는다. 파일닫음+dest SHA+journal batch checkpoint를 soft 50초/hard 60초에 맞춰 수행하며 성공 copy/source hash는 반복하지 않고, 실행 중 고정 worker·큐는 변경하지 않아 이후 suffix/batch부터 적용한다. 이 선택을 최종 release 내구성 약화나 모든 fsync의 전역 금지로 확대하지 않는다.


### Eden 입력 개수와 모달 전이의 실행 제약

- 관측한 Eden `run_input_script`는 100 operations가 한도다. 명시적 `down/wait/up/wait` 4 operations를 N회 반복하고 마지막 wait 1개를 붙이면 `4N+1<=100`, 즉 `N<=24`로 나눈다. 121 operations 거절은 실행 전 검증 실패로 기록하고 같은 내용을 그대로 재시도하지 않는다. 팝업에서 A-only 입력이 전이를 만들지 않으면 반복 전송하지 말고 fresh 화면의 선택 상태를 확인하여 방향 입력 등 필요한 부분만 바꾼 뒤 다음 상태를 관측한다. 게임별 근거 없이 focus가 원인이라고 확정하지 않는다. SoftwareKeyboard 모달에서 MCP screenshot이 timeout이면 status 1회와 log를 확인하고 공식 applet API 유무를 조사한다. 해당 API가 없으면 이미 검증한 exact owned PID/HWND native helper를 해당 title 범위에서 재사용할 수 있으며 computer-use를 새 필수조건으로 추가하거나 전역 focus/input을 사용하지 않는다. 입력 queue 성공만으로 UI 전이 PASS를 선언하지 않는다. Enter down 뒤 dialog가 사라졌다면 key-up 대상 소멸과 실제 UI 전이를 구분해 기록하고 같은 입력을 재전송하지 않는다.


### 텍스트 구조 보존과 실제 줄폭 검증

- 원문의 LF 수와 3줄 구조를 보존한 것만으로 한국어 런타임 줄폭 안전을 증명하지 않는다. 긴 셋째 줄의 실제 clipping이 관측되면 실행에 귀속된 capture·row ID·bundle을 고정하고, 동일 font size/style임이 확인된 기존 정상 표시 줄의 advance 합과 비교해 보수적 dominance 근거를 남긴다. 우선 단어·부호·순서·페이지 수·LF 수를 유지하며 줄 길이를 균등하게 reflow한다. EAW/문자 수는 후보 ranking에만 쓰고 실제 clipping 확정이나 font-fit PASS로 오인하지 않는다. SPACE advance·dynamic name·active instance가 불명확하면 해당 폭 근거는 UNKNOWN으로 남긴다. 이때 새 font 전체 probe·이미지 재생성·동일 API 재시도를 반복하지 않는다. 수정한 bundle만 import하고 독립 fresh reload·패키징을 마친 뒤 최종 실제 표시를 다시 확인한다.


### Guard 준비와 독립 QA 배정의 사전 확인

- 공유 guard의 새 controller는 검증한 출력 디렉터리를 먼저 만들고, 기존 성공 템플릿의 fixture 필수 키(예: status·script_sha256)를 보존한 뒤 실행한다. controller 설정 실패와 실제 worker/source 진입 실패를 나누고, 실제 stderr를 확인해 원인과 변경점을 고정하기 전 같은 호출을 반복하지 않는다. 설정만 수정했으면 이미 성공한 payload 작업은 재실행하지 않는다.
- 읽기 전후 입력 불변성은 file ID·size·mtime_ns·reparse 속성 등 내용 변경에 관련된 키로 비교한다. 읽기 자체가 갱신할 수 있는 atime을 포함한 stat 전체 비교를 사용해 정상 읽기를 변경으로 오판하지 않는다. 기존 SHA·stat 캐시와 byte-exact CAS 증거를 유지한다.
- 독립 QA 배정 전에 캐시된 exact FP/fullkey별 과거 제작자 index로 자기 제작 후보인지 확인한다. 한 번 확정한 owner metadata를 재사용하고, 제작자로 판명된 reviewer에게 다시 배정하거나 같은 후보의 비교판을 열게 하지 않는다. 소유권 확인은 원 게임·폰트·이미지의 반복 읽기로 확대하지 않는다.


### 일본어 획 모양의 Sprite mesh와 직렬화 권위

- 읽을 수 있는 한국어 배치가 반복해서 실제 mesh를 벗어나면 크기만 계속 줄이지 말고, 원문 positive와 새 K를 같은 실제 consumer에 대조한다. 원 JP positive는 전부 들어가고 새 K만 나가면 glyph 모양 tight mesh 가능성을 측정한다. 기존 유한 배치·원본 cache를 재사용하며 같은 대규모 placement 탐색을 반복하지 않는다.
- 프로젝트가 허용한 exact text consumer만 별도 adapter로 분석할 수 있다. 원 Sprite rect/pivot/PPU/packing/UV affine/anchor·physics/bone은 고정하고, 실제 새 노출이 배정 K/effect 또는 alpha0뿐이며 원 보호 G 소실·다른 문구/그림 노출·양성면적 overdraw가 0임을 증명한다. 비중첩 quad/linequad 재삼각화는 exact typed-field allowlist와 rollback 원형, 독립 native fresh 재parse/K-fit/texture 전량 검증을 닫은 뒤 적용한다. 누적 Sprite 개수 같은 scalar 대신 full5/Class213별 original/current typed raw와 승인된 5개 필드 allowlist·실제 consumer·old index-buffer prefix를 검증하고, 원 vertex prefix는 실제 original/current vertex count로 channel별 stream offset·stride·alignment를 계산해 해당 channel bytes로 대조한다. count 증가로 stream 위치가 바뀔 수 있으므로 전체 vertex-buffer startswith만으로 원 정점 손실을 단정하지 않는다. actual complete K의 양성 근거가 없는 과거 whole-quad를 면적 채우기용으로 무조건 append하지 않으며, 다른 문구나 current RGBA diff를 해당 글자의 K로 가장하지 않는다. 실제 source schema가 우선이며 UV normalized·원 vertex envelope 불변을 임의 gate로 추가하지 않는다. source UV channel이 zero이고 보존 uvTransform을 쓰는 관례라면 그 원 매핑과 새 position→K texel 정합을 검증한다. 허용된 missing-K RLE append에서는 원 vertex envelope와 고정 m_Rect/textureRect를 구분해 선언된 ownRect·K·허용 field 계약으로 판정하고 envelope 차이·subpixel/runtime culling은 한계로 남긴다. PNG L-mask/U8의 실제 저장 형식과 모든 source-schema 조건을 실행 전에 함께 확인하여 assertion을 하나씩 고치는 반복을 피하며, 이 검사는 새 field 변경·범위 확대 권한이 아니다. 사진·다른 mesh에 자동 확대하지 않는다.
- 투명 coverage 변화와 가시 손실을 혼동하지 않는다. current candidate A0/K0/G0 영역의 coverage 변화나 의도대로 제거한 원 JP S의 coverage는 수치를 보존해 판정하며, 이를 원 art 보존 실패로 자동 간주하지 않는다. 수정 ROI가 consumer 영향 범위와 disjoint이고 그 범위 RGBA·K·UV/geometry 서명이 같으면 기존 SAT/geometry/fixture를 상속하고 실제 바뀐 분기만 검증한다.
- source submesh localAABB가 zero sentinel이고 기존 정점부터 그 box 밖이면 source 반례를 기록하고 그 값을 byte-exact 보존한다. zero box를 유효 양성 경계로 통과시키거나 임의로 고치지 말고 실제 원 m_Rect/textureRect·XY/UV affine·원/새 위치 범위로 검증한다. 유효 양성 source bound는 그대로 검사한다.
- UnityPy 등의 수정 직후 검증은 설치된 exact API 소스에서 권위를 확인한다. ObjectReader.get_raw_data/read_typetree가 원 reader를 유지하는 버전에서는 save_typetree의 반환 serialized 또는 obj.data를 검사하고, 저장한 실제 파일의 독립 fresh parse를 최종 권위로 삼는다. 첫 assert 전에 성공 직렬화 checkpoint를 남겨 메모리 결과 유실에 따른 같은 encode를 줄이며, 불가피 재직렬화 수는 새 번역 진척으로 세지 않는다. checkpoint는 JSON hash만이 아니라 수정된 serialized RAW byte payload를 assert·pack 전에 저장한 것이어야 하며, 실패 후 원문 decode/parse 반복 없이 그 bytes로 lean pack을 재개한다.
- texture 변환과 mesh 변경은 별도 계약이다. 프로젝트에서 lossless format 전환을 허용했더라도 canvas와 승인 candidate의 실제 native fullRGBA/alpha/hiddenRGB를 검증하고, mesh-only 전후 encoded texture와 decoded RGBA는 동일해야 한다. 손실 압축 halo나 타입 metadata만으로 새 노출을 합격시키지 않는다.


## Closed worker metadata and Windows path identities — 2026-11-13

- Do not seal the current worker stdout, stderr, terminal receipt, or own receipt before its producer/guard has fully exited. A worker can observe its own stdout at 0 bytes and then append the final handoff print. Keep these current outputs path-only/reference-only, and let the final collector hash the closed small metadata once after process closure.
- If a historical self-seal captured 0-byte stdout and the closed output later grew, preserve the original flat and mismatch history. Hash only the exact closed stdout metadata whose size changed, emit a tiny replacement delta, and join that delta into the final intake. Do not rerun native insertion, image rendering, full payload hashes, or the full stat inventory for this metadata-only correction.
- Normalize Windows absolute paths with Path before casefold identity joins; slash spelling differences must not create a false missing replacement or duplicate identity. Preserve original path spelling as provenance. Merge normalized closed metadata once, fail on conflicting bytes/SHA/stat, and retain the failed preparation receipt if a join requires a code correction.


## Consumer bounds, output identity, and closed-cache reuse — 2026-11-13

- Dispatch absolute output paths, including full managed root; never use P2/ui_priority shorthand as an executable destination. If this task writes its own outputs at the wrong project-relative root, stop owner writers, audit exact allowlist+reparse, atomically relocate only that proven owned branch into managed work, preserve bytes and an old/new prefix map; never clean unrelated outputs.
- For a multi-Sprite atlas, fit each translated binding or proven edit-region upper bound to its actual owning Sprite/consumer; fitting only the union of every Sprite can falsely accept glyphs spilled into a neighboring state/CPU Sprite. Single direct-Sprite full-image alpha bounds remain valid.
- When exact emitted glyph K was not saved, a closed generation contract K subset edit_union or source-over K subset final candidate positive-alpha can prove fit using that measured superset inside the actual owning consumer. Keep K bitmap/count UNKNOWN; do not rename G/edit union to K or rerender fonts if the stronger inclusion proof already closes.
- UnityPy packer=lz4 can alter bundle storage header dataflags/block_info_flags while preserving every member/CAB/external/type and non-target object raw. Prove exact actual deltas separately; reuse cached physical stage for corrected fresh verification, do not reencode solely for a known header comparison branch.
- Calendar text that lies outside an original rectangular Sprite must be repaired by measured local placement/common scale within that rectangle; a mesh expansion must not hide an original-rect overflow. Preserve numbers/other labels, reuse verified clean background/render layer, and QA only changed words.
- functions.store/load values are agent-local; never assume root/coordinator cached P1/P2 is available in a worker agent. Validate typeof string and fully absolute exact title/managed prefix before every mkdir or file read/write. An undefined value must stop before any filesystem operation, not become E:/NSW/undefined. Dispatch full literal roots/output paths. For a proven current-operator empty wrong branch, audit exact ownership/reparse/absence of other contents before a recoverable one-time relocation; preserve failure history.


## Exact source discovery and finite serialization recovery — 2026-11-13

- For exact game/cache filename recovery inside a known ignored title tree, use rg --files --no-ignore with the narrow known root and exact basename patterns. A default rg no-hit can mean Git ignore exclusion; it is not file absence. Inventory the exact parent once before guessing a path. Do not broaden into unrelated titles or reread payloads; hand the observed absolute path to the sole ingestion owner for first hash/cache.
- When an original container has no inherited SHA in old metadata, do not invent a pin or stall all image work. A single authorized pristine-container ingestion may establish its observed bytes/SHA after exact physical path, title/extraction provenance and reparse checks; match its typed Texture/fullkeys to frozen source records, cache once, and retain the old UNKNOWN as historical provenance.
- If a UnityPy serialized byte field is exposed as list[int] on one reader and bytes on another, compare a canonical bytes representation while retaining exact content and field bounds. Reuse the previously verified comparison fix and existing native checkpoints; do not repeat a known assertion failure or reencode a Texture solely for representation differences.


## Compact handoffs and cause-changed image repair — 2026-11-13

- For new handoffs, prefer a compact <=4 KiB dispatch/closure object containing exact title/operation, accepted versus held scope, final pins, own-leaf and next step. Keep full per-consumer geometry/pixel evidence in one closed detailed leaf and reference it rather than duplicating expanded arrays in every handoff. Do not rewrite already closed evidence merely to shorten it. Required evidence is retained, and consumers read only the exact detailed metadata needed for their operation.
- When additive/difference triangulation causes float32 T-junction overlap, do not repeat tiny inset changes or relax strict SAT. One cause-changed read-only alternative may replace the Sprite mesh with a common-vertex two-triangle quad inside the exact original local-position bounds, only if all original sourcepositive remains covered, added visible pixels are exclusively verified K, true G/UV/anchors/bounds remain unchanged and strict SAT is zero. Require concrete model authority and fresh serialized QA before native acceptance.
- A visible style failure is a changed cause: reuse a qualified cached font and regenerate coverage once when necessary. Exact old RGBA reconstruction can recover actual fill/outline layers for a verified role swap. Do not keep a visibly rejected style merely because old coverage was not saved, or invent exact original weights from ambiguous inverse blending.
- For transparent source backgrounds, prove intended clear-region RGBA and alpha rather than choosing an opaque visible-color mode. An opaque restoration can create a glyph-shaped cloud even when saved Korean layers and K are correct. Distinguish low-alpha RGB quantization, boundary seams and genuine source-text residue with cached layers and matte comparisons; repair only measured S/K regions and keep graphics, other labels and failure history protected. Where glyph/halo shapes reside in alpha, proven S/U may require alpha_policy=edit-region-only with outside-U/protected-G alpha exact; do not force whole-source/current alpha equality to preserve ghosts or white pills. Separate the face/outline to preserve from a defective halo, rather than requiring all old K bytes exact; pin the new complete K/AA and changed region and recheck geometry. These repairs do not bypass the original skill provenance/approval conditions or a pending user override.


## Storage identity and interrupted-output pin recovery — 2026-11-13

- For Switch Texture2D storage, use the actual is_switch_swizzled(platform, original_platform_blob) result to select padded swizzled length versus logical W*H*4 length. An empty/non-swizzled blob must not be judged by the padded branch; a GOB value alone is not swizzle evidence. Preserve the original blob and all other fields, retain incorrect preliminary hypotheses as corrected history, and recover only the unfinished suffix from saved serialized checkpoints.
- A read_once cached copy may lack an explicit saved-output pin in a handoff. Transfer a pin only through the same closed job's exact read/SHA contract or selected-bytes-equal-fresh-RGBA assertion, with exact source/copy paths and bytes; never infer equality from filename alone. If a current-owned interrupted output still has no unambiguous closed pin, permit one explicit bounded <=128MiB physical hash recovery without decoding, rendering or rerunning QA. Keep original inputs untouched and report the actual recovery file/byte counts instead of claiming zero I/O.


## Scoped metadata queries and shared-asset reuse — 2026-11-13

- In a large workspace containing unrelated titles, scope every Git status/diff and search to exact authorized title paths. Use git --literal-pathspecs with the allowed pathspecs and suppress untracked-file expansion when only tracked status is needed. A workspace-root status can flood output and expose unrelated title metadata; it is not a prerequisite to title work. Do not clean or modify anything found incidentally.
- Inspect a cached first record or declared schema before a bulk metadata join. Fields such as GS2.FP and GS3.fp are case-sensitive, explicit schema mappings, not interchangeable guesses. Recognize an artifact pin only as a dict with path:str, bytes:int excluding bool and sha256:64-hex; descriptive or legacy strings are not pins, while missing required Texture/Sprite deltas, predecessor or approved-hash bindings remain fail-closed. Preserve a failed metadata-only prefix, correct its measured schema cause once, and print compact counts/locators instead of entire corpora. Cache or persist the useful projection for subsequent consumers.
- When every involved title is explicitly authorized, identical shared assets may reuse an unchanged approved Korean candidate after the destination title's physical source PNG SHA and full RGBA fingerprint, exact JA/KO role, own consumer geometry and source-protection conditions are verified. Resolve destination canonical package membership first. If the selected image overlay lacks that logical container, check the exact canonical text/font release typedgraph baseline as well and use the original fallback only when neither baseline contains it; a source-identical target Texture does not prove other TextMesh/font objects pristine, so apply only required Texture/Sprite object deltas to the latest baseline while reusing successful renderer/native-view checkpoints. Before new imagegen/translation, if that exact logical container is currently selected, confirm its cached Texture/full5, source SHA and actual native 1x Korean state; a missing typed set, basename or old projection is not untranslated evidence. For the same current-container SHA, reuse a closed physical view/snapshot without redecoding, connect known Korean by identity and retain historical UNKNOWN provenance. Equality of historical after-PNG/selected-RGBA SHAs does not establish current Texture-to-RGBA binding: reuse only a successful decode checkpoint bound to the selected native SHA, exact CAB/PID/Class28 and serialized target raw SHA, including its external resource span when applicable. If that binding is absent or changed, decode only the affected target once and preserve unaffected successful checkpoints; do not turn a provisional cache-join error into a title-wide re-audit. If no complete current-object view exists, lock one source/current pair decode into the whole-phase <=8 FP/128 MiB budget before deciding generation. After one bounded metadata pass, missing actual-view evidence proves neither untranslated text nor a defect, but leaves visual review unproven: perform the required current-native-first view once instead of repeatedly publishing UNKNOWN documents and ending with an unreviewed handoff. Preserve prior attempts; a source/catalog gap never authorizes a new attempt. Never copy a whole other-title bundle or inherit another title's runtime verdict. Keep actual render/attempt provenance and font/style limitations, stage under the destination title, and verify its own physical round-trip.
  이력 UNKNOWN만으로 내장 imagegen을 전면 금지하거나 자동 허용하지 말고, current-native 원문/source 일치와 문구·편집 보호 계약을 확정한 뒤 알려진 호출을 빠짐없이 고정한 before-current-execution snapshot을 보존 기록 범위에서 진실하게 작성할 수 있을 때만 기존 사용자 최대2회 지시의 exact scope를 정책에 연결해 진행한다.
  관측 기록 0과 lifetime/service UNKNOWN은 구분해 UNKNOWN reset·known prior 누락·안전 기록 우회·세 번째 호출을 금지하며, 실제 두 실패 뒤 조판은 기존 2회 후 fallback 경로일 뿐 신규 UNKNOWN의 즉시 조판 승인으로 보지 않는다.
  canonical baseline에 승인 raw delta만 합쳐도 외부 resource 동일성이 자동 입증되지는 않는다. 같은 resS 이름이라도 실제 m_StreamData path/offset/size·encoded span SHA와 다른 font/text/Texture 참조의 보호를 확인한다. 검증된 배타 slot과 충분한 capacity일 때만 target span을 patch하고, 아니면 canonical resource EOF의 16-byte 정렬 위치에 승인 encoded bytes를 append하여 target m_StreamData의 path/offset/size 세 typed field만 재배치한다(새 image encode/decode 없음). UnityPy resource reader를 교체할 때는 writer에 필요한 baseline resource.flags를 승계하고 실제 RAW/res byte payload checkpoint에서 pack-only로 이어간다. append 시 canonical resource prefix exact를, 두 방식 모두 다른 raw/stream exact·승인 target payload exact를 검증하며 target raw relocation 예외는 정직하게 기록한다. whole image cache/resS로 font/text를 덮지 말고 해당 자원 참조가 UNKNOWN인 컨테이너만 BLOCKED로 유지한다.


### 원 상태 영역의 보수적 alpha 적합성 / 문자열 번호 — 2026-11-13

- exact emitted K bitmap/count를 회복하지 못한 경우 UNKNOWN을 유지한다. 단일 전체 화면 Sprite에서는 current positive-alpha가 실제 글자 support의 상계임을 명시하고 그 전체 상계를 원 삼각형에 검사할 수 있다. 여러 상태 아틀라스에서는 후보나 mesh bounds로 범위를 잘라 fit0을 만들지 않는다. 원 Sprite.m_Rect, pivot/PPU와 직렬화 uvTransform의 독립 일치로 각 상태 영역을 먼저 고정하고, 영역 겹침0·모든 current positive-alpha의 고유 상태 귀속·각 상태의 자체 삼각형 적합성을 각각 증명한다. 이 조건이 없으면 HOLD다. U/declared K/상계를 actual emitted K로 이름만 바꿔 보고하지 않는다.
- 최초 범위 분류는 미관찰 원본 PNG를 비중복 배분해 한 번씩 확인하고 원문·가독성·기능을 묶음 기록한다. 이 단계는 `original-source-only/current-native-unverified`이며 현재 미번역 상태나 완료 증거가 아니다. 번역 필요 문자가 확인된 대상에만 번역 전 current-native 결속·실제 표시 검증을 추가하고, 작은 비기능 표식까지 일괄 native decode하거나 완료 PNG 관찰을 반복하지 않는다. 기존 current-native·생성·보호·검수 게이트와 해당 작업의 자원 상한은 유지한다.
  병렬 배분 전 공통 flat row schema의 필수 키·상태 enum·원문/제안/UNKNOWN 구분과 템플릿을 고정해 공유하고, 완료 후 observer별 형식 재설계나 재관찰을 요구하지 않는다.
- JSON의 no/index는 실제 스키마를 먼저 확인한다. 예를 들어 `"13"`은 정수13과 다르고 `"01"`에는 선행0이 있다. 원문 값을 보존하고 명시적 필드별 대응으로 조인한다. StopIteration/KeyError가 나면 스키마 원인을 바꾸기 전 같은 호출을 반복하거나 넓은 예외 처리로 누락을 덮지 않는다.
- 다른 편의 같은 지문 후보를 재사용할 때 기존 손실 native의 보호 픽셀 색상 오차를 새 편으로 승계하지 않는다. 승인 raw 후보와 목적지 원본의 보호 픽셀을 직접 대조하고, 목적지 native/fresh를 독립 검증한다. 픽셀이 바뀌지 않은 언어·폰트·렌더·과거 QA는 재실행하지 않는다.


### UI 국소 수정과 호출 경계 — 2026-11-13 GS3

- source payload를 열기 전에 배치의 모든 full stable key를 전수 형식 검증한다. FP·PNG 핀이 있어도 primary tuple이 null일 수 있다. 다른 편의 CAB/PathID는 검색 제안일 뿐 권위가 아니며, 목적지 자체 컨테이너의 실제 객체·캔버스·전체 RGBA/FP와 source PNG가 일치한 경우에만 목적지 fullkey로 복구한다. UnityPy.load(bytes)의 standalone SerializedFile 이름은 str(file.__hash__()) 같은 임시 reader 이름일 수 있으므로 embedded CAB로 오인해 namespace/membership 불일치를 만들지 않는다. source/current의 실제 Class28·Class213, 외부 PPtr 관계와 검증된 logical basename으로 판정하고, 이름 추정 오류만 지원 API의 명시 name과 이미 캐시된 bytes를 쓰는 canary 재parse로 교정한다. 원 실패·UNKNOWN은 보존하고 전체 container 감사나 Texture decode를 반복하지 않는다. input read-copy, normalized mask, serialized checkpoint는 역할별 다른 파일명을 쓴다. 같은 `ACTUAL_K.L8` 이름의 입력 캐시와 출력이 `xb`에서 충돌하지 않도록 준비 단계에서 검사하고, 성공 행은 행별로 즉시 마감해 실패한 뒤 전체 prefix를 다시 계산하지 않는다.
- 보조 QA에도 본 작업과 동일한 설치된 직접 Python/PYTHONPATH를 사용하고, 새 worker는 원본 읽기 전에 그 exact 환경에서 필요한 import가 되는지 저비용 fixture로 한 번 확인한다. import/module alias(np, core 등)를 데이터 변수·인자·반복 변수로 덮는지 AST 또는 명시한 변수 스키마로 확인한다. compile 통과만으로 실제 실행 PASS를 주장하지 않는다. 진단 import 전 helper의 top-level 생산·파일쓰기 부작용을 확인하고 unguarded 생산 script를 import하지 않으며 검증된 side-effect-free helper 또는 필요한 함수만의 명시적 안전 경로를 사용한다. 후속 build 호출은 직전 exit0과 실제 handoff 존재·핀 검증 이후에만 실행한다. import 단계 실패나 생성되지 않은 스크립트 오류는 이미지 처리 실패로 세지 않는다. worker의 hard60은 Python 진입 전 launcher 정체를 포함하지 않는다. 실제 소유 launcher의 정확 명령·PID·자식 유무·CPU·대기 상태·산출물 부재를 확인하고, 정체가 검증된 자기 launcher만 종료한 뒤 시작 방식을 바꾼다. 관측 시간 초과만으로 worker나 에뮬레이터를 재시작하지 않는다.
- 메타데이터를 출력할 때 exact FP/row/JSONpointer로 대상을 먼저 고르고 필요한 키·중복 제거 pin만 제한해 출력한다. 한 FP의 근거를 찾으면서 다른 수십 항목 전체를 재귀 출력하지 않는다. 출력이 잘려도 이미 만든 byte-exact 자체 cache를 이용하며 원본을 다시 읽지 않는다.
- Sprite/alpha fit0은 패널 안쪽 여백이나 글자 자체가 온전함을 증명하지 않는다. 큰 선택 상태의 마지막 글자가 패널 끝에서 잘리는지 확인하고, 실제 문제가 있으면 해당 상태만 고친다. known prior imagegen2를 보존한 국소 조판에서는 해시 고정 서체의 실제 전체 glyph bbox와 padding을 사용하고 한 공통 배율로 충분한 안쪽 여백을 둔다. 다른 상태·그림·테두리·alpha 차이0을 증명한다. 전체 alpha와 원 Sprite가 같으면 그 alpha 상계 기하 증거는 재사용하되 새 RGB/source 보호 검증과 새 국소 시각 검수는 별도로 수행한다.
- panel의 positive alpha를 전부 source text S로 분류하지 않는다. A/B 같은 UI는 원 글자·판·테두리·그림자 역할을 실제 관측으로 나누고, source 관측으로 고정한 text 영역 및 균일 배경 색/글자 support를 이용해 보호 G 차이0을 확인한다. current-alpha 상계 fit은 이 역할·보호 증거를 대신하지 않는다. 원문 고유 표기(예: 甲士園)를 익숙한 유사 표기로 근거 없이 정규화하지 않는다.


### 기존 한국어 후보의 잘림·겹침 직접 수정 — 2026-11-13

- 프로젝트가 기존 후보의 직접 조판 수정을 허용한 경우의 기록 규칙이다. 과거 imagegen 시도 기록 UNKNOWN은 그대로 보존하고 실제 기법은 `origin=agent-typeset`/compositing으로 기록한다. 새 원본·기존 후보를 덮어쓰지 않고 폰트 hash, 렌더 설정, source S, 새 전체 glyph/effect K, 보호 G, 자체 표시 영역을 남긴다. 인접 CPU·상태로 넘어간 기존 글자는 원본 RGBA로 복구하고 그 인접 그래픽을 보호한다.
- 여러 Sprite의 합집합이나 각 m_Rect로 잘라 낸 alpha fit0만으로 소유 글자의 적합성을 주장하지 않는다. 독립 확인한 원래 Sprite 영역 안에 새 렌더의 전체 glyph/effect가 자연스럽게 들어가게 배치·공통 배율을 정하고, 잘라내기 전 K로 자체 geometry 적합성과 이웃 G 차이0을 검증한다. 변경하지 않은 상태의 성공 증거는 재사용하고 변경 상태만 새 시각 검수·native/fresh를 수행한다. 정적 통과와 Eden 실행 검증은 구분한다.


### 캐시 후속 작업과 명시적 마스크 역할 — 2026-11-13

- 닫힌 자체 캐시를 읽을 때 원본 입력과 같은 bytes/SHA 및 파일 ID·size·mtime 안정성을 검사하되, 후속 job마다 동일 payload를 새 캐시에 다시 복사/fsync하지 않는다. 실제 기존 절대 경로를 pin에 유지한다. 복사를 생략하고 새 OUT 경로를 기록하면 존재하지 않는 handoff가 된다. 작은 mesh 원시 bytes는 제한된 inline hex+bytes/SHA와 실제 디코딩 배열을 한 closed 증거에 저장해도 되며, 존재하지 않는 파일 path를 만들지 않는다. Runtime과 원본 identity 입증 조건은 그대로다.
- 파일 변수명으로 마스크 역할을 정하지 않는다. producer code/schema의 의미를 기준으로 입력 S/K/G를 정규 source-removal S·actual complete K·protected G에 한 번 매핑·고정한다. 예전 receipt의 G가 typesetting.glyph_mask인 경우 보호 그래픽 G가 아니다. 명시적 renderer/producer 의미를 읽고 원본 별·테두리 같은 진짜 그래픽을 독립 관측으로 분리한다. 원문 JA가 앞에 인쇄된 패턴·큰 하트 같은 caption backing B와 실제 foreground G는 원본의 실제 겹침 관계로 먼저 구분한다. B는 새 K 아래 합성할 수 있지만 원래 보인 B는 K 밖 exact로 보존하고 별·테두리 등 실제 전경 G는 고정 보호하며, K 충돌을 없애려고 사후 G를 삭제·축소하지 않는다. 원문 글자 AA가 보호 장식까지 잘못 포함된 경우 원본 RGBA를 복구한다. full/cropped K와 global bbox·좌표계를 먼저 확인해 잘리지 않은 actual complete K를 정의한다. 관측된 known G는 보호 근거가 있는 부분집합이며 outside-U complement나 원본 전체 G의 입증으로 바꾸지 않는다. 원래 native Sprite별 문구 배치를 먼저 확정하고, 저장된 완전 글자/effect 레이어를 통째로 이동·공통 축소한 뒤 실제 전체 K를 자체 삼각형에 검사한다. Sprite로 미리 잘라 fit0을 만들지 않는다. 원문 잔상은 outsideU0이나 과거 QA만으로 없다고 판단하지 않는다.
- JSONL은 명시한 행 스키마/JSONpointer로 읽고 JSON 객체와 혼동하지 않는다. payload 읽기 전에 metadata의 무변경 필드가 [] 또는 0처럼 명시한 schema상 같은 표현인지 확인해 정규화하되, 실제 변경과 UNKNOWN은 합치지 않는다. 안정성 비교에서 읽기만으로 달라질 수 있는 atime을 identity 기준에 넣지 않는다. 60초 종료 뒤 완전한 자체 캐시가 남으면 누락 pin을 제한된 물리 hash와 구조/FP 검증으로 회복하고 아직 끝나지 않은 suffix만 실행한다. 작은 metadata gate나 표시용 contact sheet에서 실패해도 원인을 고친 해당 suffix만 실행하며 성공 decode·렌더·native checkpoint는 승계한다. 원인이 같은 실패를 반복하거나 완료한 원본 읽기·폰트 draw·언어 검수를 다시 하지 않는다.


### 메모리 실패의 직렬화 prefix 보존 / panel contour 역할 — 2026-11-13

- 한 컨테이너 패킹에서 MemoryError가 나도 이미 완성한 다른 컨테이너와 target serialized checkpoint를 버리거나 다시 encode하지 않는다. 같은 60초/768MiB 안에서 별도 pack-only job을 열고, 정확한 checkpoint bytes/SHA·동일 payload 길이·예상 snapshot을 확인한다. pack은 NumPy/PIL/cv2·RGBA·AA·font·typetree를 보유하지 않는 별도 lean worker에서 cached baseline·old target SHA·staged RAW만으로 수행하고 fresh도 별도 worker로 분리하며, 같은 save MemoryError에는 상한 확대·원문/font/encode 재실행 대신 검증된 pack-only helper를 재사용한다. GS1의 isolated pack 회복은 encode0·peak704163840B였다. 메모리 오류를 번역/게임 runtime 실패로 세지 않는다.
- 판의 alpha contour에도 원문 글자가 겹칠 수 있다. contour 전체를 RGB 보호 G로 복구하면 일본어 획을 되살릴 수 있다. 실제 source S 역할과 겹친 곳은 원 alpha 보호와 glyph RGB 제거를 분리하고, 비문자 contour/장식만 exact RGBA G로 보호한다. 새 전체 K는 잘라내지 않는다. 독립 text-inner 영역에서 유한한 통째 위치 조합을 한 번 계산해 보호영역과의 AA 접촉을 피하고, 선택한 전체 K의 원 삼각형 fit을 확인한다. 성공한 글자 레이어와 fit은 바꾸지 말고 역할 오류가 난 RGB 부분만 회복한다.


### 투명 원본의 스타일 확정과 편 간 물리 identity — 2026-11-13

- 원본 스타일을 prompt에 고정하기 전에 RGBA 원본의 alpha 범위·분포와 검정/흰색 source-over matte를 확인한다. raw 이미지 뷰가 A=0 hiddenRGB를 보여 주면 투명한 외곽선 글자를 불투명 색판으로 오인할 수 있다. 원문·숫자·그림 역할 오독으로 HOLD하기 전에는 축소 overview 대신 해당 native 1x label crop을 관측하며, 다른 버전의 Friend 같은 문구·존재 flag를 상속하지 않는다. 실제 보이는 글자 면·외곽선·배경·장식을 구분하고, 편집 밖 hiddenRGBA도 원본 그대로 보존한다. 기존 잔획 판정용 matte 근거는 재사용하되 잘못된 초기 스타일 가설을 지우지 않고 정정 이력으로 남긴다.
- 편 간 CAB·PathID·이름·canvas가 같아도 source FP/fullRGBA 일치를 추정하지 않는다. 실제 물리 원본이 다르면 기존 FP를 오류로 단정하거나 hash 방식 변경으로 재매핑하여 재사용하지 않는다. 예를 들어 GS1의 보라색 Aries와 GS3의 분홍색 Aries는 같은 객체 이름/ID여도 가시 픽셀과 alpha가 다르므로 별도 원본이다. 검증된 각 편 identity와 기존 provenance를 유지한다.
- `text_ja` 같은 관측 필드명은 실제 문자열의 언어를 보장하지 않는다. 영어 `Aries`처럼 저장된 실제 문자열을 확인하여 원문 언어·번역어를 정하고, namespace만으로 현재 locale 사용 여부나 번역 제외를 확정하지 않는다.


### set_raw_data 직후의 staged bytes와 오판 재시도 방지 — 2026-11-13

- 기존 UnityPy 직렬화 권위 규칙을 `set_raw_data`에도 적용한다. 설치 버전이 원 reader를 유지하면 직후 `get_raw_data()`/`read_typetree()`는 변경 전 bytes를 반환할 수 있다. `staged = getattr(obj, "data", None)`를 먼저 얻고, `staged is None`인 경우에만 `get_raw_data()`로 fallback하여 예상 serialized checkpoint와 비교한다. 빈 bytes의 존재를 truthiness로 버리지 않는다. 이 staged 비교는 저장한 물리 파일의 독립 fresh reload를 대신하지 않는다.
- 위 readback 불일치만으로 source FP·K/G 역할·Switch swizzle·코덱 오류를 추정해 같은 Texture 인코딩이나 글꼴 렌더를 반복하지 않는다. 먼저 exact 설치 API와 현재 검사 대상이 원본/선택 RGBA/staged serialized/fresh 물리 중 무엇인지 확인한다. 확인된 API 의미만 고친 suffix를 저장된 성공 checkpoint에서 계속하고 원본 FP, 선택된 전체 K, 진짜 보호 G 및 실제 native/fresh 검증은 각자의 고정 근거로 유지한다. 원본 reader를 다시 검사해 생긴 실패 이력을 보존하고 성공 prefix를 재생성하지 않는다.
