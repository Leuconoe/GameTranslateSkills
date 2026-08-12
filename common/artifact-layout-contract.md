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
