# Unity 엔진 한글화 노하우

> 출처: 실전 한글화 작업 노하우에서 일반화 이식 (2026-08)

## 도구

| 도구 | 경로 규약 | 용도 |
|---|---|---|
| UABEA | `$GT_TOOLS/UABEA/` | 에셋번들/serialized file 검사·에셋 교체·리빌드 |
| Il2CppDumper | `$GT_TOOLS/Il2CppDumper/` | IL2CPP 빌드의 메타데이터 덤프 — 클래스·필드 구조 파악, type tree 보조 |
| Switch Toolbox | `$GT_TOOLS/Switch-Toolbox/` | 플랫폼 텍스처 포맷 검사 보조 |

- Il2CppDumper에는 실행 파일과 `global-metadata.dat`가 필요하다. 도구가 요구하는 전처리(실행 파일 압축 해제 등)는 한 번만 검증하고, 실패 시 입력을 계속 변형하지 말고 버전·입력 해시·오류를 고정해 기록한다.
- 문자열 테이블 주입용 매니페스트는 **type tree/스키마 파싱**으로 만든다. 길이 접두 문자열 스캔·인접 언어 휴리스틱은 inventory 후보 수집용일 뿐, raw 후보 보고서를 canonical 번역표로 승격하지 않는다.

## 텍스트 원천 전수 (시나리오 밖 문자열)

시나리오·TSV만 추출하면 UI가 일본어로 남는다. 분석 단계에서 아래 원천을 모두 inventory한다.

| 원천 | 비고 |
|---|---|
| 시나리오·TextAsset·TSV/마스터 데이터 | 보통 첫 manifest에 들어감 |
| UI 프리팹 문자열(`data.unity3d`, 씬·프리팹의 Text/TMP 컴포넌트) | MonoBehaviour typetree가 제거된 빌드가 많음 |
| I2 Localization 등 로컬라이즈 에셋 | 언어 열 구조를 확인해 슬롯 결정 |
| IL2CPP 코드 리터럴(`global-metadata.dat`) | 우선 추출만(extract-only) 하고 주입 여부는 별도 판단 |

- **typetree가 제거된 번들**: Il2CppDumper로 DummyDll을 만들고 TypeTreeGeneratorAPI로 typetree를 생성해 MonoBehaviour를 읽는다.
  Il2CppDumper auto 모드가 정적 CodeRegistration을 못 찾으면 실패할 수 있다. 이때는 CodeRegistration을 보강한 합성 NSO로 덤프하고, 사용한 입력·도구 버전을 기록한다.
- 보충 원천을 나중에 추가할 때는 canonical manifest를 바꾸지 않고 별도 보충 manifest로 두며, 기존 행과 겹치는 원문은 표시한다.
- 게이트: 무수정 재기록 시 대상 번들 전 객체 raw-identical, 한국어 probe 주입 → 재추출 mismatch 0.
- **조회 키로 쓰이는 MonoBehaviour 필드는 원문 유지.** 화면에 보이는 문자열처럼 생겨도 게임이 그 값으로 데이터를 찾으면
  번역 시 해당 화면이 무한 로딩된다(예: `ChapterListNode._chapterName`/`_chapterNum` → 이벤트 탭 무한 LOADING).
  `supp_text.py`의 `KEY_FIELDS`가 기본 제외하고, 타이틀별로 `extract --key-fields Class.field,...`로 늘린다.
  이미 만든 보충 manifest의 해당 행은 `status=translated`, 빈 `target_ko`, notes `;keep_source;key_field`로 되돌린다.
  화면이 멈추면 원본 → 파일 → 클래스(`cls=` notes) 순으로 bisect해 원인 클래스를 좁힌다.
- **I2 읽기(가나) 필드는 원문 유지.** `Tutorial/LabelInitialLastNameKana`·`…FirstNameKana`처럼 이름 입력의 읽기 값을
  담는 term은 게임이 가나인지 검증하므로, 한국어로 바꾸면 입력 확인이 통과하지 않는다. `supp_text.py`의
  `KEY_I2_TERMS`(term 이름이 `Kana`/`Furigana`/`Yomi`로 끝남)가 기본 제외하고, 다른 term은 `--key-fields I2.<term>`로 늘린다.
- **IL2CPP 리터럴은 xref로 표시 전용이 증명된 것만 주입한다.** 같은 리터럴이 비교·사전 키·리소스 경로·enum 이름·
  저장 키로도 쓰이면(lookup key) 원문을 유지한다. `lit_keep` 휴리스틱 통과나 "화면에 보임"은 증명이 아니다. 화면에 보이는
  반각(ｶﾀｶﾅ) 변형이 별도 리터럴로 있을 수 있으므로, 표시가 증명된 변형만 따로 보충 행으로 두고 safety TSV에 `safe`로 올린다.

## TMP/SDF 한글 폰트 주입

TextMeshPro 폰트 에셋(SDF 아틀라스 + glyph/character 테이블)에 한글을 주입할 때:

1. 런타임이 실제로 읽는 TMP Font Asset과 폴백 체인을 먼저 확인한다. 한국어 포함 여부만으로 후보 폰트를 결정하지 말고, 보존할 일본어/영어를 포함한 전체 가시 코드포인트로 평가한다.
2. **원본 face metrics(ascent/descent/line height/baseline 등)와 기존 character/glyph metrics를 보존한다.** 원본 폰트 에셋의 face info를 새 폰트 값으로 통째로 교체하면 기존 레이아웃이 흔들린다.
3. 새로 추가하는 한글 glyph의 크기 보정은 **공통 스케일 1개**로만 적용한다. 원본 폰트와 주입 폰트의 UPM·렌더 크기 차이는 전체 한글에 동일한 배율로 보정한다.
4. **per-character 스케일 조정은 금지한다.** 글자마다 다른 스케일을 넣으면 자간·베이스라인이 불규칙해지고 이후 재주입·검증이 불가능해진다. 공통 스케일로 해결되지 않으면 SDF 생성 파라미터(샘플링 크기, padding)를 원본과 맞춰 다시 굽는다.
5. SDF 아틀라스 텍스처를 교체하면 glyph rect·atlas 크기·padding 값이 테이블과 정확히 일치해야 한다. 텍스처만 바꾸고 테이블을 방치하지 않는다.
6. QA는 재패킹된 번들에서 폰트 데이터를 다시 꺼내 전체 가시 코드포인트를 렌더링해 tofu·빈 outline 0건을 확인한다. 완성형 한글 범위, 작은 글자, 행간, 루비 위치, 메뉴 선택·비활성 상태를 실기/에뮬레이터에서 확인한다.

## 폰트 아틀라스 강제 검증

`gt-text-qa`는 아래 파일을 만들고 `$GT_HOME/common/font-atlas-contract.md`를 적용한다.

```text
30_translation/text/FONT_COVERAGE.tsv
30_translation/text/FONT_ATLAS_MANIFEST.tsv
30_translation/text/FONT_ATLAS_QA_REPORT.md
```

아틀라스 텍스처만 바꾸는 패치는 금지한다. 원본과 후보의 codepoint→glyph ID, atlas page,
rect, UV 원점, padding, bearing, advance, baseline, face metrics를 비교하고 기존 언어
glyph·비대상 glyph는 exact로 보존한다. 좌표가 뒤집히거나 글리프가 위아래로 밀리면
per-character offset을 임의로 넣지 말고 import/export 좌표계·padding·공통 scale·font
asset reference를 다시 증명한다. 재패킹 후 독립 재추출과 render probe가 통과하기 전에는
`font_status=verified` 또는 `text_status=review_ready`를 기록하지 않는다.

일반 폰트(TTF/OTF 직접 참조)의 경우: 전면 교체가 기존 언어 glyph를 잃거나 outline 형식(`glyf`/CFF)이 달라 병합할 수 없으면, 원본 glyph를 유지한 채 호환 TrueType glyph를 추가하는 방식을 우선한다. composite glyph 이름, `cmap`/`hmtx`/`maxp` 갱신, 원본 glyph 무변경을 검증한다.

## 에셋번들 리빌드

- **대상 정규화와 비대상 회귀를 분리한다.** 쓰기 전에 객체 수·type·안정 ID/path ID·리소스 소유 관계를 inventory하고, 쓰기 뒤 새 번들을 **독립 프로세스에서** 다시 연다. 대상 객체는 크기·mip·alpha·표시 픽셀과 사전에 선언한 형식 정규화만 허용하고, 비대상 객체의 raw/typetree와 외부 resource payload는 exact로 비교한다.
- writer가 스트리밍 데이터를 inline으로 바꾸거나 압축 형식을 동등 포맷으로 바꾼다면 그 변화만 명시적 allowlist에 두고, 다른 메타데이터 변화는 실패시킨다.
- **직렬화 자산 교체에서는 payload뿐 아니라 객체 정체성과 스키마 메타데이터를 보존한다.** 안정 ID/path ID, 객체명·해시, `m_Script` 등 PPtr, externals/dependencies, 예상 type tree를 전후 비교하고 사전 allowlist의 payload 필드만 변경한다. 번들이 다시 열리고 데이터가 들어 있어도 **스크립트 참조가 사라지면 런타임에 아무것도 표시되지 않는다.** 객체 inventory와 외부 참조 테이블 검증을 별도 게이트로 둔다.
- 언어별 슬롯 주입 시 깨끗한 원본의 source identity와 현재 대상 값을 먼저 assert하고, 재로드 후 수정 슬롯 전수 일치와 보존 슬롯 byte/text exact를 별도 검증한다.

## Addressables

- **번들 교체 전에 카탈로그의 로컬 로드 정책을 확인한다.** 번들 CRC, 로컬/원격 provider, URL 방식, 파일 크기 제한을 읽고 카탈로그 패치 필요 여부를 결정한다. 대상 카탈로그를 얻지 못해 유사 프로젝트를 참고했다면 `inference`로 명시하고 실기 검증을 `PENDING`으로 유지한다.
- **카탈로그의 Hash/CRC를 압축 번들 파일 해시로 추정하지 않는다.** 먼저 깨끗한 번들로 기존 카탈로그의 Hash128·CRC·size를 전수 재현해 알고리즘을 증명한다. serialized payload와 외부 resource stream의 순서·범위, content hash 결합, 재귀 dependency closure의 dedupe·정렬 등 실제 빌드 파이프라인 입력을 확인한 뒤 재빌드 메타데이터를 계산한다. 카탈로그는 대상 옵션의 Hash/CRC/size만 패치하고 전체 옵션 이름·개수와 비대상 레코드를 exact로 잠근 뒤, 저장본을 다시 파싱하고 엔진 로더로 연다.
- 깨끗한 Addressables 원본에서 내부 identity와 외부 파일명이 원래 다르면 두 값의 문자 동일성을 강제하지 말고, 동일 외부 파일의 원본 identity 보존을 검증한다.
- 내부 파일명·Addressables 키·의존성 문자열로 잃어버린 경로를 복구할 수 있으나, 여러 자산에서 일관된 규칙 검증 없이 단독 증거로 쓰지 않는다.

## 이미지·아틀라스 처리

- 깨끗한 원본 아카이브에서만 참조용으로 익스포트한다. 아틀라스 매니페스트에 원본 아카이브, 텍스처 키, x/y, 폭/높이, 언어, 해시, 원문, 한국어, 상태를 기록하고, 모든 수정 크롭에 매니페스트 행이 있을 때만 재조립한다.
- **SpriteAtlas 좌표는 추측하지 않는다.** packed sprite의 공개 rect가 `0,0`으로 보이면 `Sprite.image`, atlas render-data map 또는 동등한 내부 매핑으로 실제 위치를 구한다.
- **압축 재인코딩의 간접 효과를 고려한다.** Crunch 등으로 압축된 아틀라스는 한 스프라이트 수정만으로 전체 텍스처가 재인코딩되어 비대상 스프라이트에도 edge pixel 차이가 생긴다. byte exact만 강제하지 말고 대상용 alpha/pixel 허용치와 비대상용 회귀 허용치를 분리하고 시각 비교를 병행한다. 스프라이트 추가·삭제, 내부 ID 변경, 겹침은 허용하지 않는다.
- **공유 스프라이트 참조는 그래프 갱신으로 취급한다.** 여러 언어 프레임이 하나의 source crop을 가리키면 의도한 모든 대상 참조를 갱신하거나 새 리소스로 명시적으로 분리한다. 재컴파일 후 모든 언어 변형을 검증하고 보존 언어 프레임이 원래 픽셀을 계속 가리키는지 확인한다.
- **언어별 프레임 계열을 전부 열거한다.** 중첩 컨테이너에는 이름이 거의 같은 병렬 계열이 존재할 수 있고 OCR이나 첫 manifest가 그중 하나만 다룰 수 있다. 전체 객체 그래프를 순회해 언어 접미사·런타임 부모 경로별로 프레임을 묶고, 런타임 화면의 모든 라벨과 정적 인벤토리를 대조하기 전에는 UI 커버리지를 완료로 처리하지 않는다.
- **추가한 텍스처는 모든 리소스 표에 등록한다.** 컴파일러가 sidecar 리소스 맵(예: `.resx.json`)도 읽는다면 디컴파일 메타데이터에 노드를 추가하는 것만으로는 불완전하다. 메타데이터 인덱스와 sidecar를 동기화하고, 컴파일 후 독립적으로 재디컴파일해 추가 텍스처마다 크기·픽셀/알파 해시 일치를 요구한다.
- **번역 라벨이 안전하게 들어가지 않으면 전용 고정 크기 텍스처를 사용한다.** 원문 슬롯이 좁다고 라벨을 읽을 수 없게 축소하거나 무관한 아틀라스 슬라이스를 이동하지 않는다. 전용 텍스처를 할당하고 의도한 프레임만 재지정하며, 기존 아틀라스 크기·좌표를 보존하고 선언한 슬라이스 밖의 원본 픽셀 동일성을 증명한다.
- 부분 문구 교체는 각 교체 영역의 `clear_bbox`와 렌더 clip을 명시하고, 영역이 비어 있거나 캔버스 밖이거나 겹치면 renderer가 즉시 실패하게 한다. 보존 픽셀은 identity region으로 잠그고 clear 영역 밖이 decoded RGBA 기준 원본과 exact인지 독립 diff로 확인한다. pixel exact를 PNG 압축 바이트 동일성과 혼동하지 말고 canvas/mode/헤더/chunk를 별도 검증한다.
- 구조적 QA PASS(주입·리로드·해시 통과)와 **원본 스타일 일치는 별도 게이트다.** 로고 구성, 서체 계열, 장식, 질감, 여백, active/inactive 관계를 원본/후보/실제 주입 크롭 나란히 비교로 확인하고, 시각 언어가 어긋난 결과는 기술적으로 정상이어도 폐기한다.
- 원본을 최대한 재사용한다. 비활성 상태는 별도 생성하기보다 원본의 active→inactive 색·alpha 변환에서 파생한다.

## Tools (`engines/unity/tools/`)

Unity 2021.3 IL2CPP + Utage 계열에서 일반화한 공용 도구. 모두 `python -I <file> selftest`로 타이틀 데이터 없이 자가검증한다.
UnityPy 경로는 `$GT_PYLIB`(기본 `E:\NSW\_tools\python`), TypeTreeGeneratorAPI는 `$GT_TTGEN`, typetree가 제거된
`data.unity3d`용 DummyDll은 `$GT_UNITY_DUMMYDLL`(기본 `10_extract/decompiled/*/out/DummyDll`).

| 파일 | 용도 |
|---|---|
| `unity_adapter.py` | `scripts/bulk/bulk_tool.py --adapter`용 어댑터(SRC_REL=`10_extract/romfs_original`). TSV·시나리오·공유 설정·보충 클래스·IL2CPP 리터럴 행을 키로 주입/재판독. 기존 두 manifest 키 형식(`L<n>:C<c>`, `<pid>\|import<g>:r<r>:c<c>` / `T\|…`, `S\|…`, `G\|…`)을 그대로 읽음. 임의 manifest용 `inject\|verify --manifest` CLI 포함 |
| `utage_text.py` | 마스터 TSV + Utage 시나리오 번들 추출 규칙. 타이틀별 차이(제외 열/테이블, 최소 열, 셀 수 엄격 검사, Arg 표시 명령)는 `$GT_UTAGE_CFG` JSON으로 덮어씀 |
| `supp_text.py` | 보충 클래스(ui_prefab, u3d_ui, u3d_i2, textasset, il2cpp_literal) 추출 → `supplement/SUPP_MANIFEST.tsv`, 무수정 raw-identical noop |
| `meta_literals.py` | `global-metadata.dat` v29 리터럴 추출/주입/검증(인덱스 불변, 새 data blob 추가). 리터럴은 타이틀별 사용처 검토 후 safety TSV(`$GT_UNITY_LITERAL_SAFETY`)의 `safe` id만 주입 |
| `unity_font.py` | Unity 동적 Font(내장 CID CFF)에 한글을 새 CID로 추가(원본 glyph·metrics exact, 소스별 공통 scale 1개) → build/verify/noop/coverage. TMP SDF·TrueType 기반은 대상 아님 |
| `unity_image.py` | Texture2D 라벨 조판·로고/패치 교체(spec `IMAGE_TEXT_INVENTORY.tsv` + `image_config.json`). 형식·크기·m_PlatformBlob 유지, 편집 픽셀이 있는 블록만 재인코딩해 제자리 splice(Switch swizzle 포함) → `--round rN` 독립 overlay build/verify/noop. 같은 spec을 쓰는 자매 타이틀은 `primary_root` + `locate`(template match). 후속 라운드는 `--spec 이전.tsv,추가.tsv`(순서대로 적용, key 중복 거부)로 이전 편집을 포함한 단독 overlay를 만들고, 아직 없는 imagegen PNG 행은 `render --skip-missing`으로 pending 처리(render_log.json) |

```text
python -I scripts/bulk/bulk_tool.py roundtrip -p <_work/TID> --adapter engines/unity/tools/unity_adapter.py --out <새 디렉터리>
```
