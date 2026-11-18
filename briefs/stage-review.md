# 텍스트 리뷰·im-not-ai (vars: P)

보고는 한국어 15줄 이내: 분류별 변경 행 수(말투/윤문/기타), 검증, 빌드 경로.

1. 읽기: RESUME.md State 줄, `common/glossary-rules.md` §7(humanize), `STYLE.md` 말투표.
2. 말투: STYLE.md의 화자×상대 말투표(원문 근거)대로 후보 행만 고친다. dupfill로 다른 화자 말투가 복사된 행도 잡는다.
3. 윤문: 번역투 패턴에 걸린 행만 대상으로 하고, 검수 서브에이전트는 동시에 2개까지 쓴다. 의미·이름·제어코드·줄바꿈·줄 폭을 지킨다.
4. 수정은 `P\30_translation\text\batches\review\REVIEW_EDITS.tsv`(`id<TAB>ko<TAB>category`, category = 말투/윤문/기타)에
   모은 뒤 `python -I <GT_HOME>/scripts/bulk/bulk_tool.py review-apply <edits.tsv> -p P`로 manifest에 원자적으로 1회
   반영한다(merge_log `REVIEW ... edits=<hash>`; 같은 edits가 이미 반영됐거나 검사 오류가 있으면 아무것도 쓰지 않고 거부).
   반영 전후로 `python -I <GT_HOME>/scripts/bulk/bulk_tool.py check-all -p P`가 OK여야 한다. 프로젝트 전용 적용 스크립트는
   만들지 않는다.
5. 폰트 범위 밖 한글이 새로 생기면 폰트를 다시 빌드한다. `integrated_r<N>`을 빌드하고 검증한 뒤,
   `50_test\TEXT_REVIEW.md`, RESUME.md State 줄, WORK_LOG 1줄을 갱신한다.
