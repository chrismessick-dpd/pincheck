# Pincheck (pincheck): notes for Claude

Pincheck checks schematics against a library of part files, offline. Read `README.md`,
`docs/design.md` (decisions, the flow, what's next), and `docs/part-format.md`, and `../CLAUDE.md` for
the suite's hard rules.

## Status (2026-11-12)

- **Prototype.** Chris asked for it 2026-11-12: drop a schematic, find the ICs, list the ones not in
  the library, and configure them in a window; part files by hand or with an LLM, checked offline.
- Repos: `chrismessick-dpd/pincheck` (public) and `chrismessick-dpd/pincheck_data` (private, the
  library under `parts/`). No other tool links to Pincheck yet (Chris), except Signoff EE's issues that came from
  Pincheck (Open in Pincheck, below).
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
- **Scan panel (2026-11-13, Chris: Fabcheck's stage for schematics, the gallery chosen from three in
  `lab/scan-panel.html`; pushed `bb090a4`):** `assets/scan.js` leads a design's Overview when it has sheet
  drawings. Every sheet is a thumbnail, all running at once during an 8 s replay of the run. Findings land
  as marks, and the finished bar is a slider to replay one check. The start page's empty panel is the drop
  target. See `docs/design.md`, *The scan panel*.
- **Finding detail panel (2026-11-13, Chris: rows stay collapsed; a panel on the right like Fabcheck's, with a
  thumbnail that zooms into the Schematic tab):** `PK.pages.inspector`, `PK.viewer.preview`, and
  `zoomFromPreview`. See `docs/design.md`, *A finding's detail panel*.
- **Batch configure (2026-11-13, Chris: run every part still to configure through the skill at once):** the Parts
  page's *Batch configure (n)…* (`batchConfigure` in `app.js`) saves `pincheck-batch-<design>.json` (an array of
  `L.fromSchematic` starters), writes the Claude Code prompt (datasheets folder kept in `pincheck.v1.datasheetDir`),
  and imports the files Claude writes. `skill/SKILL.md` says how to fill a batch file.
- Built 2026-11-13: an Altium project's folder or .zip opens whole (`assets/archive.js`; see `docs/design.md`, *Inputs*).
- Altium nets come from the Protel2 netlist (`assets/protel.js`). What's not built yet: `docs/design.md`, *Not built yet*.
- **Send to Signoff EE (2026-11-13, Chris: Fabcheck's Send, into the Schematic Review checklist, with stored
  runs and Open in Pincheck; no revisions; pushed `7af9b5c`):** design and footprint in
  `docs/send-to-signoff-ee.md`. `assets/signoff.js` writes the issues into EE's working copy (ids `xpk…`, one per
  check and severity; notes and waived findings unticked to start); `assets/runs.js` makes the run (record plus a
  gzipped bundle of the parsed design and the part files used), keeps every sent run in IndexedDB
  `pincheck-runs[-demo]`, stores it in the board's repo under `pincheck/<id>/` (engine `GitHubStore.putFiles`,
  vendored to `assets/vendor/` by `tools/sync_vendor.py`), and takes EE's hand-off. Links:
  `#/findings?run=&project=&check=&finding=`. A reopened run shows its findings as sent until Run checks again.
  Tried in the demo only; the live store and hand-off are tested against a fake GitHub (`tests/fake-github.js`).

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

1. `python tools/make_demo.py` if the demo changed. `python tools/sync_vendor.py --check` after an engine
   change to `model.js` or `github.js`.
2. `python tools/stamp_version.py`.
3. Serve the tools folder (preview `signoff-suite-alt`, port 8774) and open `pincheck/tests/test.html`:
   PASS (40 tests). Then `pincheck/index.html?demo`: 2 of 4 ICs in the library, and the Schematic tab draws
   three sheets.
4. In the browser pane, scripts are cached: fetch changed files with `{cache: 'reload'}` first. The demo
   library is loaded into IndexedDB `pincheck-demo` once; delete that database to reload it.
