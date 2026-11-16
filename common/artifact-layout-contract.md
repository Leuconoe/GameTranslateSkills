# 작업 아티팩트 폴더링·수명 계약

번역 중 도구가 만드는 export, 번역 중간물, 테스트 산출물과 테스트 스크립트를 프로젝트
밖이나 임의 폴더에 흩어 놓지 않는다. 모든 관리 대상 파일은 아래 canonical root와
`90_tools/PROJECT_ARTIFACT_MANIFEST.tsv`에 함께 등록한다.

## Canonical roots

| class | stage | 경로 | 용도 |
|---|---|---|---|
| `source-export` | `extract` | `10_extract/exports/` | 추출기·엔진 export |
| `translation-source` | `translation` | `30_translation/exports/source/` | 번역 입력용 export |
| `translation-output` | `translation` | `30_translation/exports/translated/` | 번역 완료 export |
| `test-artifact` | `test` | `50_test/artifacts/` | 덤프·probe·비교 결과 |
| `test-script` | `test` | `90_tools/scripts/test/` | 타이틀별 재현 가능한 테스트 스크립트 |
| `work` / `cache` | 각 stage | `90_tools/work/<extract|translation|build|test>/` | 재생성 가능한 중간 작업물·캐시 |

기존 canonical manifest, glossary, 보고서, LayeredFS, 로그, screenshot, runtime receipt는
기존 단계 경로를 유지한다. 이 하네스는 그 파일들을 다른 곳으로 이동시키는 계약이 아니다.

## PROJECT_ARTIFACT_MANIFEST.tsv

열은 다음 순서를 exact 유지한다.

```text
artifact_key	stage	class	lifecycle	path	producer	reproduce_command	sha256	status	notes
```

- `artifact_key`: `<프로젝트 ID>/<stage>/<logical-name>` 형태의 안정 키
- `lifecycle`: `canonical`, `evidence`, `reproducible`, `disposable`
- `status`: `active`, `complete`, `failed`, `superseded`, `archived`
- `path`: 프로젝트 상대 경로. 절대경로, `..`, link/reparse point 금지
- `producer`: 생성 도구·스크립트·단계
- `reproduce_command`: `reproducible`이면 필수. 프로젝트 내부 경로를 출력으로 명시
- `sha256`: 현재 파일의 64자리 SHA-256

관리 root 안의 모든 파일은 index에 등록한다. 같은 key/path 중복, 잘못된 class 경로,
누락 파일, hash drift, 미등록 파일은 `project:artifacts -- --validate`에서 실패한다.

## 반복 작업 방지 (하네스 강제)

완료된 프로젝트를 정리해 보니 공간 대부분이 같은 작업의 반복 결과였다: 후보 빌드마다
전체 staging 복사, 시험할 때마다 패치 payload·에뮬레이터 프로필 사본, 배치마다 manifest 백업.
하네스는 다음을 강제한다.

- **실행 전 재사용 조회**: producer를 다시 돌리기 전에
  `npm run project:artifacts -- --project-root "<루트>" --reuse-check --producer "<p>" --reproduce-command "<c>"`
  를 실행한다. `REUSE`면 그 경로를 쓰고 다시 만들지 않는다. `NONE`(exit 3)일 때만 실행한다.
  입력이 바뀌었으면 `reproduce_command`에 입력 identity(파일 hash·버전)를 넣어 다른 작업으로 구분한다.
- **같은 내용 복사 금지**: SHA-256이 같은 파일을 두 경로에 등록하면 등록·검증이 실패한다
  (빈 파일 제외). 다른 단계에서 같은 파일이 필요하면 복사하지 말고 기존 경로를 참조한다.
- **같은 작업의 active 중복 금지**: 같은 producer·reproduce_command로 `active` 항목이 둘이면 실패한다.
  다시 실행해야 하면 이전 항목을 `superseded`로 바꾼 뒤 등록한다. `superseded`·`failed`는
  정리 후보이며, 새 결과가 검증되면 그 단계 안에서 바로 정리 계획에 올린다.
- **빌드는 한 벌**: 후보마다 staging 전체를 새 폴더로 복사하지 않는다. canonical
  `40_build/layeredfs/<ID>/`를 원자 교체하고, 비교가 필요하면 바뀐 파일 목록·hash만 남긴다.
  보존하는 이전 후보는 직전 1개까지다.
- **시험은 참조로**: 런타임 시험은 canonical ZIP을 hash로 참조해 에뮬레이터 세션 load root에
  스테이징하고, `50_test`에는 로그·캡처·receipt만 남긴다. 패치 payload·세션 프로필·NAND 사본을
  `50_test`에 두지 않는다.
- **백업 대신 이력**: manifest를 배치마다 `*.backup`으로 복사하지 않는다. 배치 결과 파일과
  병합 보고서(입력/출력 hash)로 되돌릴 수 있게 한다.

## 생성·정리 흐름

1. 신규 프로젝트는 하네스 폴더와 빈 index를 자동 생성한다. 기존 프로젝트는 다음을 실행한다.

   ```text
   npm run project:artifacts -- --project-root "<프로젝트 루트>" --init
   ```

2. 도구 실행 전 output 경로·artifact key·class·lifecycle을 정하고, 완료 후 파일 SHA-256과
   producer/reproduce command를 manifest에 기록한다. 직접 TSV를 편집하는 대신 다음 명령을
   사용하면 경로·class·lifecycle을 검사하고 SHA-256을 자동 계산한다.

   ```text
   npm run project:artifacts -- --project-root "<프로젝트 루트>" --register \
     --artifact-key "<PROJECT_ID>/test/<logical-name>" --stage test \
     --class test-artifact --lifecycle disposable \
     --path "50_test/artifacts/<파일>" --producer "<도구/스크립트>" --status complete
   ```
3. `canonical`·`evidence`는 보존 anchor다. `reproducible`·`disposable` 중
   `complete`·`failed`·`superseded`인 exact 파일만 cleanup 후보가 될 수 있다.
4. index에 없는 managed-root 파일은 자동 삭제하지 않고 `BLOCKED` 후보로 보고한다.
   기존 `50_test/` 직속 산출물·비표준 테스트 트리, `90_tools/` 직속 도구 출력,
   `90_tools/scripts/`의 test/QA/probe 스크립트, 표준 단계 밖 프로젝트 root도 legacy로
   탐지하고 이동 전까지 `BLOCKED`로 둔다.
5. `project:cleanup`은 index와 실제 hash를 다시 대조한 뒤 기존 계약대로 계획→아카이브→
   전수 재검토→사용자 보고까지만 수행한다. 이후 별도 승인 전에는 휴지통으로 보내지 않는다.
