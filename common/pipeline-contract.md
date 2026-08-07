# 단계 계약과 하네스 규칙

이 문서는 게임 번역 스킬의 단계명·순서·상태·검수 정책을 고정하는 기준이다.
스킬 본문에 예전 단계 번호나 사용자 승인 규칙을 따로 정의하지 말고 이 계약을 따른다.
기계 검증기는 같은 내용을 [`pipeline-contract.json`](pipeline-contract.json)에서 읽는다.

## 기본 흐름

```text
gt-analyze
  → gt-text-analyze → gt-text-translate → gt-text-qa → gt-text-review
  → gt-image-analyze → gt-image-translate → gt-image-qa → gt-image-review
  → gt-qa → gt-release
```

`image_scope=N/A`이면 이미지 네 단계를 실행하지 않고 `image_status=skipped`와 0건
근거만 기록한 뒤 `gt-qa`로 이동한다. 이미지 범위가 아직 `pending`이면 생략하지 않는다.

## 검수의 의미

`text-review`와 `image-review`는 번역 결과를 다음 통합 QA에서 사용할 수 있도록
검수 시트·비교 자료·canonical staging·handoff를 준비하는 단계다. 기본 정책은
`prepare-only`이므로 사용자에게 허락을 묻거나 작업을 멈추지 않는다.

프로젝트에 다음 정책을 명시한 경우에만 선택적 대기 게이트가 활성화된다.

```text
text_review_policy: user-gate
image_review_policy: user-gate
text_review_approval: pending
image_review_approval: pending
```

`user-gate`가 아닌 경우에도 검수 결과를 생략하지 않는다. 검수 완료는
`review_ready`를 뜻할 뿐 사용자 승인이나 런타임 PASS를 뜻하지 않는다. 기본
`prepare-only`에서는 두 approval 필드를 `not_required`로 유지한다. `user-gate`에서는
검수 대기 시 `pending`, 사용자가 명시적으로 승인한 뒤에만 `approved`를 기록한다.

## 상태 분리

- 행 상태: `new → translated → reviewed → injected → device_verified` 또는 `blocked`
- 텍스트 브랜치: `pending → analyzing → translated → qa_ready → review_ready`
- 이미지 브랜치: `pending → analyzing → translated → qa_ready → review_ready` 또는 `skipped`
- 통합 QA: `pending → bench_ready → runtime_pending/passed`
- 릴리스: `pending → released`

브랜치 상태를 한 줄의 `approved` 또는 `done`으로 뭉개지 않는다. 특히 다음은 서로
대체할 수 없다.

```text
qa_ready ≠ review_ready ≠ user-approved ≠ PASS (runtime) ≠ released
```

## 단계별 canonical 산출물

| 단계 | 핵심 산출물 | 다음 단계의 입력 |
|---|---|---|
| `gt-analyze` | `30_translation/ANALYSIS.md`, 원본 inventory | 텍스트·이미지 범위 |
| `gt-text-analyze` | `text/TEXT_ANALYSIS.md`, `TEXT_SOURCE_INVENTORY.tsv`, `translation_manifest.tsv` | 텍스트 번역 입력 |
| `gt-text-translate` | manifest 갱신, `glossary.tsv`, `STYLE.md`, 작업 로그 | 텍스트 QA |
| `gt-text-qa` | `TEXT_QA_REPORT.md`, `TEXT_BUILD_MANIFEST.tsv`, text staging | 텍스트 review |
| `gt-text-review` | `30_translation/text/reviews/REVIEW_TEXT.tsv`, `30_translation/text/reviews/TEXT_REVIEW_HANDOFF.md` | 이미지 또는 통합 QA |
| `gt-image-analyze` | `IMAGE_ANALYSIS.md`, `IMAGE_SOURCE_INVENTORY.tsv`, `IMAGE_PLAN.tsv` | 이미지 번역 |
| `gt-image-translate` | `for_translation/`, 계획 상태 | 이미지 QA |
| `gt-image-qa` | `30_translation/image_translation/reports/IMAGE_QA_REPORT.md`, `30_translation/image_translation/reports/IMAGE_BUILD_MANIFEST.tsv`, image staging | 이미지 review |
| `gt-image-review` | `30_translation/image_translation/reports/REVIEW_IMAGE.tsv`, `30_translation/image_translation/reports/IMAGE_REVIEW_HANDOFF.md` | 통합 QA |
| `gt-qa` | build/test manifest, font·runtime evidence | 릴리스 |
| `gt-release` | adapter 계약의 canonical package와 notes | 완료 |

각 스킬은 시작 전에 프로젝트 정책·입력 해시·canonical 경로를 확인하고, 계약을
증명할 수 없으면 `WARN` 또는 `BLOCKED`를 기록한다. 파일 존재나 종료 코드 0만으로
단계 완료를 선언하지 않는다.
