# LUCA System (Visual Art's/Key) 엔진 노하우 — LuckSystem 도구 체인

> 출처: 실전 한글화 작업 노하우에서 일반화 이식 (2026-08)

## 대상 엔진

ProtoDB / LUCA System 계열 — Visual Art's/Key 타이틀(AIR, CLANNAD, Kanon, Little Busters!, Summer Pockets, Harmonia, LOOPERS, LUNARiA, planetarian 등)의 콘솔 이식판에서 사용된다.

## 도구

| 도구 | 경로 규약 | 용도 |
|---|---|---|
| LuckSystem CLI | `$GT_TOOLS/LuckSystem/lucksystem.exe` | SCRIPT.PAK 디컴파일/컴파일, PAK 추출/교체, CZ 이미지 변환, 폰트 편집 |
| LuckSystem GUI | (선택) `lucksystem.exe`와 같은 폴더 | 프리셋 기반 배치 작업. 내부적으로 CLI를 호출하므로 재현 기록은 CLI 명령 기준으로 남긴다 |

- 게임 프리셋: `data/<GAME>.txt`(OPCODE)와 `data/<GAME>.py`(플러그인) 쌍으로 관리된다. 지원 프리셋 예: AIR, KANON, HARMONIA, LOOPERS, LUNARiA, PlanetarianSG, SP(Summer Pockets), LB_EN, CartagraHD.
- 포크판은 `--game`/`-g` 플래그로 게임 타입을 강제 지정할 수 있고, OPCODE 파일만 지정하면 형제 플러그인을 자동 선택한다. **플러그인이 로드되지 않은 채 import하면 일부 opcode(예: `LOG_BEGIN`) 처리가 누락될 수 있으므로**, decompile/import 시 OPCODE와 플러그인을 항상 함께 지정하거나 자동 선택 로그를 확인한다.

## 핵심 원칙

1. **import(재컴파일)와 export(디컴파일)는 반드시 같은 원본 SCRIPT.PAK, 같은 OPCODE, 같은 플러그인으로 수행한다.** 플러그인을 수정했다면 재디컴파일부터 다시 한다.
2. OPCODE는 가능하면 실행 파일에서 추출한다. 없으면 디컴파일된 uint16 스크립트에서 문자열 후보 opcode(특별히 길고 연속된 큰 값)를 찾아 플러그인의 opcode 매핑으로 해석을 시도한다.
3. 임의 길이 문자열 수정이 필요하면 플러그인의 점프 계열 opcode(`IFN`, `FARCALL`, `JUMP`, `ONGOTO` 등)가 정확히 해석되는지 먼저 확인한다. 점프 해석 없이 길이가 변하는 치환을 하면 분기 offset이 깨진다. 포크판은 line-size 변경 후 각 분기 offset을 독립 재계산한다.
4. 디컴파일 텍스트를 직접 편집하지 말고, **디컴파일본에서 번역 대상 텍스트를 추출→번역→기계적으로 재치환하는 별도 도구**를 사용해 게임 수치가 실수로 바뀌는 것을 막는다 (아래 "대사 → 번역 TSV 추출" 절 참조).
5. 대사 아닌 opcode(`MESSAGE_CLEAR`, `MESSAGE_WAIT` 등)를 번역 대상 `MESSAGE`로 취급하지 않는다. `labelN:`/`globalN:` 접두 뒤의 opcode도 인식 대상이다.
6. import 후에는 **repack→재디컴파일 왕복**으로 편집 행이 보존되는지 확인한다. import 오류 메시지의 스크립트명·행 번호·초과 행 경고(stray newline)를 그대로 QA 근거로 기록한다.

## 프리셋 검증 (decompile 직후 필수)

프리셋(`data/<GAME>.txt` + `.py`)이 손에 있는 빌드와 일치한다고 가정하지 않는다. 같은 게임이라도 플랫폼·리비전에 따라 OPCODE 테이블이 다를 수 있다. decompile 직후 다음을 확인한다.

- 시나리오 스크립트의 대사 행이 `MESSAGE(...)`(또는 플러그인이 대사로 정의한 opcode)로 디코드되어 사람이 읽을 수 있는 원문 문자열이 보이는가.
- **실패 증상**: 대사가 전혀 다른 opcode의 인자열로 출력된다 — 예를 들어 대사 코드포인트가 무관한 opcode의 `uint16` 인자 배열로 나열됨. 페이로드 구조(문자수 필드 + 코드포인트 열, `@화자@「…」` 패턴)가 플러그인 `MESSAGE()` 핸들러의 해석(uint16 → 길이-문자열)과 일치하는데 opcode 이름만 어긋나면 **OPCODE 테이블 인덱스 불일치(off-by-one 등)** 를 의심한다. `-g <GAME>` 강제 지정으로도 동일하면 프리셋 자체가 이 빌드와 어긋난 것이다.
- 이 검증을 통과해야 번역 대상 분류·TSV 추출로 진행한다. 실패하면 아래 진단·보정 절차를 수행하고, 해제 전에는 `blocked`(원인·해제 조건 포함)로 기록한다.

### OPCODE 불일치 진단·보정

1. decompile 출력에서 대사 페이로드가 어느 opcode 이름으로 출력되는지 확인하고, 프리셋 `data/<GAME>.txt`에서 그 이름과 대사 opcode(`MESSAGE` 등)의 인덱스 차이를 계산한다.
2. 차이가 일정하면(테이블 전체가 같은 오프셋으로 밀림) 프리셋 txt **사본**을 프로젝트 `90_tools/` 아래에 만들어 인덱스를 보정하고(행 삽입·삭제), `-O <보정 txt>`로 재디컴파일한다. 도구 폴더의 원본 프리셋은 수정하지 않는다.
   - **삽입·삭제 위치 특정**: 인덱스 차이만으로는 어느 행을 고칠지 결정할 수 없다
     (밀림 시작점 앞뒤가 틀어지면 이름으로 바인딩되는 플러그인 핸들러 — 예: `VARSTR_SET` —
     가 잘못 붙는다). ① 파일명이 opcode를 암시하는 데이터 스크립트
     (`_varstr`/`_arflag`/`_scissor_trianglelist` 류)에서 해당 opcode가 정상 디코드되는지로
     밀림 **시작 위치**를 좁히고, ② 형제 프리셋(같은 엔진의 다른 게임 txt)과 diff하여
     삽입·삭제 후보 행을 고른다. 후보 적용 후에는 이름 바인딩 핸들러가 올바른 opcode에
     붙었는지 데이터 스크립트로 재확인한다.
3. 보정 후에는 반드시 **baseline 왕복**(decompile→무수정 import→재디컴파일 동일성)과 대사 MESSAGE 디코드를 함께 확인한다. 대사만 읽히고 왕복이 깨지면 보정본을 채택하지 않는다.
   왕복 판정은 재디컴파일 텍스트 비교보다 **무수정 import로 재생성한 PAK을 원본과
   바이트 비교(`cmp`/해시)** 하는 쪽이 간단하고 강력하다.
4. 프리셋 보정으로 해결되지 않으면 실행 파일에서 OPCODE 테이블 추출을 시도한다: exefs의 `main`(NSO)을 압축 해제한 뒤 opcode 이름 문자열 테이블(연속된 대문자 식별자 배열)을 찾아 등장 순서대로 OPCODE txt를 재구성한다. *(접근 개요만 기술 — 미검증. NSO 압축 해제 도구와 테이블 위치는 타이틀별로 다를 수 있으므로 실측 절차를 WORK_LOG.md에 남겨 검증할 것)*
5. 사용한 프리셋/보정본의 파일 해시, 보정 내역(인덱스 차이·수정 행), 검증 결과를 `WORK_LOG.md`에 기록한다.

## 대사 → 번역 TSV 추출

- **CLI로 재현 가능한 경로를 우선한다.** decompile 산출물(Export 텍스트)에서 대사 opcode 행만 기계적으로 파싱해 `translation_manifest.tsv` 스키마로 변환하는 스크립트를 프로젝트 `90_tools/scripts/`에 두고, 스크립트·입력·출력의 해시를 `WORK_LOG.md`에 기록한다. 번역 재치환(import 입력 생성)도 같은 스크립트 체계로 수행해 게임 수치가 실수로 바뀌지 않게 한다(핵심 원칙 4).
- 포크판 GUI의 "Dialogue Extract" / "Import TSV" 기능을 쓰는 경우는 **승인된 GUI 예외**로만 허용한다:
  1. 동등한 CLI 서브커맨드가 없음을 먼저 확인하고,
  2. 사용 근거·도구(포크) 버전·입출력 파일 경로와 해시를 `WORK_LOG.md`에 기록하며,
  3. 출력 TSV는 CLI/스크립트 검증(행 수, 제어 코드 서명, decompile 원문 대조, 왕복)으로 재검증한다.
  이 기록 없이 GUI 산출물을 채택하지 않는다. 이는 platforms/nsw/extract.md §2 "GUI 금지" 원칙의 명시적 예외 절차다.

### 대사 외 문자열 내장 opcode (시스템 텍스트 누락 방지)

- 설정 메뉴 등 일부 시스템 문자열은 MESSAGE가 아닌, 문자열 디코더가 없는 opcode 안에
  **uint16 코드포인트열**로 내장된다 (실측: 설정 스크립트의 「전체 OFF/전체 ON/취소」류).
- MESSAGE만 추출하면 이 텍스트가 기계 추출 대상에서 빠진다. 디컴파일 출력 전체를
  **코드포인트열 스캔**(연속된 CJK 범위 uint16 인자)으로 훑어 후보 opcode를 목록화하고,
  플러그인 핸들러 추가 또는 별도 디코더로 추출·재치환 경로를 만들어 처리한다.
- 처리하지 않기로 한 항목은 ANALYSIS.md에 "미번역 잔여"로 명시해 QA(6단계)에서 추적한다.

## 명령 예시

아래 명령은 **LuckSystem 설치 폴더(`$GT_TOOLS/LuckSystem/`)에서 실행하는 기준**이다. `data/<GAME>.txt` 같은 프리셋 경로가 실행 폴더 기준 상대 경로이기 때문이다. 다른 위치에서 실행하려면 프리셋·출력 경로를 절대 경로로 지정한다.

```shell
# SCRIPT.PAK 디컴파일 (OPCODE + 플러그인 지정, 특정 스크립트 제외 가능: -b)
lucksystem script decompile -s <clean>/SCRIPT.PAK -c UTF-8 \
  -O data/<GAME>.txt -p data/<GAME>.py -o <프로젝트 10_extract>/Export

# 번역 반영본을 SCRIPT.PAK으로 재컴파일 (출력은 staging으로)
lucksystem script import -s <clean>/SCRIPT.PAK -c UTF-8 \
  -O data/<GAME>.txt -p data/<GAME>.py \
  -i <프로젝트 40_build/staging>/Export -o <프로젝트 40_build/staging>/SCRIPT.PAK

# PAK 목록 확인 / 전체 추출 / 파일 교체
lucksystem pak -s <clean>/FONT.PAK -L
lucksystem pak extract -i <clean>/FONT.PAK -o FONT.txt --all <10_extract>/font_temp
lucksystem pak replace -s <clean>/FONT.PAK -o <staging>/FONT.PAK -i <staging>/font_temp

# CZ 이미지 ↔ PNG
lucksystem image export -i <10_extract>/FONT/<폰트리소스> -o <작업폴더>/font.png
lucksystem image import -s <clean 원본 CZ> -i <수정 PNG> -o <staging>/<출력 CZ>

# 폰트 아틀라스 추출(-o PNG, -O 문자셋 txt) / TTF로 편집
lucksystem font extract -s <FONT 리소스> -S <info 리소스> -o font.png -O charset.txt
lucksystem font edit -s <FONT 리소스> -S <info 리소스> -f <한글 TTF> \
  -o <출력 FONT> -O <출력 info> -c <추가할 문자목록.txt> -a   # -a: 뒤에 append
```

- decompile 시 시나리오가 아닌 **데이터성 엔트리**(음량·음악 조정 테이블 등, 예: `_char_volume`, `_se_adjust` 류)에서 파싱 경고 후 skip되는 것은 **정상 동작**이다. 경고 대상이 데이터 엔트리인지 확인해 `WORK_LOG.md`에 기록하고, 시나리오 스크립트 자체의 경고와 혼동하지 않는다.

## 폰트 작업 (한글 주입)

- 폰트는 `FONT.PAK` 안의 크기별 아틀라스(CZ 이미지) + 문자셋 info 리소스 쌍으로 구성된다. `font edit`의 세 모드: 전체 재그리기(`-r`), 뒤에 추가(`-a`), 특정 인덱스부터 교체(`-i <index>`).
- **기존 glyph를 보존하고 누락 문자만 추가하는 방식을 우선한다.** 이미 있는 문자를 재그리면 기존 언어 표시가 회귀할 수 있다.
- 구형 타이틀은 레거시 폰트 info 레이아웃(예: `CharNum=100 + CharNum2` 구조)을 쓸 수 있다. 편집 후에도 원본 레이아웃을 보존해야 하며, CZ 아틀라스의 원본 치수·raw 블록 경계를 유지한다.
- 재작성한 폰트 패밀리는 PAK을 compact 재빌드하고 정렬된 실제 끝에서 잘라야 한다. 내부 gap이나 복사된 stale tail이 남으면 **게임 기동 실패**를 일으킨 사례가 있다.
- 주입 glyph의 세로 metrics(Y-offset)는 슬롯별로 시험 빌드로 확인한다(한 타이틀의 영문 슬롯은 `Y+2`가 검증값이었다 — 타이틀마다 재검증).
- 슬롯(언어)·패밀리 단위로 좁혀 패치하고, 한 패밀리(예: GOTHIC1)만 바꾼 빠른 시험 빌드로 먼저 확인한 뒤 전체에 적용한다.

## 텍스트 길이 제약

- OPCODE·점프 해석이 완전하지 않은 상태에서는 문자열을 **원본 길이 이하**로 유지하고, 전각 문자열은 전각 공백, 반각 문자열은 반각 공백으로 원래 길이까지 패딩한다. 길이 초과는 import 후 스크립트 오작동을 일으킨다.
- 빈 문자열(zero-length) 인코딩은 포맷별 엣지 케이스가 있다(예: UTF-8 길이 접두 `00 00 00`). 왕복 시 terminator 보존을 확인한다.

## CZ 이미지 주의

- CZ2 등 압축 포맷은 round-trip에서 파손·픽셀 손상 버그가 있었던 이력이 있다. 사용하는 도구 버전의 수정 여부를 확인하고, **import 후 재export하여 픽셀 diff로 왕복 무결성을 검증**한 뒤에만 staging에 반영한다.
- 부분 문자셋 교체 시 원본 아틀라스 치수를 유지한다.

## 검증 체크리스트

- [ ] decompile→(무수정)import→재디컴파일 왕복이 원본과 동일한가 (baseline 왕복)
- [ ] 번역 import 후 편집 행이 보존되고 행 수 초과 경고가 0건인가
- [ ] 점프/분기 opcode가 플러그인에서 전부 해석되는가 (`UNDEFINED()` 잔존 0)
- [ ] 폰트 PAK 재빌드 후 게임 기동·전체 가시 문자 렌더 확인
- [ ] 최종 PAK은 깨끗한 원본에서 생성했고 staging 밖을 오염시키지 않았는가
