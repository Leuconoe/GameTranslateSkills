# Harness improvements progress (A→D)

Brief: shared bulk tool (A), engine tools promotion (B), small utilities (C), shared font pipeline (D).
Each item: test (node --test or python `selftest`) + row in `skills/game-translate/SKILL.md` "최상위 규칙: 공용 도구만 쓴다",
commit, push, sync to `C:\Users\user\.claude\game-translate\` and `C:\Users\user\.claude\skills\game-translate\SKILL.md`.
Never touch `engines/shin/**`.

| Item | State |
|---|---|
| A `scripts/bulk/bulk_tool.py` | done, commit 00979aa |
| B-unity `engines/unity/tools/` | done. Gotopazu 1 roundtrip rows=85702 mismatch=0 (105 TSV byte-identical, 696 bundles value-exact); supp manifest rows=15882 mismatch=0. Gotopazu 2: key scheme parses (main 96431, supp 16423), full value roundtrip not yet run |
| B-m2 `engines/m2-psb/tools/` | done: psb, m2arc, m2_adapter, m2img (Summer roundtrip rows=23058 mismatch=0, 8 archives byte-identical). m2font.py is committed with D (it calls scripts/fonts/ttf_append). Not ported: typeset/imagegen glue, m2extra, Kanojo gtb_text key scheme |
| C title:move / project:status / hash cache / nsw:romfs-verify | done (this commit). Real checks: project:status on _working, romfs-verify on Summer (extra = update-NCA patch files; pass both listings) |
| D `scripts/fonts/ttf_append.py`, `glyph_render.py` | implemented, selftests pass, uncommitted; needs python-selftests entries + SKILL row |

Next exact step: commit D (scripts/fonts + engines/m2-psb/tools/m2font.py).
