# 서브에이전트 브리프 템플릿

코디네이터는 긴 브리프를 매번 새로 쓰지 않는다. 실행 프롬프트는 아래처럼 템플릿 경로와 변수만 넘긴다.

```
Read and follow <GT_HOME>/briefs/<template>.md. Vars: P=<project root>; TID=<base title id>; ...
```

| 템플릿 | 용도 | 필수 변수 |
|---|---|---|
| `translate-continue.md` | 일괄 번역 이어하기 | P |
| `stage-font.md` | 텍스트 QA·폰트 (gt-text-qa) | P |
| `stage-review.md` | 텍스트 리뷰·im-not-ai (gt-text-review) | P |
| `stage-image.md` | 이미지 분석·조판·imagegen·QA | P |
| `eden-qa.md` | Eden 짧은 런타임 QA (+완수 시 릴리스) | P, TID, CANDIDATE, PREFIX, TAG |
| `release.md` | 릴리스 패키징·노트·검증 | P, TID |

모든 템플릿에 공통으로 적용되는 것:
- 최상위 규칙(공용 도구만 쓴다)과 `common/harness-performance.md`
- 보고는 한국어, 이어하기는 3줄, 단계 완료는 15줄 이내
- 절대 경로, `-LiteralPath`, 삭제·링크·git 금지, 레지스트리·메모리·AGENTS.md 수정 금지

타이틀 전용 사실(재개 지점, 엔진 특이사항, 남은 결함)은 브리프가 아니라 그 타이틀의 `30_translation/RESUME.md`
State 줄에 둔다.
