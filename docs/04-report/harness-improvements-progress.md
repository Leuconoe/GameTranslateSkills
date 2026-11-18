# Harness improvements progress (A→D)

Brief: shared bulk tool (A), engine tools promotion (B), small utilities (C), shared font pipeline (D).
Each item: test (node --test or python `selftest`) + row in `skills/game-translate/SKILL.md` "최상위 규칙: 공용 도구만 쓴다",
commit, push, sync to `C:\Users\user\.claude\game-translate\` and `C:\Users\user\.claude\skills\game-translate\SKILL.md`.
Never touch `engines/shin/**`.

| Item | State |
|---|---|
| A `scripts/bulk/bulk_tool.py` | done, commit 00979aa |
| B-unity `engines/unity/tools/` | done. Gotopazu 1 roundtrip rows=85702 mismatch=0 (105 TSV byte-identical, 696 bundles value-exact); supp manifest rows=15882 mismatch=0. Gotopazu 2: key scheme parses (main 96431, supp 16423), full value roundtrip not yet run |
| B-m2 `engines/m2-psb/tools/` | partial: psb.py, m2arc.py, m2_adapter.py (selftests pass; Summer rt1 mismatch=1 fixed in read(), rerun pending). Next: rt3 roundtrip, port m2font.py + m2img.py, ENGINE.md Tools section. Kanojo gtb_text manifest key scheme unsupported (re-extract with adapter) |
| C title:move / project:status / hash cache / nsw:romfs-verify | implemented + tested on disk (tests/title-utilities.test.mjs, hash_cache.py selftest), uncommitted; package.json + nsw-release-zip.mjs + eden_tools.py edits belong to C |
| D `scripts/fonts/ttf_append.py`, `glyph_render.py` | implemented, selftests pass, uncommitted; needs python-selftests entries + SKILL row |

Next exact step: finish B-m2 (above), commit B-m2, then commit C, then D.
