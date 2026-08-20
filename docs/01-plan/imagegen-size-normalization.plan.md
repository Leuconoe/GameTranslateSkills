# imagegen 크기 정규화 Plan

> 작성일: 2026-08-20 | 상태: Approved | 다음 단계: Design

## 목표

내장 imagegen 후보가 원본과 같은 종횡비를 유지했지만 PNG 캔버스 크기만 다를 때, 원본 생성물과
기존 receipt를 보존한 채 목표 캔버스로 결정론적으로 리사이즈하고 전체 이미지 QA를 다시 실행할 수
있게 한다.

## 범위

- PNG/RGBA8 agent-generated 후보의 동일 종횡비 크기 불일치만 자동 정규화
- 새 후보·RGBA probe·schema 4 receipt 생성과 manifest 원자적 갱신
- 원본/source/reference/imagegen output/기존 receipt 비덮어쓰기
- 정규화 provenance와 실제 PNG header·decoded RGBA 검증
- 정규화 뒤 기존 alpha·edit region·보존 픽셀·시각 QA를 그대로 적용

## 비범위

- crop, pad, 종횡비 변경, atlas 좌표 변경, 색상 모드/포맷 변환
- 원문 제거·합성·alpha 복구 또는 QA 실패의 자동 은폐
- user-supplied 후보 및 PNG 외 엔진 전용 raster 자동 변환

## 성공 기준

1. `image:normalize-size`가 적격 후보를 원본 크기로 변환하고 원본 파일을 보존한다.
2. 변환 결과만으로 다른 검증을 우회하지 않으며 `image:validate`의 `Issues: 0`이 필요하다.
3. 종횡비/포맷/provenance/해시가 부적격이면 쓰기 전에 실패한다.
4. 정상·거부·변조 회귀 테스트와 전체 harness/skill validation이 통과한다.

## 위험과 대응

| 위험 | 대응 |
|---|---|
| 리사이즈로 보존 영역이 달라짐 | 정규화 후 decoded RGBA 전체 QA를 재실행하여 실패 폐쇄 |
| 생성 provenance 유실 | schema 4가 원본 receipt와 선택 attempt input hash를 연결 |
| 원본/기존 후보 덮어쓰기 | `normalized/` 새 경로만 허용하고 기존 파일이 있으면 중단 |
| PNG parser 오용/폭탄 | 지원 형식·bit depth·interlace·pixel 수 상한과 CRC 검증 |
