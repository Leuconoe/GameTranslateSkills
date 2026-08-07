---
name: gt-text-analyze
description: "Text branch analysis for game localization: inventory every text source, stable key, encoding, control token, language slot, and round-trip constraint before translation. Use when starting or resuming text analysis."
---

# gt-text-analyze — 텍스트 브랜치 T1: 텍스트 분석

전체 파일 분석 뒤 텍스트만 별도로 확정한다. 이 단계는 번역을 수행하지 않고, 번역 가능한
정확한 입력 manifest와 재현 가능한 변환 계약을 만든다.

> 시작 전에 common/SAFETY.md, common/project-structure.md, common/preflight-checks.md,
> 플랫폼 어댑터의 텍스트 추출 문서, 엔진 모듈을 읽는다. 문서와 실제가 다르면
> PROJECT.md와 HANDOFF.md에 기록하고 추측으로 진행하지 않는다.

## 입력 조건

- gt-analyze의 ANALYSIS.md와 추출 결과
- 프로젝트의 PROJECT.md, WORK_LOG.md, Title ID, target_language_slot
- 플랫폼 어댑터와 엔진 모듈의 텍스트 추출·역변환 계약
- 원본 인벤토리의 최신 경로·크기·SHA-256

## 절차

0. **사전 경고 게이트**: 프로젝트·입력·출력 경로를 literal로 확정하고 현재 해시와
   git status를 기록한다. 대상 파일을 확정하지 못하면 WARN 또는 BLOCKED로 남긴다.
1. **텍스트 소스 전수 목록**: 대사·UI·시스템·메뉴·선택지·저장/설정 텍스트를
   컨테이너와 엔트리 단위로 열거한다. source_file, source_key, 안정 ID 또는 오프셋,
   인코딩, 길이 단위, 제어 토큰, 개행, 보호 영역을 기록한다.
2. **언어 슬롯 확정**: 원본·대상 슬롯과 교체 방식의 증거를 기록한다. 슬롯이 확인되지
   않으면 pending으로 두고 번역을 시작하지 않는다.
3. **왕복 계약 검증**: 플랫폼·엔진 변환기로 원문을 추출하고 역변환한 뒤 원문과
   byte 또는 구조가 동일한지 확인한다. 대표 파일만 통과한 경우 전체 통과로 표시하지 않는다.
4. **manifest 작성**: 30_translation/text/translation_manifest.tsv를 생성한다.
   최소 컬럼은 id, source_file, source_key, 원문, 참고 언어, target_ko, status, notes다.
   시작 상태는 new이며 누락·중복·불안정 행 번호를 허용하지 않는다.
5. **분류·범위 기록**: 번역 대상, 보호 대상, 미확인 컨테이너, 이미지 안의 텍스트를
   분리해 TEXT_ANALYSIS.md에 기록한다. 이미지 안의 텍스트는 image-analyze 입력으로
   넘기고 텍스트 manifest에 중복 등록하지 않는다.

## 산출물

- 30_translation/text/TEXT_ANALYSIS.md
- 30_translation/text/TEXT_SOURCE_INVENTORY.tsv
- 30_translation/text/translation_manifest.tsv
- 재현 가능한 추출·역변환 명령과 round-trip 증거

## 완료 기준

- [ ] 텍스트 대상이 전수 목록화되고 안정 ID·원문·경로가 exact 일치함
- [ ] target_language_slot과 변환 계약이 증명됨
- [ ] 누락·중복·보호 영역·미확인 컨테이너가 별도 상태로 기록됨
- [ ] 역변환 round-trip과 입력 해시가 통과함

완료 시 gt-text-translate로 진행한다. 사용자 승인을 기다리는 단계가 아니다.
