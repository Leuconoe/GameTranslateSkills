# 이미지 (vars: P)

보고는 한국어 15줄 이내: 형식, 발견·조판·imagegen·보류·제외 수, QA, 빌드 경로.

1. 읽기: RESUME.md State 줄, `skills/gt-image-*` 절차, `engines/<engine>/ENGINE.md`. 이전 실행 산출물이 있으면 재사용한다.
2. 엔진 공용 이미지 코덱(`engines/<engine>/tools/`)을 먼저 쓰고, 무수정 왕복이 바이트 동일한지 증명한다.
3. 목록과 조판 사양을 표(`IMAGE_TEXT_INVENTORY.tsv`)로 먼저 만들고, 스크립트로 일괄 조판한다. 눈에 띄는 UI부터 한다.
4. 로고·장식 글자는 `npm run image:codex`로 직접 호출한다. 대상당 2회까지 시도하고, 실패하면 조판한다.
   사용자용 인계 문서는 만들지 않는다.
5. 교체만 한다. 아카이브 키 집합·순서·파일 목록은 원본과 같게 두고 새 키는 추가하지 않는다(M2 원칙 5).
6. 수치 QA(마스크 밖 변경 0, 재디코딩 일치)는 전수 검사하고, 이미지를 직접 보는 것은 대조표 10장 이내로 한다.
7. `integrated_r<N>`을 빌드하고 검증한 뒤, IMAGE_QA_REPORT.md, RESUME.md State 줄, WORK_LOG 1줄을 갱신한다.
