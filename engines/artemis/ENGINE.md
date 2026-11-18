# Artemis Engine 노하우 — pf8 아카이브 · AST(Lua 테이블) 스크립트

> 출처: 실전 한글화 작업 3건에서 일반화 이식 (2026-11)
> 근거 타이틀: IdolDays, 지뢰계 마법소녀 사쿠라, 유성 월드 액터 Badge & Dagger (NSW, 일본어 원본 → 한국어)

## 대상 엔진

Artemis Engine (iMel 계열). PC·Android·iOS·WASM·Switch·PS4 공용 엔진으로, 콘솔 이식판도 PC와 같은 데이터 구조(Lua 시스템 + AST 시나리오 + PNG UI)를 그대로 쓴다.

식별 서명 (모두 확인되어야 Artemis로 확정):

| 증거 | 값 |
|---|---|
| RomFS 구성 | `root.pfs` + 번호형 분할 `root.pfs.000`, `.001`, … (이미지·음성이 번호 아카이브에 분산) |
| 아카이브 매직 | 처음 3바이트 `pf8` (`70 66 38`) |
| `system.ini` (RomFS 루트 또는 `root.pfs` 내부) | 첫 줄 `Artemis 起動設定ファイル`, 섹션 `[WINDOWS] [ANDROID] [IOS] [WASM] [SWITCH] [PS4]`, `CHARSET = UTF-8`, `BOOT = system/first.iet`, `[SWITCH]`의 `FONT_CACHE_SIZE` |
| ExeFS `main`(NSO) 문자열 | `Artemis Engine Rev.N`, `root.pfs`, `%s.%03d` |
| 스크립트 | `script/*.ast` (Lua 테이블 리터럴, 대부분 `astver = 2.0`), `system/**/*.lua`, `system/table/list_<os>[_<lang>].tbl`, `system/*.asb`(컴파일된 스크립트) |

## 도구

| 도구 | 경로 규약 | 용도 |
|---|---|---|
| pfs-rs | `$GT_TOOLS/pfs-rs-v<ver>-win_x64/pfs-rs.exe` (검증: 0.2.5) | pf8 목록·추출, 그리고 **자체 리팩 결과의 독립 재추출 검증** |
| 프로젝트 pf8 리더/라이터 | `<project>/90_tools/scripts/*_pfs.py` (표준 라이브러리만) | 원본 인덱스 배치를 보존한 리팩, identity 증명 |
| 프로젝트 AST/tbl/Lua 추출·주입기 | `<project>/90_tools/scripts/*_text.py` | 무손실 토크나이저 기반 문자열 span 치환 |
| fontTools / Pillow(FreeType) | `$GT_TOOLS/python` 또는 시스템 Python (검증: fontTools 4.63.0, Pillow 12.3.0) | 폰트 커버리지 측정, 한글 glyph append, 렌더 probe, 폭 모델 |
| nstool | `$GT_TOOLS/nstool-v<ver>-win_x64/nstool.exe` (검증: 1.9.2) | NSP → NCA → RomFS/ExeFS 추출 (플랫폼 공통, platforms/nsw 참조) |

```shell
# 목록 / 전체 추출 (대괄호 경로 glob 문제를 피하려고 cwd = 프로젝트 루트, 상대 경로 사용)
pfs-rs list 10_extract/romfs_original/root.pfs > 90_tools/work/extract/list_root.txt
pfs-rs -q extract 10_extract/romfs_original/root.pfs 10_extract/exports/pfs_root
# 리팩 후보 검증: 후보 아카이브를 pfs-rs로 다시 풀어 기대 트리와 바이트 비교, list 순서 비교
pfs-rs -q extract 40_build/staging/<id>/root.pfs 40_build/staging/<id>/reextract
```

- `pfs-rs create`는 **리팩 도구로 채택하지 않는다.** 내용·크기는 같아도 엔트리 순서가 원본과 달라져(예: `system.ini`, `system\ui.asb`가 끝으로 이동) identity가 성립하지 않았다. 순서가 바뀐 인덱스를 엔진이 받아들이는지는 런타임 미검증이다.

## 핵심 원칙

1. **대상 슬롯은 기본적으로 `ja` 덮어쓰기.** 엔진은 `init.langnum`/`lang_list` 같은 고정 언어 목록(ja/en/cn/tw 등)만 소비하고 `ja`가 기본값·fallback이다. `ko` 슬롯 추가는 Lua 언어 선택 로직·UI 변경이 필요하므로 하지 않는다. en/cn/tw 슬롯은 바이트 동일로 보존하고 참고 열로만 쓴다. 언어가 `ja` 하나뿐인 빌드도 있다.
2. **실제로 로드되는 tbl을 코드로 확정한다.** 파일명에 `switch`가 있어도 쓰인다는 보장이 없다. `system/init.lua`와 `system/image/boot.lua`의 include 경로(`"system/table/list_"..game.os.."_"..ln..".tbl"` 류)와 `game.os` 값을 읽는다. Switch 빌드인데 `game.os = "windows"`로 하드코딩되어 `list_windows*.tbl`만 읽는 경우가 있었고, 언어별 tbl 없이 `list_<os>.tbl` 하나만 읽는 구형 빌드도 있었다.
3. **AST/tbl/Lua는 무손실 토크나이저로 문자열 리터럴의 바이트 span만 치환한다.** 공백·주석·CRLF/LF·따옴표 형식(`"..."` vs `[[...]]`)·이스케이프를 원형 그대로 두고, 치환하지 않은 행은 바이트 동일해야 한다. 파일 전체 재직렬화나 개행 정규화를 하지 않는다.
4. **pf8 리팩은 원본 인덱스 바이트 배치(엔트리 순서·이름·오프셋 테이블)와 데이터 순서를 그대로 두고** size/offset 필드와 XOR 키만 바꾼다. "무수정 입력으로 패킹 = 출하 아카이브 SHA-256 일치"(identity)를 먼저 증명한 뒤에만 후보를 만든다.
5. **화자 이름은 `name[2]`(표시값)에만 쓴다.** `name[1]`은 음성 색상·얼굴 아이콘·보이스 맵의 조회 키다.
6. 텍스트 파일 단위 길이 제한은 없다(Lua 소스이고 pf8 오프셋은 재계산). 실제 제약은 **메시지 창 폭·줄 수**이며 줄바꿈 규칙(아래 절)으로 해결한다.

## pf8 아카이브 포맷

```
"pf8" | u32 index_size | index[index_size] | data...
index = u32 count
        count × (u32 name_len, name UTF-8, u32 0, u32 offset, u32 size)
        trailer: u32 (count+1), count × u64 (index 내 각 엔트리 zero 필드의 위치), u64 0, u32 trailer_offset
```

- 각 엔트리 payload는 `SHA-1(index 바이트[7 : 7+index_size])` 20바이트 키로 XOR되어 있다. 키 인덱스 = 엔트리 시작 기준 바이트 위치. 인덱스가 바뀌면(크기 변경 포함) 키도 바뀐다.
- 엔트리 이름 구분자는 `\`. 대소문자는 빌드마다 다르다(전부 소문자인 빌드와 원래 대소문자를 유지한 빌드를 모두 확인). 엔진이 폰트 경로 등을 소문자로 바꿔 조회하는 함수(`get_fontface()` 류)가 있으므로 이름을 바꾸지 말고 원본 표기를 유지한다.
- 데이터는 인덱스 직후부터 연속 배치되지만 **데이터 순서가 인덱스 순서와 다를 수 있다.** 리팩 시 원본 offset 기준으로 정렬한 순서를 유지하고, 연속성(`앞 offset + size == 다음 offset`)을 assert한다.
- 검증된 리팩 도구의 overlay는 **기존 엔트리 교체만** 허용했다. 새 엔트리 추가는 시험하지 않았다.

### 아카이브 마운트 순서

- 한 빌드의 `main`(NSO LZ4 해제 + RELA 적용 + AArch64 정적 디코드)에서 확인한 순서: `game:/root.pfs`를 먼저 열고, `snprintf("%s.%03d")`로 `.000`~`.999`를 차례로 연다. **없는 번호는 건너뛰고 루프는 계속되며**, 각 엔트리를 하나의 이름 맵에 덮어쓰므로 **뒤 번호 아카이브가 같은 이름을 이긴다.**
- 따라서 패치 전달 방식은 두 가지다.
  - (A) **새 번호 아카이브**(현재 최대 번호 + 1, 예: `root.pfs.023`)에 교체 엔트리만 담는다. 원본 아카이브는 그대로 둔다. Eden에서 이 방식으로 스크립트·tbl·이미지 교체가 반영됨을 확인했다(1개 타이틀).
  - (B) **`root.pfs` 전체 재패킹**(원칙 4). 2개 타이틀이 이 방식으로 Eden에서 정상 동작했다.
  - (A)를 쓰려면 해당 빌드 `main`에 `%s.%03d` 문자열과 번호 루프가 있는지 먼저 확인한다. 검증하지 않은 빌드에서 (A)의 우선순위를 가정하지 않는다.
- **RomFS 루즈 파일과 아카이브 사이의 우선순위는 정적으로 확정하지 못했다.** 루즈 `script/`가 함께 출하된 빌드에서는 같은 바이트의 한국어 파일을 루즈 경로에도 넣어 어느 쪽이 이겨도 한국어가 나오게 했다.
- 재패키징된 빌드에는 비공식 번역 오버레이(번호 아카이브, 루즈 `script/`)가 섞여 있을 수 있다. 모든 레이어를 열거하고 이름별 **mount winner**를 계산한 뒤 교체 범위를 정한다. 오버레이가 덮어쓴 원본 이미지는 원본 바이트를 패치 아카이브에 다시 넣어 복원한다.

## 스크립트·텍스트 포맷

### AST 변종

| 변종 | 구조 | 키 |
|---|---|---|
| 블록 키형 (`astver = 2.0`) | `ast = { ["0001_00001"] = { {"cmd",…}, {"text"}, text={ ja={ { "문자열", {"rt2"} } }, en=…, cn=…, tw=… }, linknext=…, linkback=… } }` (블록 키가 `block_NNNNN`인 빌드도 있음) | `<block>/text/<page>`, 선택지 `select={ja={…}}` → `<block>/select/<n>` |
| 인덱스형 (구형) | 명령 블록 배열 + 별도 `text={[N]={ja=…, en=…, tw=…, cn=…, vo=… | select=…}}`, `label={}` | `text[N].ja#i`, `text[N].select#i` |

- 명령 안에 언어별 문자열 필드가 붙는 경우가 있다: `{"savetitle",text=…,text_en=…,text_cn=…,text_tw=…}` (세이브 슬롯 장 제목), `mw=`(선택지 메시지창 문자열). 이 필드는 **일반 문자열이라 제어 테이블을 넣을 수 없다.** 주입기에서 태그·개행을 거부한다.
- 텍스트가 없는 시스템 AST(`brandlogo`, `gamestart`, `pack` 등)는 매니페스트에 넣지 않고 inventory에 `no-visible-text`로 남긴다.
- 인코딩은 UTF-8 무 BOM이다. 개행은 빌드별로 CRLF와 LF가 섞여 있으므로 파일마다 기록하고 보존한다.

### 제어 토큰 (AST 메시지 배열 안의 Lua 테이블)

| 엔진 형식 | 의미 | 처리 |
|---|---|---|
| `{"rt2"}` | 메시지 내 줄바꿈, 메시지 끝에서는 페이지 종료 | 개수·순서 보존. 매니페스트에서는 `\n` 또는 `{rt2}` 중 하나로 표기를 고정하고, 끝의 `{"rt2"}`를 암묵 처리할지 명시 처리할지도 한 가지로 정한다 |
| `{"txruby",text="읽기"}` 본문 `{"txruby"}` | 루비 | 한국어에는 루비를 남기지 않는다. 의미 있는 독음은 문장에 풀어 쓰고 단순 독음은 본문만 남긴다. QA는 `ko 루비 = 0`과 `{"rt2"}` 순서·개수 일치만 비교한다 |
| `{"exfont",size="fN"}` … `{"exfont"}` | 글자 크기 변경 구간 | size id 원형 보존 |
| `{"myname"}` | 플레이어 이름 삽입 | 원형 보존. 폭 계산에는 이름 길이 추정치를 넣는다 |
| tbl `[num]` | 숫자 placeholder | 원형 보존 (매니페스트에서 `\[num\]`처럼 escape할 수 있음) |

- Lua 문자열 escape(`\\ \" \n \r \t`)와 `[[...]]` long bracket을 그대로 재현해야 한다. 원문이 long bracket이거나 번역문에 `"`가 들어가면 원래 형식을 따르도록 직렬화기를 만든다.
- 매니페스트 셀 규약 예: `\\`=백슬래시, `\n`=`{"rt2"}`, `\t`, `\{ \}`=리터럴 중괄호, 제어 토큰은 짧은 표기(`[ruby=R]…[/ruby]`, `[font=fN]…[/font]`) 또는 Lua 원문 표기 중 **한 가지로 고정**한다. 토큰 밖 본문에 `{ }`가 남으면 오류로 처리한다.

### 화자 이름

- `name={"key"}` 또는 `name={"key","표시명"}`. 표시는 `name[2] or name[1]`이다(`message.lua` `getNameChar` 류).
- 한국어는 `name[2]`에 넣는다. 원래 `name[1]`만 있는 ja 슬롯에도 en/cn/tw처럼 `{key,"한국어"}` 형태로 추가한다. Eden 대사 화면에서 한국어 화자명 표시는 확인했지만, 백로그의 화자 표시는 명시적으로 기록된 증거가 없다.
- 표시명이 바뀌지 않는 행은 원래 바이트를 유지한다. 무조건 `name[2]`를 쓰면 forced-regeneration 왕복이 깨진다.
- 플레이어 이름 치환 키(예: `language.get_name()`으로 넘어가는 주인공 키)는 화자 키로 두고 번역하지 않는다. 기본 이름 설정값 쪽을 번역한다.
- 화자 행을 출현 빈도순으로 정렬해 ID를 매기면 한국어 주입 후 재추출 시 동률 화자의 ID 순서가 바뀐다. 역반영·검증은 ID가 아니라 이름 매핑이나 다중집합으로 비교한다.

### UI·시스템 텍스트

- `system/table/list_<os>[_<lang>].tbl`의 `lang.uihelp.*`(또는 `csv.uihelp.*`)가 도움말·확인 대화상자·알림 문자열이다. 키 경로를 그대로 source_key로 쓴다.
- 같은 tbl의 **엔진 설정 키는 번역 대상이 아니다**: `uihelp.system.{prohibit_head, prohibit_foot, prohibit_head_s, prohibit_foot_s, wordparts01, indent, indent_en}`, `author`, 레이아웃·ID·경로.
- 비런타임 tbl(`list_android*`, 실제 OS가 아닌 `list_<os>*`)은 보호 대상이다. en tbl 값이 아직 일본어인 행은 실제로는 ja 문자열이므로 번역 대상에 포함한다.
- 다른 작품용 템플릿 문구가 tbl에 남아 있을 수 있다. 번역은 하되 용어집에는 넣지 않는다.
- Lua 하드코딩 문자열 중 플레이어에게 보이는 것은 `tag_dialog` 제목·메시지와 fallback 캡션뿐이다. `message()/sysmessage()/debmessage()/error_message()`는 `debug_flag`로 막힌 디버그 출력이라 번역하지 않는다. Lua 리터럴은 `(파일, 행, k번째 리터럴, 원문 exact)` allowlist로 지정하고, 주입기가 원문 일치를 assert하게 한다. 일부 리터럴은 모든 언어 슬롯이 공유하므로 다른 슬롯에서 tofu가 날 위험을 기록한다.
- `system/*.asb`(컴파일 스크립트)에는 오류 대화상자 문자열만 있었고 writer가 없다. 깨진 스크립트에서만 표시되므로 `blocked(low)`로 기록하고 손대지 않는다.

## 폰트 (한글 주입)

- Artemis는 `font/` 아래 TTF/OTF를 **런타임에 FreeType으로 렌더**한다. 고정 래스터 아틀라스가 없으므로 작업 대상은 폰트 파일 자체다.
- consumer 추적: `list_<os>.tbl` `init.fontNN = "font/…"` → 언어별 폰트 항목 `face="fontNN"`(본문·루비) → `get_fontface()` 소문자화 → pf8 엔트리. 설정 화면에서 고를 수 있는 폰트(`uihelp.conf.fontNN` 라벨이 있는 `fontNN`)도 모두 consumer로 본다.
- 커버리지 판정:
  - Source Han Sans(Pan-CJK OTF)는 한글 11,172자와 호환 자모 94자를 이미 갖고 있으므로 **무변경**.
  - Noto Sans JP, GenJyuu, Roboto, Noto SC/TC 등은 한글이 0자이므로 **append**.
- append 절차 (원본 glyph 보존):
  1. 같은 굵기의 Noto Sans KR(OFL)에서 U+AC00–D7A3과 필요한 자모를 가져온다.
  2. 원본 폰트의 기준 한자 10자 안팎(国語東京会日田中一口 등)에서 bbox 높이·중심을 측정해 **공통 affine 변환 하나**(scale, dx, dy)를 모든 한글 glyph에 적용한다. 글자별로 scale을 따로 주지 않는다. 전각 monospace 폰트는 advance를 셀 폭에 맞추고 dx로 가운데 정렬한다.
  3. glyf 폰트는 `recalcBBoxes=False`로 열고, 측정은 별도 TTFont 사본에서 한다. 그렇지 않으면 fontTools가 저장할 때 원본 glyph를 재인코딩한다(실제로 원본 18,729개 → 10개 → 0개로 줄어든 반복이 있었다). maxp/head/hhea 범위는 새 glyph가 요구하는 곳만 올린다.
  4. 검증: raw loca/glyf 파서로 원본 glyph 바이트 diff 0, hmtx/vmtx/cmap 원본 항목 동일, 손대지 않은 테이블 바이트 동일, 필요한 코드포인트 missing 0, FreeType blank 0, 한자 대비 baseline 편차 ≤1px, 동일 입력 재빌드 시 SHA-256 재현.
  - U+3164(HANGUL FILLER)는 Unicode 설계상 공백 glyph이므로 blank 검사에서 공백 집합에 넣는다.
- **`_font_cache`**: `psw/<lang>/_font_cache/` 또는 `pc/<lang>/_font_cache/`의 `index.dat`와 PNG 페이지는 사전 렌더 glyph 캐시다(`system/image/cache.lua` `font_cache()` → `restoreFontCache`). `index.dat`는 u32 count 뒤에 (폰트 이름, 크기, 색, 코드포인트, UV float) 레코드가 이어지는 구조였다. 캐시는 **폰트 파일 이름으로 키**되며 한글 항목은 0개였다. 캐시 대상 폰트의 원본 glyph를 바이트 동일로 두면 캐시를 무효화하거나 수정할 필요가 없다. 한글은 런타임에 FreeType으로 렌더된다(Eden에서 캐시된 일본어 glyph와 한글이 섞인 화면 정상 확인).

## 한국어 줄바꿈 (wordparts / 금칙)

일본어 슬롯은 보통 단어 판정이 꺼져 있어(`wordparts01 = "none"` 또는 `"^"`) 한국어가 **음절 단위로 줄바꿈**되고 단어 중간에서 끊긴다. 빌드 구조에 따라 두 경로가 있다.

**경로 1 — 언어별 tbl 설정 (권장, 2개 타이틀에서 Eden PASS)**

- 엔진 흐름: `boot.lua set_textfont()`에서 폰트 항목 `wordparts=1`이면 `uihelp.system["wordparts01"]` → `[wordparts parts=…]` 태그를 건다(단어 = 이 문자들의 연속, 그 사이에서만 줄바꿈). `prohibit=1/2`이면 `prohibit_head/foot`(또는 `*_s`) → `[prohibit]`. en 슬롯이 같은 메커니즘으로 단어 줄바꿈을 하므로 **Lua 수정 없이 ja tbl만 바꾼다.**
- 변경 (ja tbl, 정확한 원래 값을 assert하는 fail-closed 치환):
  - `wordparts01`: `"none"` → `A–Z a–z 0–9 ! ? . , ~ ～ … · % [ ] ( )` + U+3131–318E + U+AC00–D7A3 (약 34KB 문자열이며 엔진이 받아들였다).
  - **`」』）` 같은 indent 쌍의 닫는 기호는 wordparts에 넣지 않는다.** 폰트 항목이 `indent="indent"`(쌍 `「」（）『』`)를 쓸 때 이 기호가 단어 문자에 들어가면, 공백이 있는 「…」 대사가 **오른쪽 끝부터 한 단어씩 한 줄로** 그려지는 결함이 Eden에서 재현됐다. 해당 기호를 빼자 해결됐고 단어 줄바꿈은 유지됐다.
  - `prohibit_head += ".,!?)]}~～… "`, `prohibit_foot += "([{"`, `prohibit_head_s += ".,!?)~～… "`, `prohibit_foot_s += "("`.
  - ja 폰트 항목에 `wordparts=1`이 없으면, en 쪽에서 `wordparts=1`을 가진 항목(adv, backlog, 대사 라인, savetext 등)과 같은 항목에만 추가한다.
- 이 설정 행은 매니페스트에서 `<KEEP>`(번역 대상 아님)으로 두고, 빌드 단계의 별도 함수가 적용한다. 왕복 검증의 기대값도 그에 맞춰 둔다.
- 사전 추정: 메시지 창 폭 모델(FreeType advance + kerning, 창 width·size·줄 수는 tbl 폰트 항목 값)로 단어 중간 줄바꿈, 금칙 줄머리, 줄머리 공백, 줄 수 초과 건수를 변경 전후로 집계한다. 추정치이며 런타임 확인이 필요하다.

**경로 2 — 명시적 `{"rt2"}` 사전 줄바꿈 (언어별 tbl 경로가 없는 구형 빌드)**

- `init.lua`가 `list_<os>.tbl`만 읽고 `[wordparts]`가 전역 `e:tag{"wordparts", parts=…}`(영어용) 한 줄뿐인 빌드에서는, 그 문자열에 한글을 추가해도 **런타임 효과가 없었다**(원인 미규명).
- 이때는 어절 경계 공백을 `{"rt2"}`로 바꾼다. 폭 모델(해당 폰트·크기의 FreeType advance + kerning, 「 들여쓰기만큼 이어지는 줄 폭 차감, `{"myname"}` 길이 추정)을 **에뮬레이터에서 실제로 관찰한 줄바꿈 지점 여러 곳으로 보정**한 폭을 쓴다. adv와 backlog가 같은 face/size/width라면 같은 결과가 나온다.
- 대상은 메시지 배열 행뿐이다. `mw=` 같은 일반 문자열 필드는 제어 테이블을 담지 못해 주입이 거부되므로 제외한다. 매니페스트 merge는 1회 원자적으로 하고, 실패하면 백업에서 복원한다.

## 이미지

- UI 이미지는 매직 경로 `:ui` = `init.system.ui_path`(예: `psw/`) + `init.lang[UI 언어]`(예: `ja/` 또는 `uija/`)로 열린다. PC 테이블을 쓰는 빌드는 `pc/<lang>/`이다. 각 화면은 tbl `file="<dir>/<name>"` → `:ui/<dir>/<name>.png`. 부팅 카드(경고문·브랜드)는 `script/brandlogo.ast`, 장 카드·특수 화면은 시나리오 AST의 `file=`에서 참조된다.
- `image/`(bg/ev/cg/thumb/sys/staff/rule/mask/anime)는 모든 언어가 공유하는 경로다. 첫 부팅 언어 선택 카드처럼 공유 이미지가 번호 아카이브(`root.pfs.000` 등)에 있으면 그 아카이브도 교체·오버라이드 대상이 된다.
- 언어 슬롯별 UI 사본은 바이트가 같아도 물리적으로 별개 파일이다. ja 사본만 편집하면 다른 슬롯에 영향이 없다. 언어 선택 버튼·설정의 언어 토글에 있는 `日本語` 표기를 `한국어`로 바꾼다.
- 포맷: pf8 안의 일반 PNG(RGBA8, RGB8, LA8, P8+tRNS). GPU 텍스처 컨테이너·mipmap은 없다. `.ipt`(레이아웃·슬라이스 sidecar)는 좌표 메타데이터이므로 읽기 전용으로 잠근다. E-mote `.psb` 캐릭터와 `.ogv`/`.mp4` 영상은 이미지 범위 밖이다(영상 안에 박힌 크레딧은 별도 영상 범위로 기록).
- 같은 PNG가 아카이브 안 여러 경로에 들어 있는 것은 원본 구조다. export에서 `Duplicate content`로 보고되어도 삭제·병합하지 않는다.

## 추출·주입 절차 (단계 매핑)

1. **gt-analyze**: nstool로 RomFS/ExeFS 추출 → 식별 서명 확인 → 모든 pf8 `list` + 텍스트 계열 확장자(`ast,lua,tbl,iet,asb,ipt,ini,dat,sli,txt,csv,json,xml`) 추출 → 아카이브별 엔트리 수·크기와 mount winner 표 작성 → `init.lua`/`boot.lua`에서 OS 테이블·언어 목록·폰트 매핑 확정.
2. **gt-text-analyze**: 무손실 토크나이저로 추출해 매니페스트를 만든다(같은 입력이면 SHA-256 재현). 왕복 게이트 3종(아래 체크리스트)을 PASS(bench)까지 진행한다.
3. **gt-text-translate**: 일괄 번역 후 단일 merge. 기능 행(금칙·indent 설정, 언어명 라벨, 엔진 키)은 `<KEEP>`.
4. **gt-text-qa**: 폰트 consumer 추적·append·검증 → 한국어 줄바꿈 적용 → 깨끗한 추출본 복사 + 주입 → pf8 리팩(identity 증명 후 후보) → pfs-rs 독립 재추출 → 텍스트 재추출 왕복 mismatch 0.
5. **gt-image-***: ja UI 슬롯 PNG만 교체한다. 이미지와 텍스트 overlay를 합쳐 같은 리팩 경로를 사용한다.
6. **gt-nsw-build / gt-qa**: LayeredFS ZIP(`romfs/root.pfs` 또는 `romfs/root.pfs.<N>` + 필요 시 루즈 파일)을 만들고 Eden에서 확인한다.

## 런타임(Eden) 함정

- **LayeredFS 자체 결함과 번역 결함을 구분한다.** 세이브 화면 → 백로그/진행을 반복하면 게스트가 죽는 현상(`Unmapped Device ReadBlock/WriteBlock` 이후 힙 손상 또는 무한 `Unmapped Read`)이 **원본과 바이트 동일한 `root.pfs`를 LayeredFS로 얹기만 해도** 재현됐고, 패치가 없을 때는 재현되지 않았다. 크래시가 나면 무패치와 identity 아카이브 LayeredFS로 이분 탐색한 뒤 판정한다. 짧은 정상 플레이(세이브 → 백로그, 세이브 → 타이틀 → 로드)는 통과했다.
- 세이브 썸네일이 블록 단위로 깨져 보이는 현상은 에뮬레이터 프레임버퍼 캡처 쪽 문제로 보이며, 패치 에셋과 무관하다(무패치 baseline은 미실행).
- 세이브 슬롯 미리보기 텍스트에서 U+0020이 빠진다(대사·백로그는 정상). 엔진 save-summary 경로의 외형 문제다.
- 첫 부팅 언어 선택, 설정 언어 토글, `game_langselect` 설정에 따라 UI 언어와 텍스트 언어가 따로 정해질 수 있다. 런타임에서 ja 슬롯이 선택되었는지부터 확인한다.
- EXTRA(갤러리·음악실)는 새 프로필에서 잠겨 있다. 해당 이미지는 클리어 세이브 없이는 bench 검증만 가능하다.
- 이름 입력 소프트웨어 키보드가 떠 있는 동안 스크린샷이 timeout된다. 빈 이름으로 닫으면 기본 이름으로 대체되지 않는다(입력 아티팩트).

## 검증 체크리스트

- [ ] 식별 서명(`pf8` 매직, `system.ini` 헤더, `main`의 `%s.%03d`)과 실제 로드 tbl·`game.os`를 코드 근거로 기록했는가
- [ ] identity 왕복: 빈 target으로 주입하면 대상 파일 전부 바이트 동일
- [ ] forced regeneration: 모든 단위를 자기 ja로 재직렬화해도 바이트 동일(직렬화기 canonical)
- [ ] 한국어 스트레스 왕복: 모든 행을 길이 ×0.4~3, `"`·`\`·중괄호를 포함한 문자열로 바꿔 재추출 exact, 비텍스트 바이트 mask 동일, 다른 언어 슬롯 무변경
- [ ] pf8 identity: 무수정 입력 패킹 = 출하 아카이브 SHA-256. 후보는 pfs-rs 독립 재추출 전 엔트리 exact, `pfs-rs list` 순서 동일
- [ ] 화자 `name[1]` 무변경, 표시명이 바뀐 행만 `name[2]` 추가·변경
- [ ] 제어 토큰(`{"rt2"}`, `exfont`, `myname`, `[num]`) 순서·개수 일치, ko 루비 0, 「」『』（） 균형, 일반 문자열 필드에 태그 없음
- [ ] 모든 consumer face(선택 가능한 폰트 포함)에서 필요한 코드포인트 missing 0, 원본 glyph 바이트 diff 0, FreeType blank 0
- [ ] `_font_cache` 키 폰트가 무변경인가(변경했다면 캐시 영향 분석)
- [ ] 줄바꿈: wordparts에 indent 닫는 기호 없음, 금칙 추가 반영, 폭 모델 추정(단어 중간 줄바꿈·금칙 줄머리·줄 수 초과) 기록
- [ ] 패치 전달 방식(번호 아카이브 vs 전체 재패킹, 루즈 파일 동시 교체)과 그 근거를 기록했는가
- [ ] Eden: 한국어 glyph·공백, 「…」 들여쓰기 줄바꿈, 이름창·백로그, 선택지 → 다음 화면, 세이브 → 타이틀 → 로드, 언어 선택·설정 이미지. 크래시는 identity LayeredFS로 이분 탐색한 뒤 판정
