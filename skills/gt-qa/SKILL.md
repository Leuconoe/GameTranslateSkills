---
name: gt-qa
description: "Stage 6 of game localization - full verification with fail-closed structure/font/build checks, explicit bench-versus-runtime evidence, session ownership checks, and logs/screenshots. Use when QA testing a translation patch, emucap runtime evidence, 전체 검수, or 실기 시험."
---

# gt-qa — 6단계: 전체 검수

승인된 번역을 게임에 재삽입해 빌드하고, 실제 실행 환경에서 검증한다.

> `$GT_HOME` = 지식 베이스 루트. Codex에서는 이 스킬이 설치된 플러그인 루트(상위에 `.codex-plugin/`, `skills/`, `common/`이 있는 디렉터리)로 해석하고, Claude Code 플러그인에서는 `${CLAUDE_PLUGIN_ROOT}`를 사용한다. 플러그인 외 수동 설치는 지원하지 않는다.
> 시작 전에 `$GT_HOME/common/preflight-checks.md`를 읽고 사용자 승인·runtime policy·canonical staging·세션 소유권을 확인한다.
> 작업 중 문서와 실제의 괴리·막힌 지점·우회법을 발견하면 **즉시** 프로젝트 `HANDOFF.md`에 기록한다 (`$GT_HOME/common/handoff-rules.md`).

## 입력 조건

- 3단계 텍스트 사용자 승인 완료. 이미지 대상이 있으면 5단계 이미지 사용자 승인도
  완료되어야 하며, 대상이 없으면 `image_scope: N/A` 근거가 있어야 한다.
- `REVIEW_TEXT.tsv` 전 행 승인 상태와 `PROJECT.md`의 명시적 승인 기록. 이미지 대상이 있으면
  `REVIEW_IMAGE.tsv` 전 행 승인도 필요하며, 대상이 없으면 `image_scope: N/A`와 0개 inventory를 확인한다.
- 플랫폼 어댑터 로드: `$GT_HOME/platforms/<platform>/build-test.md`
- 엔진 모듈 로드: `$GT_HOME/engines/<engine>/ENGINE.md`
- emucap을 사용할 경우 `$GT_HOME/common/emucap-integration.md`를 추가로 읽는다. emucap은
  선택 사항이며, 미설치·미지원이면 플랫폼 어댑터의 기존 실행시험으로 진행한다.

## 절차

0. **QA 전제·런타임 경고 게이트**: 텍스트 승인 증거, 이미지 대상의 승인 또는 `N/A` 근거,
   입력 manifest, canonical staging의 파일 목록·
   SHA-256이 현재 프로젝트와 일치하는지 확인한다. `runtime_policy=static-first`이면 중간
   배치에서 에뮬레이터를 실행하지 않고, 최종 시험도 사용자의 명시적 요청 전에는 정적/bench
   검증만 수행한다. 다른 세션·다른 Title ID·이전 candidate의 로그나 active mod는 현재 PASS의
   근거로 사용하지 않는다.

1. **폰트 준비**: 번역 텍스트의 전체 사용 문자 집합을 추출해 폰트의 한글 글리프
   커버리지를 검증. 부족하면 엔진 모듈의 폰트 주입 절차 수행
   (Unity TMP/SDF는 원본 메트릭 보존 + 공통 스케일 1개 — 엔진 문서 참조).
2. **재삽입**: 승인된 TSV를 게임 포맷으로 역변환하고, 이미지 대상이 있으면 번역 이미지를 원본 위치에 재삽입한다.
   왕복 무손실 검증(2단계에서 증명한 스크립트)을 전체 파일에 재실행.
3. **정적 무결성 검사** (빌드 전 — 실행 시험보다 먼저, 저비용 검사 우선):
   - 파일 수·구조 일치, 컨테이너 포맷 유효성 (플랫폼 어댑터의 검증 명령)
   - 플레이스홀더·제어코드 보존 전수 스캔
   - 변경된 컨테이너 목록과 크기 변화 기록 (큰 패치 ≠ 실패 — 원인 문서화)
4. **빌드**: 플랫폼 어댑터의 빌드 절차로 패치 생성 → `40_build/` (커밋 제외).
   빌드는 결정적(deterministic)이어야 함 — 같은 입력이면 같은 출력.
5. **실행 시험** (플랫폼 어댑터의 실기 시험 절차):
   - **중간 배치마다 실행하지 않는다** — 번역·병합·빌드·정적 검사·패키징을 끝낸 뒤
     최종 산출물에 대해 1회 수행하는 것이 기본
   - emucap을 선택했다면 Control/Tracking MCP의 `bootstrap` → capability 확인 →
     `launch_plan`/`launch` → `status` → `get_rom_info`/`run_start` 순서로 시작하고,
     프로젝트별 `50_test/emucap/` 원장 경계를 먼저 확인
   - emucap의 메모리 쓰기·입력·상태 변경은 Tracking MCP `log_intervention`으로 기록하고,
     캡처·로그·덤프는 `log_artifact`로 SHA-256을 남김
   - 실제 입력(확인/저장/다음 화면 전이)을 통과해야 실행 성공으로 판정
   - 로더 생존·패치 적용 로그·프로세스 생존·종료 코드만으로 PASS를 선언하지 않는다.
     입력 경로, 실제 Title ID, active mod, 교체 파일 수, 화면 전이와 캡처를 귀속한다.
   - 하드웨어를 사용할 수 없으면 bench 결과와 `PENDING (hardware)`를 분리 기록하고
     `PASS (hardware)`로 추론하지 않는다.
   - 환경(에뮬레이터/펌웨어/입력·설정)·종료 코드·로그·캡처를 `50_test/`에 보존
   - 실행 중 인스턴스는 새 패치를 핫리로드하지 않음 — 재시작 필요를 기록
6. **화면 검수**: 실행 캡처에서 확인 — 한글 렌더링(깨짐·두부문자 없음), 텍스트 넘침/
   잘림, 폰트 크기 일관성, 이미지 표시 정상.
7. **갭 분석·수정 (PDCA Check→Act)**: 발견된 문제를 유형별로 기록하고 해당 배치/이미지만
   수정 → 3번부터 재실행. 런타임 실패는 번역·폰트 변경과 분리해 원인 조사
   (로그 먼저, 우회책은 마지막).

## 산출물

| 경로 | 내용 |
|-----|------|
| `40_build/` | 패치 빌드 산출물 |
| `50_test/logs/`, `50_test/captures/` | 실행 로그·스크린샷 (환경 정보 포함) |
| `50_test/emucap/` | 선택적 emucap Tracking 원장·런타임 증거 |
| `30_translation/QA_REPORT.md` | 정적 검사 결과, 실행 판정, 발견·수정 내역 |

## 완료 기준

- [ ] 정적 무결성 검사 전 항목 통과
- [ ] 최종 산출물로 실행 시험 통과 (실제 입력·화면 전이·저장 확인, 증거 보존)
- [ ] 한글 렌더링·레이아웃 이상 없음 (캡처로 확인)
- [ ] emucap 사용 시 `run_finish`, 개입 기록, 산출물 해시가 프로젝트 원장에 남음
- [ ] 발견 문제 전건 수정 완료 또는 알려진 제한으로 문서화
- [ ] `PASS (bench)`, `PASS (runtime)`, `PASS (hardware)`, `PENDING_RUNTIME`이 서로 혼동되지 않음

통과 시 `gt-release`로 진행한다.
