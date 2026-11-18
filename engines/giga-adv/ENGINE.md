# GIGA ADV 엔진 노하우 — binu8/datu8 (Entergram Switch 이식판)

> 출처: 실전 한글화 작업 노하우에서 일반화 이식 (2026-11)
> 근거 타이틀: 経験ゼロなクラスメイト (NSW, 1건). 아래 수치·함수 번호·열 번호는 이 1건의 실측값이며, 다른 타이틀에서는 다시 확인해야 한다.

## 대상 엔진

GIGA(web-giga)의 자체 ADV 엔진을 Entergram이 Switch로 이식한 빌드.

- **식별 서명** (모두 확인한 뒤 엔진을 확정한다. 파일명만 보고 판단하지 않는다):
  - RomFS에 `Script/*.binu8`(시나리오 바이트코드)와 `Config/*.datu8`(타입 지정 테이블)가 있다. `Rename/*.datu8`도 같은 포맷이다.
  - `Config/system.datu8` 안에 PC판 실행 파일명(`<Title>.exe`)과 web-giga URL이 들어 있다.
  - 스프라이트 배치 파일 `*.spm`(매직 `SPM VER-2.00`), 비트맵 폰트 `System/*.fnt`, `gaiji-*.fil`이 있다.
  - exefs `main`(NSO0)에 `nn::fontll::ScalableFontEngine` 심볼(`LoadFont`, `SetFont`, `AcquireGlyphmap`)과 `nn::util::ConvertStringUtf8ToUtf32`가 있다.
- **언어 슬롯**: 근거 타이틀은 NACP·데이터 모두 일본어 단일 슬롯이었다. 다른 언어 열이 없으므로 한국어는 ja 문자열을 **제자리 덮어쓰기**로 넣는다. 다국어 빌드가 있는지는 타이틀마다 `datu8` 열 구성과 Script 풀을 보고 확인한다.
- **인코딩**: binu8·datu8 문자열은 UTF-8에 NUL 종단을 붙인다. exefs `.rodata` 문자열도 UTF-8이다.

## 도구

| 도구 | 경로 규약 | 용도 |
|---|---|---|
| nstool v1.9.2 | `$GT_TOOLS/nstool-v1.9.2-win_x64/nstool.exe` | NSP/NCA 추출(`--fstree`, `-x`, `--part0` control+exefs, `--part1` RomFS). `title.keys` 로드 실패 경고는 `--tik`으로 티켓을 넘겼으면 무해 |
| 프로젝트 파서 | 프로젝트 `90_tools/scripts/` (Python 표준 라이브러리만) | binu8/datu8/NSO 추출·재주입. 아래 포맷 사양대로 구현한다 |
| fontTools | Python 패키지 | DynaFont TTC 한글 glyph 추가, advance 폭 측정 |
| Pillow | Python 패키지 | PNG 조판·검증 |

- **msg-tool v0.3.1은 이 엔진을 지원하지 않는다**(Artemis만 지원). GARbro 지원 여부는 확인하지 않았다(미검증). 공용 도구가 없으므로, 각 프로젝트가 아래 사양으로 파서를 직접 두고 해시를 `WORK_LOG.md`에 남긴다.
- LZ4 해제를 순수 Python으로 하면 전체 왕복 한 번에 약 3.5분이 걸린다. 이 정도는 정상 범위다.

## 핵심 원칙

1. **binu8·datu8은 가변 길이 치환이 안전하다.** 코드가 문자열을 바이트 오프셋이 아니라 **풀 인덱스**로 참조하고, datu8은 행·열 순서로 읽힌다. 그래서 길이 제한을 두지 않는다. exefs `.rodata`만은 원본 UTF-8 바이트 길이가 상한이다.
2. 번역 대상은 **문자열 소비자(consumer) 함수**를 보고 판정한다. 문자열 내용으로 판정하지 않는다. 텍스트 함수와 비텍스트 함수가 함께 참조하는 문자열(mixed consumer)은 번역하지 않는다. 비어 있는 풀 #0 `''`은 여러 consumer가 공유하므로 혼합 판정에서 빼고, 번역하지도 않는다.
3. 재주입은 항상 **깨끗한 원본**에서 다시 생성한다. 각 키의 원문이 원본 바이트와 정확히 같을 때만 치환하고, 하나라도 다르면 `source mismatch`로 중단한다.
4. 제어 토큰은 원문 순서대로 보존하며, 주입기에서 강제로 검사한다(토큰열이 다르면 주입 거부).
5. 화자 이름 문자열은 Script 풀, `char.datu8`, `fontcolor.datu8`(이름으로 색을 매핑)에서 **글자 하나까지 같아야 한다**. 이름이 이 표들의 키로 쓰이기 때문이다.
6. 한국어 표시 경로는 두 갈래다. **RomFS 메시지는 TTC(fontll) 경로**로, **exefs 토스트·일부 시스템 메시지는 Shift-JIS FNT 비트맵 경로**로 그려진다. FNT 경로에 한글을 넣으면 게임이 abort된다. 아래 "exefs 문자열" 절을 참고한다.

## 포맷 사양 (실측)

```text
Script/*.binu8
  u32 initN, initN × (u32 op, u32 arg)        # 초기화 세그먼트
  u32 N,     N     × (u32 op, u32 arg)        # 본 세그먼트
  u32 strCount, strCount × (u32 lenInclNUL, utf8 bytes + NUL)   # 문자열 풀
  opaque tail                                  # 그대로 복사
  문자열 push: (op 0x00, idx) 다음 (op 0x05, 1). idx >= 0x80000000 이면 변수.
  호출: 다음 op 0x07 의 arg = (argc << 16) | func_id. 마지막 push가 pos 0.

Config/*.datu8 (Rename/*.datu8 동일)
  u32 ncol, ncol × u32 type (1 = str, 2 = int32), 이후 EOF까지 행 반복
  str = u32 lenInclNUL + utf8 + NUL      # 파일 끝에 남는 바이트가 있으면 오류

exefs/main (NSO0)
  세그먼트 3개(text/rodata/data), flags bit k = LZ4 압축 여부
  번역: .rodata C 문자열을 제자리 덮어쓰고(남는 바이트는 NUL 패딩),
        비압축 NSO로 다시 쓰며 세그먼트 SHA-256을 재계산
```

- **텍스트 함수 표**(근거 타이틀 실측, 타이틀마다 재확인): `(109, pos0)` 대사, `(109, pos1)` 화자, `(33, pos0)` 선택지 프롬프트(`selectsystem`), `(21,1)`·`(23,0)`·`(35,0)`·`(115,1)` 시스템 메시지. 새 타이틀에서는 먼저 consumer 통계(func, pos별 샘플 문자열)를 뽑고, 사람이 읽고 표를 확정한다.
- **datu8 표시 열**은 파일·열 인덱스로 allowlist를 만든다(예: `char.datu8` 이름, `event.datu8` 장면 제목, `button*.datu8` 도움말, `bgm.datu8` 곡명, `system.datu8`의 게임 제목·이름 괄호·설정 미리보기·세이브 라벨 열). `system.datu8`은 열이 1,000개 가까운 1행 테이블이다. 열 번호는 타이틀마다 다르므로 실측해야 한다.
- 파일명, ID, 폰트명, PC 키 캡션, 디버그 라벨, 참조되지 않는 템플릿 문자열(다른 타이틀 캐스트가 남은 `selectsystem` 등)은 보호 문자열로 따로 기록한다. 전체 덤프(`all_strings.tsv`)를 남겨 누락 여부를 감사할 수 있게 한다.

## 추출·재주입 절차

1. nstool로 RomFS·exefs·control을 `10_extract/`에 추출하고, NACP 언어와 DisplayVersion을 기록한다.
2. 파서 `extract`로 모든 문자열 단위를 덤프한 뒤, 번역 대상만 manifest로 만든다. 안정 키는 다음 형식을 쓴다.
   - `script:<file>#sNNNN` (풀 인덱스)
   - `config:<dir>/<file>#rNNNcNNN` (행·열)
   - `exefs:main#ro+0xOOOOOO` (.rodata 오프셋, notes에 `max_utf8_bytes`)
3. TSV 셀 이스케이프: `\` → `\\`, LF → `\n`, CR → `\r`, TAB → `\t`.
4. `inject --all`로 원본 전체에서 새 빌드 폴더(`40_build/text_ko_rN`)를 만든다. 실제 변경이 없는 NSO는 원본(LZ4) 바이트를 그대로 둔다. 비압축으로 다시 쓰면 identity 왕복이 깨진다.
5. 빌드 결과를 다시 추출해 manifest 전체와 대조한다(mismatch 0). exefs 행은 NSO 바이트로 비교한다.
6. manifest를 바꿀 때마다 새 `text_ko_rN`을 만들고 최종 빌드 스크립트의 참조를 갱신한다. 이전 rN은 지우지 않는다.

### 왕복 검증 게이트 (번역 전 필수)

- **identity**: 무수정 재기록(빈 target, 그리고 원문을 target으로 넣은 경우)이 모든 binu8·datu8에서 원본과 바이트 단위로 같아야 한다.
- **길이 스트레스**: 짧은 / 같은 / 긴 한국어 테스트 문자열을 모든 행에 넣고 재추출했을 때 값이 정확히 같고 구조(토큰, 풀 개수, 열 타입)가 바뀌지 않아야 한다.
- 재추출 스캐너가 일본어만 찾도록 되어 있으면 패치된 exefs 문자열을 놓친다. 한글 범위도 함께 받도록 한다.

## 텍스트 형식

- 제어 토큰: `@vNNNNNNN[a-z]`(음성), `@sNNNN`, `@tNNNN`, `@wNNNN`, `@mNN`, `@iNN`, `@k`, `@e`, `@n`(개행), `%d`/`%s`. 정규식 예: `@v\d{7}[a-z]?|@[stw]\d{4}|@[mi]\d{2}|@[ken]|%[ds]`.
- 루비: `@r본문@읽기@`. 구조 검사에서는 루비 그룹을 따로 센다. 한국어 번역문에 루비를 남길지는 프로젝트 정책으로 정한다. 근거 타이틀에서는 루비를 빼고 본문만 남겼고, 검사 규칙은 "토큰열 일치 + 한국어 루비 0"이었다.
- **자동 줄바꿈은 글자 단위**다. 금칙(kinsoku) 설정은 `Config/*.datu8`와 exefs rodata 어디에도 없었다. 그래서 단어 중간에서 줄이 끊기거나 `다.`만 다음 줄로 넘어가는 일이 생긴다. 수동 `@n`을 넣으면 토큰 서명이 바뀌므로 알려진 한계로 기록한다.
- UI 도움말(툴팁)이 화면 가장자리에서 잘리면, 실제 TTC의 advance 폭(fontTools, em 단위)을 재서 짝을 이루는 행의 폭 이하로 줄인다. 근거 타이틀의 모든 face 간 차이는 ±0.01 em 이내였다.

## exefs 문자열 (토스트·시스템 메시지)

- `.rodata`의 표시 문자열(`ません|ました|ください|です|。|@n` 등)만 대상으로 삼는다. 인자 오류 메시지 같은 내부 문자열과 단독 `。`(구두점 테이블)은 제외한다.
- 비압축 NSO로 다시 쓰는 것 자체는 Eden에서 부팅이 됐다. 그러나 **exefs 토스트(EventInfo, 예: 자동 저장 알림)에 한글이 들어가면 `String FontBuffer` → `GlobalHeap` abort(2162-0001)가 난다.** 이 경로는 Shift-JIS 셀로 인덱싱된 FNT 비트맵 폰트를 쓰고, FNT에는 한글이 없다. 공백을 빼는 식으로는 해결되지 않았다.
- 따라서 FNT 경로에 한글을 넣을 방법(SJIS 셀 재매핑 등, 미검증)이 생기기 전에는 **exefs를 패키지에서 빼고(RomFS-only) 해당 행을 일본어로 둔다.** 이 결정과 남는 행 수를 알려진 한계로 기록한다.
- 이 abort는 정적 검사에서 드러나지 않는다. exefs를 포함한 빌드는 반드시 토스트가 처음 나오는 지점(스토리 시작 직후 자동 저장 등)까지 런타임에서 확인한다.

## 폰트 작업 (한글 주입)

- 메시지 폰트는 `Config/fontresource.datu8`에 나열된 **DynaFont TTC**이다(근거 타이틀은 TTC 3개, 사용자가 고르는 메시지 폰트). TTC마다 face가 3개(고정폭/P/G)이고 `glyf`/`loca`를 공유한다. face 이름은 `system.datu8`에서도 참조되므로 **파일명과 face 이름을 그대로 둔 채** 같은 이름의 TTC로 교체한다.
- 방식: 원본 glyph·cmap·hmtx·vmtx는 바이트까지 그대로 두고, 한글 음절(U+AC00–D7A3), 호환 자모(U+3131–318E), 필요한 기호(예: U+00B7)를 OFL 한글 폰트에서 **append**한다.
  - 변환은 **폰트마다 하나의 공통 변환**(scale + dy)만 쓴다. 기준은 대표 한자 몇 자(예: `国語東京会`)의 bbox 높이와 중심이다. 한글은 원본 전각 advance(1024) 안에서 가운데 정렬하고, vmtx는 한자 세로 원점을 따른다. 글자마다 스케일을 다르게 주지 않는다.
  - 원본 cmap에는 `idRangeOffset`가 범위를 벗어나는 항목이 있을 수 있다. 엄격한 파서로 읽으면 실패하거나 매핑이 바뀌므로, 허용형(raw) 파서로 원본 (3,1,4)·(1,0,6) 매핑을 정확히 보존한 채 cmap을 다시 만든다.
  - glyph 수가 약 2만~2.5만 개로 늘어난 TTC도 fontll이 받아들였다(Eden에서 기본 메시지 폰트로 한글 대사 표시 확인).
- `System/system*.fnt`, `systemascii*.fnt`는 Shift-JIS 인덱스 비트맵이다(glyph i = 159 + 0x8140부터 센 선형 SJIS 셀). RomFS 텍스트 경로와는 관계가 없지만 exefs 토스트 경로에서 쓰인다(위 절). `gaiji-*.fil`은 그림 문자이므로 그대로 둔다.
- 검증: 번역 manifest에 나오는 모든 가시 코드포인트가 모든 face에서 커버되는지, 원본 glyph·metric diff가 0인지, FreeType 렌더 probe에서 빈 glyph가 0인지, 새 glyph가 공통 변환에서 ±2 unit 이내인지 확인한다. 벡터 폰트라 래스터 아틀라스가 없으므로, 공용 아틀라스 검증기에는 1024 em 가상 셀 그리드로 넘긴다.

## 이미지

- UI·배경은 RomFS의 PNG이다(`System/`, `Visual/` 등). `*.spm`(SPM VER-2.00)이 텍스처와 chip source rect를 참조한다.
- 도달 가능성은 SPM 줄기 이름이 exefs `.rodata`, Script, Config 토큰에 나오는지로 판정한다. 아틀라스 PNG의 수정 영역은 chip rect 안으로 제한한다.
- 같은 PNG 묶음 안에 참조되지 않는 잔여물(다른 타이틀의 캐스트 카드, 쓰지 않는 휴대폰 화면 등)이 섞여 있을 수 있다. 파일명만으로 대상을 정하지 말고 도달 여부와 육안 검토로 범위를 정한다.
- `op.mp4`/`ed.mp4` 같은 영상, 매뉴얼 NCA는 별도 항목으로 기록한다(근거 타이틀에서는 번역 범위 밖).
- "선택(on)/비선택(off)" 쌍 이미지는 on 글자가 off 글자를 굵게 덮는 상위 집합이어야 한다. on 라벨을 off 글리프 마스크를 팽창(dilate)한 형태로 만들지 않으면, 게임에서 off 라벨이 비쳐 보인다.

## 패키징

- LayeredFS `<TID>/romfs/` 아래에 바뀐 파일만 둔다: `Script/*.binu8`, `Config/*.datu8`, `System/*.ttc`, PNG. exefs는 위 abort 문제가 풀릴 때까지 넣지 않는다.
- 최종 빌드는 원본에서 깨끗하게 다시 만든다. 그다음 정확한 allowlist, 검증된 브랜치 산출물과의 바이트 비교, 파서 재파싱, PNG 디코드, 오버레이 트리 전체 재추출 대 manifest를 검사하고, 이 게이트를 통과한 뒤에 ZIP을 만든다.

## 런타임(Eden) 주의

- 정적 PASS로는 exefs/FNT 경로 문제를 잡을 수 없다(위 abort). 패치가 없는 상태, RomFS만, exefs만 되돌린 상태, 행 하나만 되돌린 상태 순으로 bisect해 원인을 좁힌다.
- 설정 화면을 열었을 때 커서가 이미 오른쪽 열 항목에 있으면, 커서를 옮기기 전까지 툴팁이 오른쪽으로 밀려 그려지는 현상이 1건 관찰됐다. 이 경우 텍스트를 줄여도 해결되지 않는다. 툴팁 잘림을 판정할 때는 화면이 안정된(settled) 프레임과 화면이 열리거나 전환되는 프레임을 나눠서 본다.
- 선택지: 정적으로 선택지 opcode가 없는 타이틀도 있다(`selectsystem.binu8`가 참조되지 않는 템플릿인 경우). "다음 선택지로 점프"가 타이틀로 돌아가면 N/A 근거로 기록한다.

## 검증 체크리스트

- [ ] 엔진 서명(binu8/datu8, system.datu8의 web-giga 흔적, fontll 심볼)을 확인했고, msg-tool 미지원을 기록했는가
- [ ] consumer 표(func, pos)와 datu8 열 allowlist를 실측했고, mixed consumer와 풀 #0을 제외했는가
- [ ] identity 왕복(binu8·datu8 전부 바이트 동일)과 짧은/같은/긴 문자열 재추출이 PASS인가
- [ ] 주입기가 원문 불일치와 토큰열 불일치를 거부하며, exefs 행은 바이트 예산 이내인가
- [ ] 화자 이름이 Script, `char.datu8`, `fontcolor.datu8`에서 같은가
- [ ] TTC 한글 append 후 원본 glyph·metric diff 0, 전 face 커버리지 누락 0, 렌더 probe 빈 glyph 0인가
- [ ] exefs를 포함했다면 토스트 첫 표시 지점까지 런타임에서 확인했는가(아니면 RomFS-only로 하고 한계를 기록했는가)
- [ ] 최종 오버레이 트리 전체 재추출 결과가 manifest와 mismatch 0인가
- [ ] 글자 단위 줄바꿈과 툴팁 잘림을 화면 안정 상태 기준으로 확인했고, 남은 항목을 알려진 한계로 기록했는가
