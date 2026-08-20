# Steam/PC 추출과 원본 분석

## 1. 소스 확정

1. 실제 게임 EXE가 있는 설치 폴더를 title root로 확정한다.
2. Steam이면 외부 `appmanifest_<APP_ID>.acf`의 `appid`, `buildid`, `installdir`를 읽고
   `PROJECT.md`·`SOURCE_INVENTORY.tsv`와 대조한다.
3. 게임 EXE의 크기·SHA-256, 엔진 marker와 분석에 사용한 핵심 파일의 상대경로·해시를 기록한다.
4. 게임 업데이트 뒤 build ID 또는 EXE hash가 바뀌면 이전 추출·빌드의 호환성을 추정하지 말고
   overall analyze부터 영향 범위를 재검증한다.

appmanifest나 설치 게임 파일을 프로젝트로 이동하거나 수정하지 않는다. `00_source/`는 source
inventory와 외부 절대경로 증거를 기록하는 곳이지 설치본 전체의 사본 폴더가 아니다.

## 2. 선택적 source snapshot

- 엔진 도구가 쓰기 작업을 할 가능성이 있으면 필요한 파일만
  `10_extract/source_snapshot/<install-relative-path>`로 복사하고 원본/사본 hash 일치를 기록한다.
- 전체 설치본이 필요한 read-only scanner는 설치 폴더를 입력으로 사용할 수 있지만 output,
  cache, log, temp를 `10_extract/`, `90_tools/work/extract/` 아래로 강제한다.
- `.exe`, managed assembly, asset bundle을 배포 overlay로 복사하는 행위와 분석 snapshot을
  혼동하지 않는다. snapshot은 릴리스 입력이 아니다.

모든 쓰기 전에 다음과 같이 경계를 확인한다.

```powershell
npm run project:boundary -- `
  --project-root '<install-root>\_work\steam-<APP_ID>' `
  --stage extract `
  --assert-output '10_extract/source_snapshot' `
  --assert-output '10_extract/decompiled'
```

## 3. 엔진·문자열 consumer 확인

- Unity: `<Game>_Data`, managed/IL2CPP 여부, 실제 text component와 폰트 fallback을 확인한다.
- 런타임 map 방식: `원문=번역`처럼 보이는 포맷도 delimiter escaping, literal newline,
  duplicate key, whitespace normalization, rich text를 먼저 round-trip한다.
- 프로젝트 전용 plugin 방식: DLL 파일 존재만으로 호환성을 증명하지 않는다. 대상 build에서
  plugin load log, hook 대상, 실제 UI consumer render를 확인한다.
- 외부 DB/API에서 내려오는 텍스트는 static asset inventory와 분리하고 runtime-discovered source로
  stable key·발견 build·화면 문맥을 기록한다.

MGCM에서 확인된 XUnity translation map과 전용 root-patch plugin 조합은 위 두 패턴의 실측
근거지만, 다른 게임에 파일명·hook·언어 slot·폰트를 그대로 재사용하지 않는다.

## 4. 추출 완료 기준

- [ ] App ID/배포 build ID/게임 EXE hash가 서로 일치
- [ ] 원본 설치 파일 변경 0건
- [ ] 선택 snapshot이 원본과 byte-exact이고 artifact manifest에 등록됨
- [ ] 엔진·container·텍스트/image/font consumer가 증거와 함께 식별됨
- [ ] export/import round-trip에서 구조·제어 토큰·key 손실 0건
- [ ] 게임 업데이트 시 invalidate할 입력 목록이 `ANALYSIS.md`에 기록됨
