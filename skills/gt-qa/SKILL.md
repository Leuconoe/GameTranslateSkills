---
name: gt-qa
description: "Integrated game-translation QA after text and conditional image review-ready handoffs: verify font coverage, structure, build, session ownership, emulator/runtime behavior, and logs/screenshots with fail-closed bench-versus-runtime evidence. Use for final patch QA, emulator testing, emucap evidence, or device verification."
---

# gt-qa — 통합 QA

텍스트·폰트·이미지 브랜치의 `review_ready` 후보를 깨끗한 원본에서 통합하고, 정적/bench
검증과 실제 실행 증거를 분리해 기록한다. review-ready는 사용자 승인이나 런타임 PASS가
아니며, 프로젝트 정책이 `user-gate`일 때만 해당 승인 증거를 추가로 요구한다.

## 입력 조건

시작 전 `PROJECT.md`, `WORK_LOG.md`, `HANDOFF.md`, 현재 manifest·staging hash와
`pipeline-contract.json`을 읽는다. 계약을 증명하지 못하면 `PROJECT.md`에 `BLOCKED`를 기록한다.

- `text_status=review_ready`, `text_review_approval=not_required|approved`,
  `font_status=verified`, `30_translation/text/reviews/TEXT_REVIEW_HANDOFF.md`
- `image_scope=required`이면 `image_status=review_ready`,
  `image_review_approval=not_required|approved`,
  `30_translation/image_translation/reports/IMAGE_REVIEW_HANDOFF.md`와
  이미지 build manifest. `image_scope=N/A`이면 0건 inventory와 `image_status=skipped`
- 현재 text/image candidate·manifest·hash, target language slot, platform/engine 계약
- `$GT_HOME/common/preflight-checks.md`, `qa-session-rules.md`,
  `emucap-integration.md`(사용 시), 플랫폼 build-test, 엔진 문서
- `text_review_policy=user-gate` 또는 `image_review_policy=user-gate`이면 각 시트 전 행과
  PROJECT 명시 승인 기록

입력 해시·Title ID·staging·세션이 다른 증거와 섞이면 `BLOCKED`다. 통합 후보를 만들기
전에 사용자 승인 여부를 추측하지 않는다.

## 절차

0. **소유권·세션 preflight**: literal 프로젝트 루트·Title ID·입력 파일·canonical
   staging을 inventory한다. `SESSION.json`과 remote Eden status를 비교하고, active 세션의
   key가 다르거나 pending/소유권 불명 상태이면 새 세션을 만들지 않는다. `eden` 아래의
   `sessions/`, `runs/`, `session-*`, `run-*`, `SESSION-2.json`, `(1)`·`copy` 산출물을
   발견하면 먼저 정리 계획을 만들고 QA를 중단한다.
1. **정책 게이트**: review policy가 `user-gate`이면 approval 필드가 `approved`이고 승인
   시각·시트 hash·전 행이 일치하는지 검증한다. `prepare-only`이면 approval이
   `not_required`이고 review handoff의 준비 증거만 요구해 자동 진행한다.
   어느 정책에서도 `review_ready`를 runtime PASS로 승격하지 않는다.
2. **깨끗한 통합**: 깨끗한 원본에서 승인/준비된 text·font·조건부 image를 한 번만
   재삽입한다. 기존 통합 트리나 이전 ZIP을 다시 패치하지 않으며 `artifact_key`와
   canonical 경로를 먼저 예약한다.
3. **폰트 재검증**: 최종 통합 입력의 전체 가시 코드포인트를 다시 추출하고
   `FONT_ATLAS_MANIFEST.tsv`·coverage·render probe hash와 대조한다. 실제 consumer에서
   한글·작은 글자·루비·active/inactive·행간·baseline·advance를 확인한다. mismatch면
   `font_status=blocked`로 되돌리고 텍스트 QA부터 재실행한다.
4. **정적 무결성**: 파일 수·구조·magic·컨테이너 parser·placeholder/control token·
   language slot·변경/비대상 diff·입출력 SHA-256을 전수 검사한다. 종료 코드 0이나
   로더 생존만으로 PASS하지 않는다.
5. **빌드**: 플랫폼 어댑터의 deterministic build를 실행해 `40_build/`와
   `BUILD_MANIFEST.tsv`를 만든다. stale 파일·다른 Title ID·중복 output·source overwrite가
   있으면 실패시킨다.
6. **런타임 선택**: `runtime_policy=static-first`이면 사용자의 명시적 실행 요청 전에는
   bench 결과와 `PENDING_RUNTIME`만 기록한다. 실행이 승인되면 최종 candidate에서만
   시험한다.
   - Eden은 capability/session 목록을 먼저 확인한다. 같은 session key면 새 create 없이
     재사용한다.
   - 새 세션이 필요하면 이전 `last_session_id`의 exact remote close와
     `project:qa-session --action close --remote-closed` 기록을 확인하고,
     `--previous-session-id <동일 ID>`를 사용해 한 번만 생성한다.
   - create/launch 실패 후 목록/status를 다시 읽기 전 재호출하지 않는다. 세션 ID·Title ID·
     profile path/hash·emulator version·build hash를 `SESSION.json`과 TEST_LOG에 귀속한다.
   - 테스트 종료 후 현재 session ID만 exact close하고 remote close 응답을 확인한 뒤 local
     state를 closed로 갱신한다. 프로세스 이름 기반 전역 종료나 타 프로젝트 세션 조작은 금지한다.
   - emucap을 사용하면 bootstrap/capability/launch/status/run_finish, intervention·artifact
     log와 hash를 프로젝트 원장에 남긴다.
7. **화면·경로 검수**: 실제 입력·화면 전이·메뉴·설정·저장/불러오기·백로그·튜토리얼·
   매뉴얼·엔딩 경로에서 한글 렌더링, tofu, glyph 위치, baseline, 폭/잘림, 이미지 표시를
   캡처로 확인한다. 로더 생존·패치 적용 로그·프로세스 생존은 화면 PASS가 아니다.
8. **갭 수정**: 문제를 배치·폰트·이미지·런타임·환경으로 분리하고 해당 branch로 되돌린다.
   런타임 실패는 깨끗한 원본에서 재빌드하며, 실패한 candidate/세션/로그를 새 복사본으로
   쌓지 않는다. 결과·제한·재시작 조건을 `HANDOFF.md`에 append-only로 남긴다.
9. **상태 기록**: `QA_REPORT.md`, `50_test/TEST_LOG.md`, build/test manifest에
   `PASS (bench)`, `PASS (runtime)`, `PENDING_RUNTIME`, `PENDING (hardware)`를 분리 기록한다.

## 산출물

- `40_build/`의 deterministic 통합 후보와 `BUILD_MANIFEST.tsv`
- `50_test/logs/`, `50_test/screenshots/`, `TEST_LOG.md`
- `50_test/eden/SESSION.json`, `ARTIFACT_MANIFEST.tsv`(프로젝트당 하나)
- `30_translation/QA_REPORT.md` 또는 프로젝트가 지정한 canonical QA report
- 폰트·텍스트·이미지 manifest hash와 runtime 증거

## 완료 기준

- [ ] text/image 입력 정책과 현재 hash가 일치하며 폰트·구조·컨테이너 정적 QA 통과
- [ ] 세션 소유권·Title ID·profile·build가 현재 증거에 exact 귀속됨
- [ ] runtime을 실행했다면 실제 입력·화면 전이·한글/glyph 위치·캡처가 있음
- [ ] 실행하지 않았다면 `PENDING_RUNTIME`/hardware 상태가 명시되고 PASS로 포장되지 않음
- [ ] 중복 세션·artifact key·timestamp/copy 파일이 없음
- [ ] 모든 갭이 해결되거나 제한·재현·다음 조건과 함께 Handoff에 기록됨

통과 시 `gt-release`로 진행한다.
