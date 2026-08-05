---
name: gt-image-translate
description: Stage 4 of game localization - translate text-bearing images/textures. Codex agents generate images via imagegen; Claude agents analyze and plan only (generation deferred to user). Use when translating game images/이미지 번역/텍스처 한글화.
---

# gt-image-translate — 4단계: 이미지 번역

문자가 그려진 텍스처·아틀라스·타이틀 로고 등을 한글판으로 교체 준비한다.
**실행 에이전트에 따라 처리 방식이 다르다.**

> `$GT_HOME` = 지식 베이스 루트 (플러그인 설치: `${CLAUDE_PLUGIN_ROOT}` / 수동 설치: 환경변수 `GT_HOME`).
> 작업 중 문서와 실제의 괴리·막힌 지점·우회법을 발견하면 **즉시** 프로젝트 `HANDOFF.md`에 기록한다 (`$GT_HOME/common/handoff-rules.md`).

## 입력 조건

- `gt-text-review` 승인 완료 (이미지 내 텍스트 번역어가 승인된 용어집·문체를 따라야 하므로)
- `ANALYSIS.md`의 이미지 대상 목록
- 엔진 모듈 로드: `$GT_HOME/engines/<engine>/ENGINE.md` (텍스처 추출/재삽입 방식)

## 에이전트별 분기 (필수 준수)

| 환경 | 동작 |
|-----|------|
| **Codex** (imagegen 스킬 사용 가능) | 분석 + imagegen으로 한글 이미지 생성 + 재삽입 준비까지 수행 |
| **Claude** (이미지 생성 불가) | **분석·계획까지만** 수행하고 생성은 보류(hold). 사용자/Codex에 이관 |

Claude 환경에서 이미지 생성을 시도하거나, 생성 없이 원본을 그대로 두고 완료 처리하는 것 모두 금지.

## 절차

1. **이미지 인벤토리 정밀화**: `ANALYSIS.md`의 이미지 목록을 기반으로
   `30_translation/images/IMAGE_PLAN.tsv` 작성:
   - 컬럼: `경로 │ 포맷·크기 │ 원문 텍스트 │ 번역 텍스트 │ 폰트·스타일 메모 │ 우선순위 │ 상태`
   - 번역 텍스트는 승인된 `GLOSSARY.tsv`/`STYLE.md` 준수
   - 우선순위: 타이틀·메뉴·UI > 튜토리얼 이미지 > 배경 장식 텍스트
2. **원본 추출**: 대상 이미지를 원본 해상도·포맷 그대로 `30_translation/images/original/`에
   추출. 아틀라스는 좌표 맵(어느 영역이 어떤 텍스트인지)도 기록.
3. **스타일 분석**: 각 이미지의 폰트 계열·크기·색·외곽선·그라데이션·배치를 메모
   (재생성 시 시각적 일치 기준).
4. **[Codex 전용] 이미지 생성**: imagegen 스킬로 번역 이미지 생성 →
   `30_translation/images/translated/` (원본과 동일 파일명·해상도·포맷).
   생성 후 원본과 나란히 비교하여 스타일 일치 확인.
5. **[Claude 전용] 보류 처리**: `IMAGE_PLAN.tsv` 상태를 `hold-for-generation`으로 표시하고
   사용자에게 안내: 계획 시트 경로 + "이미지 생성은 Codex(imagegen) 또는 수동 편집으로
   진행해주세요. 완성 이미지를 `translated/`에 넣으면 5단계 검수로 진행합니다."
6. **재삽입 사전 검증**: 생성/수급된 이미지의 크기·포맷·알파채널이 엔진 요구사항과
   일치하는지 확인 (엔진 모듈의 텍스처 규격 준수). 아틀라스는 원본 좌표에 맞게 합성.

## 산출물

| 파일 | 내용 |
|-----|------|
| `30_translation/images/IMAGE_PLAN.tsv` | 이미지 번역 계획·상태 |
| `30_translation/images/original/` | 원본 추출 이미지 (+아틀라스 좌표 맵) |
| `30_translation/images/translated/` | 번역 이미지 (Codex 또는 사용자 제공) |

## 완료 기준

- [ ] 전 대상 이미지가 `IMAGE_PLAN.tsv`에 상태와 함께 기록됨
- [ ] Codex: `translated/`에 전 이미지 생성 완료 / Claude: 전 항목 `hold-for-generation` 처리 및 사용자 안내 완료
- [ ] 번역 이미지의 규격(크기·포맷·알파)이 원본과 일치

완료 시 `gt-image-review`(사용자 검수 게이트)로 진행한다.
