# 텍스트 QA·폰트 (vars: P)

보고는 한국어 15줄 이내: 손댄 폰트와 방법, 커버리지, 빌드 경로, 검증 결과, 막힌 점.

1. 읽기: RESUME.md State 줄, `skills/gt-text-qa/SKILL.md` 절차, `engines/<engine>/ENGINE.md` 폰트 절.
2. 엔진 공용 폰트 도구(`engines/<engine>/tools/`)가 있으면 그것만 쓴다. 없으면 만들되, 두 번째 타이틀에서 쓰게 되면 공용으로 옮긴다.
3. 게임이 실제로 쓰는 폰트를 모두 찾고, 원본 글리프·메트릭은 그대로 둔 채 한글을 공통 배율 하나로 추가한다(OFL 글꼴, 출처 기록).
4. manifest 표시 문자 커버리지 100%를 증명한다. 엔진과 같은 방식으로 디코딩해 픽셀을 대조하고, 원본 글리프 변경이 0인지 확인한다.
5. `P\40_build\integrated_r<N>`을 빌드하고 텍스트·폰트 검증을 돌린다. `50_test\FONT_QA_REPORT.md`, RESUME.md State 줄, WORK_LOG 1줄을 갱신한다.
