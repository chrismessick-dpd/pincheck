# Pincheck (pincheck): notes for Claude

Pincheck checks schematics against a library of part files, offline. Read `README.md`,
`docs/design.md` (decisions, the flow, what's next), and `docs/part-format.md`, and `../CLAUDE.md` for
the suite's hard rules.

## Status (2026-11-12)

- **Prototype.** Chris asked for it 2026-11-12: drop a schematic, find the ICs, list the ones not in
  the library, and configure them in a window; part files by hand or with an LLM, checked offline.
- Repos: `chrismessick-dpd/pincheck` (public) and `chrismessick-dpd/pincheck_data` (private, the
  library under `parts/`). No other tool links to Pincheck yet (Chris).
- Built: SchDoc, Protel2, and KiCad XML reading, part identification, the library (IndexedDB, sync), the part
  window, the 201-key catalog, the CubeMX importer, `tools/part.js`, the `pincheck-part` skill, the demo.
- **Library (2026-11-13, Chris: fill parts as designs are tried, including every part in stored Fabcheck
  runs):** 53 part files in `pincheck_data` (`a11d419`), all unverified, made with the `pincheck-part` skill
  (STM32s from CubeMX first). Sources: the parts of the two Altium test projects and the BOMs of the EE repos'
  stored fab packages. Datasheets are in `C:\Dovetail\datasheets` (downloaded from the makers' sites at Chris's
  OK). Not filled (no official datasheet reached): ROHM LMR1901YG-M, 3PEAK TPT75176A, PUI SMT-0827-S-HT-R, and
  NDK MU00525; two crystal symbols name no part number (`WE-XTAL_CFPX-180`, `WE-XTAL_IQXC-42`).
- **Checks (2026-11-13, Chris: all of them, Fabcheck-style pages, no check matrix):** `assets/checks.js`
  (23 checks in six groups, net voltages from regulators and dividers) and `assets/findings.js` (Overview,
  Findings). Contract: `docs/checks.md`. Blind run on a real Altium project (local only) found reversed
  gate supply pins, an open VBAT, a missing SMPS capacitor, wrong crystal load capacitors, and two RXD
  outputs on one net.
- **Schematic viewer (2026-11-13, Chris: like Fabcheck's Board, jumping to findings; built, not committed):**
  `assets/schdoc.js` `graphics` reads each sheet's drawing and `connect` its wires; `assets/viewer.js` draws it
  on a canvas (sheet tabs, pan and zoom, hover names, a findings rail, marks at each finding's pins). See
  `docs/design.md`, *The schematic viewer*. The demo is now Altium sheets and a Protel2 netlist made by
  `tools/make_demo_altium.py` (with `tools/schdoc_write.py`), beside the KiCad netlist.
- Not built: zip drop. Altium nets come from the Protel2 netlist (`assets/protel.js`). See `docs/design.md`, *Not built yet*.

## Rules

- **No client data in this repo.** Not in code, docs, tests, demo, or commit messages. Real projects
  are tried from git-ignored `samples/` or a scratch folder only. Grep for the suite's client terms
  (`../CLAUDE.md`) and the projects' names before a commit.
- **Part files from ST's CubeMX database go only into `pincheck_data`**, never this repo (ST's
  terms). The demo library is written by hand in `tools/make_demo.py`.
- **Checks never call an LLM.** The `pincheck-part` skill only makes part files, and only a person
  sets `ok` on a value.
- **A failure resting on an unverified value is a warning** (Chris).
- **The skill's source is `skill/SKILL.md`.** After changing it, copy it to
  `../.claude/skills/pincheck-part/SKILL.md`.
- **Severity never by hue alone** (Chris is colorblind): warnings use `--warn-hatch` and ▲, errors
  `--issue-hatch` and ✕.
- **American English, metric, and the serial comma** in UI text, docs, and commit messages.
- `assets/suite.css` is EE's stylesheet; re-copy with `python tools/sync_suite_css.py`, never edit it.
  The sign-in, People & access, and sidebar foot load from `../signoff/assets/` (as Partcheck's do).
- **Commit and push only when Chris asks.**

## Before finishing a change

1. `python tools/make_demo.py` if the demo changed.
2. `python tools/stamp_version.py`.
3. Serve the tools folder (preview `signoff-suite-alt`, port 8774) and open `pincheck/tests/test.html`:
   PASS (29 tests). Then `pincheck/index.html?demo`: 2 of 4 ICs in the library, and the Schematic tab draws
   three sheets.
4. In the browser pane, scripts are cached: fetch changed files with `{cache: 'reload'}` first. The demo
   library is loaded into IndexedDB `pincheck-demo` once; delete that database to reload it.
