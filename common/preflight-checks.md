# 공통 사전 경고 게이트

게임 번역 스킬을 직접 호출하거나 `game-translate` 파이프라인을 시작할 때
가장 먼저 적용하는 공통 점검이다. 이 문서는 작업을 빠르게 진행하기 위한 체크리스트가
아니라, 서로 다른 문서·타이틀·세션의 규칙을 잘못 섞는 것을 막는 fail-closed 게이트다.

## 1. 읽기 순서와 기준

작업을 변경하기 전에 다음을 읽고 현재 상태를 기록한다.

1. `$GT_HOME/common/SAFETY.md`
2. `$GT_HOME/common/project-structure.md`
3. `$GT_HOME/platforms/<platform>/PLATFORM.md`와 현재 단계의 플랫폼 문서
4. 프로젝트의 `PROJECT.md`, `WORK_LOG.md`, 존재하면 `HANDOFF.md`
5. 현재 입력 manifest·검수 시트·출력 폴더의 수정 시각, 크기, SHA-256, `git status`
6. 현재 문서가 참조하는 상대 경로의 존재 여부와 대소문자·폴더 위치

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
target_language_slot: pending          # 증명 전에는 pending
image_scope: required                  # required | N/A
release_contract: platform-adapter    # 플랫폼 문서의 정확한 경로·파일명 사용
```

- 공통 번역 배치는 편집 대상 80행이다. 타이틀이 40행을 사용해야 하면 `PROJECT.md`에
  명시적 근거를 남기고, 모든 배치·검수·manifest가 같은 값을 사용한다.
- 용어집의 canonical 경로는 `30_translation/text/glossary.tsv`다. 대소문자만 다른
  경로를 새로 만들거나 `GLOSSARY.tsv`를 참조하지 않는다.
- `runtime_policy` 기본값은 `static-first`다. `slot-probe`는 원본/안전 문자열 확인이
  꼭 필요할 때만 사용자 승인과 증거 경로를 함께 기록한다.
- 릴리스 파일명·폴더·ZIP 루트는 공통 스킬이 추측하지 않고 플랫폼 어댑터가 결정한다.

## 3. 즉시 경고·중단 조건

다음 항목은 경고만 남기고 진행하지 않는다.

- 40행과 80행 등 문서 간 숫자·상태·경로 계약이 다르며 적용할 `PROJECT.md` override가 없음
- 대상 프로젝트, Title ID, 입력 manifest, 출력 경로를 정확한 literal 경로로 확정하지 못함
- 추출 도구가 종료 코드 0을 반환했지만 파일 수·크기·매직·파싱·해시가 검증되지 않음
- 사용자 검수 단계의 검수 시트, 전 행 상태, 명시적 승인 기록이 없음
- `image_scope: N/A`인데 이미지 대상이 남아 있거나, 반대로 이미지 대상이 없는데 가짜 후보·검수 행을 만든 경우
- `static-first` 정책인데 런타임 실행을 요청받지 않았거나, 실행 결과를 현재 build에 귀속할
  입력 경로·Title ID·active mod·파일 해시·캡처가 없음
- 플랫폼 릴리스 계약과 다른 ZIP 이름·폴더·루트·파일 집합이 발견됨
- 입력 대상 수가 0이거나 예상 수와 다르고, 유효한 `N/A` 범위 근거 없이 빈 반복문·빈 report를 PASS로 만들 가능성이 있음
- 문서·스크립트가 참조한 상대 경로가 없거나 같은 파일을 대소문자만 다르게 가리킴
- 이전 candidate·다른 타이틀·다른 세션의 파일이 섞였거나 source/staging의 해시가 바뀜

경고는 다음처럼 분류한다.

```text
WARN                 전제 누락·문서 drift. 증거를 보강하기 전에는 다음 게이트로 이동하지 않음
BLOCKED              안전성·구조·입력 계약을 증명할 수 없음
PENDING_RUNTIME      정적/bench 검증은 가능하지만 런타임 증거가 아직 없음
PASS (bench)         정적·왕복·패키지 검증만 통과. 런타임 PASS가 아님
PASS (runtime)       현재 입력·Title ID·active mod·실제 화면 전이가 귀속된 런타임 통과
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

- [ ] 프로젝트 루트와 Title ID가 literal 경로로 확정됨
- [ ] `PROJECT.md`·최근 로그·manifest의 최신 해시를 읽음
- [ ] 현재 단계의 입력 게이트와 사용자 승인 여부가 증명됨
- [ ] 이미지 대상이 없으면 `PROJECT.md`·분석 결과에 `image_scope: N/A`와 근거가 기록됨
- [ ] 배치 크기·용어집 경로·런타임 정책·릴리스 계약이 서로 일치함
- [ ] 대상 수가 0이 아니거나 명시적 `N/A` 근거가 있으며, 실패·미확인 항목은 `blocked` 또는 `PENDING`으로 기록됨
- [ ] 불일치는 `HANDOFF.md`에 기록했고, 추측으로 진행하지 않음
