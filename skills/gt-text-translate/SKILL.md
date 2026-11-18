---
name: gt-text-translate
description: "Text branch translation after text analysis: batch-translate extracted game text (JA/EN/ZH to Korean) with glossary accumulation, tone consistency, structure validation, explicit batch-policy checks, and fail-closed warnings. Use when translating game text, dialogue, or UI."
---

# gt-text-translate — 텍스트 브랜치 T2: 텍스트 번역

추출된 텍스트를 배치 단위로 일→한(또는 영/중→한) 번역하고 용어집·말투를 누적 관리한다.

> `$GT_HOME` = 지식 베이스 루트. Codex에서는 이 스킬이 설치된 플러그인 루트(상위에 `.codex-plugin/`, `skills/`, `common/`이 있는 디렉터리)로 해석하고, Claude Code 플러그인에서는 `${CLAUDE_PLUGIN_ROOT}`를 사용한다. 플러그인 외 수동 설치는 지원하지 않는다.
> 시작 전에 `$GT_HOME/common/preflight-checks.md`를 읽고 `batch_size`, 용어집 경로, manifest 해시와 타이틀별 override를 확인한다.
> 작업 중 문서와 실제의 괴리·막힌 지점·우회법을 발견하면 **즉시** 프로젝트 `HANDOFF.md`에 기록한다 (`$GT_HOME/common/handoff-rules.md`).

## 입력 조건

- `gt-text-analyze` 산출물: `TEXT_ANALYSIS.md`, `TEXT_SOURCE_INVENTORY.tsv`, canonical
  `30_translation/text/translation_manifest.tsv`
- 상세 규칙 로드: `$GT_HOME/common/glossary-rules.md` (배치 구성·용어집·검증 규칙의 원본)
- `PROJECT.md`의 유효 배치 크기와 `30_translation/text/glossary.tsv` 경로 선언

## 명시된 일괄 작업과 확정 표기의 빠른 처리

- 사용자가 전체 TXT의 일괄·병렬 번역을 명시하면 `PROJECT.md`에 그 override를 기록하고
  `common/preflight-checks.md` §6의 원문 동결·전량 비중첩 고정 배정을 적용한다.
  이 경우 기본 소규모 배치·직렬 규정 대신 명시된 전체 작업 정책을 따르며, 모델 입력
  페이지마다 재예약·윤문·검수·canonical 병합을 반복하지 않는다.
- 순수 숫자·문장부호·기호·제어 토큰과 확정 용어집의 명확한 이름표는
  `glossary-rules.md` §8의 빠른 처리 범위·문맥 예외·출처 기록을 따른다.
  동일 이름의 수백 binding을 모두 수작업 재독하는 절차를 만들지 않는다.
- 기존 KO가 있는 의미 검수에서는 `common/preflight-checks.md` §6의 실제 재독·
  read-range receipt·희소 수정 정책을 사용한다. 공유 문맥은 한 번 로드하고 수정·보류만
  모델이 출력하며, 코드의 유지 행 복사는 실제 대조가 확인된 ID에만 허용한다.
  변경 없는 행의 검증 캐시와 changed-only 검사 뒤 전량 최종 integrity gate를 유지한다.
- im-not-ai(`humanize-korean`) 윤문은 품질 향상을 위한 **기본 단계**다. `PROJECT.md`의
  `humanize_policy`가 `off`가 아니면 1차 번역 전체 병합·구조 검증 뒤, 독립 2차 검수 전에
  `glossary-rules.md` §7 절차로 한 번 수행한다. 전체 초안이 확정되기 전에 내부 페이지마다
  별도 윤문 run을 반복하지 않는다. 스킬이 없으면 `WARN`을 남기고 2차 검수의 번역투
  점검을 강화한다.

## 도구 호출 예산 (반복 호출 방지)

`common/preflight-checks.md` §6을 번역 루프에 구체화한다. 목표는 **배치 1개당 도구 호출 3회**다.

1. **읽기 1회**: 배치 입력(ID·원문·참고 언어·화자)을 한 파일로 만든 chunk를 한 번에 읽는다.
   행 단위 Read/grep, 같은 파일의 부분 재열람을 하지 않는다.
2. **쓰기 1회**: 배치 번역 결과를 정해진 출력 파일 하나로 통째로 쓴다. 행마다 Edit하지 않는다.
3. **검증·병합 1회**: 구조 검증·용어집 대조·병합을 하나의 프로젝트 스크립트
   (`90_tools/scripts/`)로 묶어 한 번 실행한다. 작은 셸 명령 여러 개로 쪼개지 않는다.

- 용어집·`STYLE.md`·화자 역할표는 세션(또는 컨텍스트 압축 후)마다 한 번 로드한다. 배치마다
  다시 읽지 않고, 내용이 바뀐 경우에만 변경분을 읽는다.
- 같은 도구를 같은 인자로 다시 호출하지 않는다. 실패하면 원인을 바꾼 뒤 한 번만 재시도하고,
  같은 실패가 두 번이면 중단해 원인을 `WORKLOG.md`·`HANDOFF.md`에 기록한다.
- 진행 상황을 확인하려고 파일·프로세스를 반복 조회(polling)하지 않는다. 백그라운드 작업은
  완료 알림을 기다린다.
- 전체 manifest 전수 읽기·전수 검증은 최종 integrity gate에서 한 번만 한다. 그 전에는 바뀐
  배치만 검사한다.
- 사용자가 일괄·병렬 번역을 명시해 병렬 서브에이전트를 쓰는 경우에도 배치 파일 경로만
  넘기고, 각자 읽기 1회·쓰기 1회로 끝내게 한다.
- 배치당 호출이 예산을 넘으면 그 원인(누락 문맥, 스크립트 부재 등)을 `WORKLOG.md`에 남기고
  다음 배치 전에 입력 chunk나 스크립트를 고쳐 같은 초과가 반복되지 않게 한다.

## 절차

0. **배치·경로 사전 점검**: 공통 기본 배치는 편집 대상 80행이다. 40행 등 다른 크기는
   `PROJECT.md`의 명시적 override와 근거가 있을 때만 사용하고, 중앙 지침·title-local workflow·
   manifest가 같은 값을 쓰는지 확인한다. 문서가 충돌하거나 override가 없으면 임의로 축소하지
   말고 `WARN`/`BLOCKED`와 `HANDOFF.md` 기록 후 읽기 전용 조사만 한다. 용어집은 오직
   `30_translation/text/glossary.tsv`를 사용한다.

1. **기준 언어 결정**: 원문 품질이 가장 좋은 언어를 기준 언어로, 나머지를 참고 언어로.
   중의적 표현은 참고 언어와 교차 확인 (`glossary-rules.md` §기준 언어).
2. **기준 manifest 사용**: `gt-text-analyze`가 만든 canonical
   `30_translation/text/translation_manifest.tsv`만 갱신한다. 임의의 `*.tsv` 복사본을
   canonical 입력으로 만들지 않으며, 역변환(TSV→게임 포맷)이 무손실임을 왕복 테스트로
   증명한다.
3. **배치 구성**: `glossary-rules.md`의 chunk 전략에 따라 배치 분할.
   여러 에이전트가 같은 파일을 동시에 쓰지 않도록 단일 메인 에이전트가 chunk를 처리하고,
   서브에이전트는 읽기 전용 조사만 담당.
4. **1차 번역·윤문**: 배치별 번역. 규칙:
   - 인게임 텍스트·UI 우선 (시스템 메시지보다 사용자가 보는 텍스트 먼저)
   - 플레이스홀더(`%s`, `{0}`, 제어코드, 태그, 개행)는 **원문 그대로 보존**
   - 말투(존댓말/반말, 캐릭터별 어투)는 `STYLE.md`에 캐릭터별로 정의하고 일관 적용
   - UI 텍스트는 표시 폭 제한 고려 (원문보다 과도하게 길어지지 않게)
   - **루비(읽기 표기)는 한국어에 남기지 않는다** (사용자 지시 2026-11-17). 일본어 한자 읽기를 돕는
     루비 그룹(엔진별 `@r본문@읽기@`, `{ruby:…}`, `[ruby=…]`, `[읽기]` 등)은 제거하고 본문만 번역한다.
     읽기 자체에 뜻이 있으면(말장난·특수 호칭·외래어 병기) 루비 없이 본문 안에 자연스럽게 풀어 쓴다.
     구조 검사는 "루비 그룹 수 = 원문"이 아니라 "한국어 루비 0개, 나머지 토큰 순서·개수 동일"로 맞추고,
     루비 태그를 지운 뒤에도 엔진 파서가 행을 정상 해석하는지 실주입·재추출로 확인한다.
5. **용어집 누적**: 고유명사(인명·지명·아이템·스킬명)는 첫 등장 시
   `30_translation/text/glossary.tsv`에
   `원문 │ 번역 │ 유형 │ 근거` 로 등록하고 이후 배치에서 강제 준수. 배치 시작 전
   용어집을 프롬프트에 주입.
6. **배치별 구조 검증**: 번역 완료 배치마다 즉시 검증 (병합 게이트). 일괄·이어하기 실행은 예외로,
   `glossary-rules.md` "일괄 번역 이어하기 하네스"대로 타이틀 끝에 1회만 검증한다:
   - 행 수/ID 일치, 플레이스홀더·태그·개행 보존, 빈 번역 없음, 미번역 원문 잔존 없음
   - 검증 실패 배치는 병합 금지, 해당 배치만 수정 후 재검증
7. **im-not-ai 기본 윤문**: 전 배치 병합·구조 검증이 끝나면 `humanize_policy`가 `off`가
   아닌 한 `glossary-rules.md` §7대로 `humanize-korean`을 작품 단위로 한 번 실행해 번역투·
   문장 흐름을 다듬는다. 윤문 결과도 6단계 구조 검증을 다시 통과해야 병합하며, run·원문·
   최종본·게이트 증거는 `90_tools/work/translation/humanize/<run>/`에 두고
   `PROJECT_ARTIFACT_MANIFEST.tsv`에 `evidence`로 등록한다. 이어서 독립 2차 검수를 한다.
8. **작업 로그**: 배치별 상태(완료/실패/재실행)를 `30_translation/WORKLOG.md`에 기록
   (일괄·이어하기 실행은 파트별 기록 없이 `out/` 파트 파일이 진행 기록이다).
   실패 배치는 원인과 함께 기록하고 재실행 시 실패분만 처리.

## 일괄 번역 보조 규칙 (실증)

- **이어하기 하네스**: 일괄 번역은 `glossary-rules.md` "일괄 번역 이어하기 하네스"를 따른다. 준비가 끝나면
  `30_translation/RESUME.md`를 쓰고, 이어하기 실행은 그 파일과 원문 slice만 읽으며, 재개 지점은 `out/` 파트
  파일에서 구하고, 검사·병합·주입 검증은 타이틀 끝에 1회만 한다.
- **동일 원문 재사용**: 분기·회상 반복이 많은 작품은 이미 번역한 동일 원문 행을 같은 번역으로 채우는
  보조 스크립트(dupfill)를 실행 시작 시 1회 먼저 돌리고 남은 행만 번역한다(같은 시리즈의 끝난 타이틀 TM 선택). 산출 파트 파일 이름도
  `check`가 읽는 패턴(`P*.tsv`, 예: `PD<first>.tsv`)을 따라야 누락되지 않는다.
- **병합 후 재검사**: 단일 병합이 끝나면 `status=translated`이므로 같은 `check`는 실패하는 것이 정상이다.
  병합 이후 검증은 실주입·재추출 대조로 한다.

## 번역 보류(HELD) 행과 사용자 인계

에이전트가 내용상 번역하지 않기로 한 행은 다음처럼 처리한다. **보류 행 때문에 작업을 멈추거나 사용자 답을
기다리지 않는다.** 나머지 행을 끝내고 상태값을 바꾼 뒤 다음 단계·다음 게임으로 진행한다.

- **보류는 좁게**: 실제로 문제가 되는 행(노골적인 성적 묘사·성행위·페티시 중심 내용 등)만 보류한다. 일반적인
  목욕·수영복·메이드 장면, 가벼운 장난, 연애 묘사는 평소대로 번역한다.
- **인물 연령은 공식 설정으로 판단한다.** 외형·학원 배경만으로 미성년으로 단정하지 않는다. 공식 연령·등급을
  확인하거나 사용자가 알려 주면 `PROJECT.md`에 근거와 함께 적는다. 연령과 무관하게 노골적인 성적 내용은 위 기준대로 보류한다.

1. `30_translation/text/batches/bulk/HELD_ROWS.tsv`(`first	last	reason`)에 구간과 사유를 기록한다.
   보류 행은 파트·병합에서 제외되고 `status=new`·원문 유지로 남으며(이미 `<KEEP>`로 병합했다면
   notes에 `keep_source`), 나머지 행만으로 병합·실주입 검증을 끝낸다.
   - `PROJECT.md`: `text_status=translated_with_held` (예: `translated_with_held (held 1,043 rows; user)`),
     `HELD_ROWS.tsv` 경로와 행 수를 기록한다.
   - `GAME_REGISTRY.tsv` 진행 문구: `Text translated …; HELD <n> rows (user)`처럼 보류 수를 남긴다.
   - 보류 행이 원문 그대로라도 빌드·폰트(원문 글리프 포함)·검수 단계는 계속 진행한다.
2. **사용자 산출물 `30_translation/text/HELD_FOR_USER.tsv`를 항상 만든다**(UTF-8 BOM, TSV). 내부 목록에만
   두지 않는다. 열은 정확히 2개: `id	text`. `text`에는 원문을 넣고, 사용자는 그 칸을 번역문으로 덮어쓴다
   (별도 번역 열은 없다).
   보류 행이 0개여도 헤더만 있는 파일을 써서 "없음"과 "안 만듦"이 구분되게 한다. 번역 실행 중 보류가 생길 때마다
   이 파일에 이어 쓴다. `HANDOFF.md`와 `RESUME.md` 마지막 단계에 이 파일 경로와 행 수를 적는다.
   사용자는 텍스트 번역이 끝난 뒤 채운 파일을 돌려주며, 파이프라인은 기다리지 않고 병합·다음 단계를 진행한다
   (돌려받으면 그때 아래 3번으로 병합한다).
3. 사용자가 돌려준 파일은 `import-held`로 병합한다. `text`가 manifest 원문과 다른 행을 그 행의 번역으로 보고,
   다른 행과 같은 구조 검사를 거친다. fail-closed: 보류 행·`status=new`·`check_row`와 같은 구조 검사를 통과하지
   못하면 아무것도 병합하지 않는다. `text`가 원문 그대로인 행은 미번역으로 남고 상태는 `translated_with_held`다.
   병합 로그는 `USER_HELD`, 행 notes에 `user_translated`를 남기고 이어서 실주입 검증을 한다.
4. 사용자 파일은 형식이 다를 수 있다(헤더·`ja` 열 누락 등). id로 원본에 다시 맞추고, **기계적 정리만**
   한다: 끝 태그(`{rt2}` 등) 복원, 직선 따옴표 → 원문과 같은 「」/『』, 용어집 이름 표기 통일,
   `・`→`·`, 공백 정리. 내용 검수·윤문은 하지 않으며, 남은 구조 오류 행은 행 번호와 원인만 알려 준다.
5. 용어집과 다른 동의어는 자동 치환하지 않고 행 번호와 함께 사용자에게 확인받는다.

## 산출물

| 파일 | 내용 |
|-----|------|
| `30_translation/text/*.tsv` | 번역 시트 (전 행 상태 표시) |
| `30_translation/text/glossary.tsv` | 누적 용어집 |
| `30_translation/STYLE.md` | 말투·문체 규칙 (캐릭터별) |
| `30_translation/WORKLOG.md` | 배치 작업 로그 |
| `30_translation/text/HELD_FOR_USER.tsv` | 보류 행 사용자 산출물 `id	text` (사용자가 text를 번역문으로 덮어씀; UTF-8 BOM, 0행이어도 헤더만) |

## 완료 기준

- [ ] 대상 텍스트 100% 번역 (상태=translated), 구조 검증 전 배치 통과
- [ ] 용어집 위반 0건 (전 배치 대상 용어집 대조 스캔)
- [ ] `humanize_policy`가 `off`가 아니면 im-not-ai 윤문 실행·게이트 증거가 있고 윤문 후 구조 검증 통과
- [ ] 왕복 변환(TSV→게임 포맷→TSV) 무손실 확인
- [ ] 배치 크기·용어집 경로·입력 manifest 해시가 `PROJECT.md`와 일치함

완료 시 `gt-text-qa`로 진행한다. 이 단계에서 사용자 허락을 기다리지 않는다.
