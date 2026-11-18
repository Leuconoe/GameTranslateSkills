# 릴리스 (vars: P, TID)

보고는 한국어 15줄 이내: ZIP 경로, 크기, SHA-256, 항목 수, 검증 결과.

1. 패키징: `npm run release:package:nsw -- --project-root "P" --replace` → `npm run release:validate:nsw`.
   타이틀 루트의 `_release\<한국어 제목> - TID.zip`이 된다. 4GiB 이상 항목은 Zip64가 자동 적용된다.
2. 노트: `npm run release:notes -- --out "<타이틀 루트>\_release\RELEASE_NOTES.md" --title "<한국어 제목>"
   --game-date <YYYY-MM-DD> [--date-basis "..."] --patch-version v0.0.1 --support-version "..." --lang-method "..."
   --changelog "v0.0.1 - 초도 배포" --caution "..." --zip "<ZIP>"`.
   - 게임 출시일은 `PROJECT.md`의 출시일을 쓴다. 없으면 gt-release §3 기준(대상판 → 다른 지역판 → 이식판이면 원작)으로
     빠르게 조사해 `PROJECT.md`에 근거와 함께 적는다.
   - exFAT 안내와 `*` 판정은 생성기가 처리한다. 손으로 노트를 쓰거나 예전 타이틀 노트를 복사하지 않는다.
3. 스크린샷: Eden 캡처 4~6장을 `_release\screenshots\NN_<what>.png`로 복사한다.
4. RESUME.md State 줄, PROJECT.md release_status, WORK_LOG 1줄을 갱신한다.
