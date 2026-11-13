---
name: pincheck-scan
description: Check a whole Altium (or KiCad) schematic project with Claude, beyond Pincheck's offline checks. Runs the offline checks as the baseline, fills the part files the library lacks from makers' datasheets, reviews every sheet against the datasheets and Signoff EE's Schematic Review checklist, and writes a scan (pincheck.scan/1) of what the offline checks missed, got wrong, or lacked data for, stored in pincheck_data at Chris's OK. Use when Chris asks to check, scan, or review a schematic project with Claude, or pastes Pincheck's "Check with Claude" prompt.
---

# Check a project with Claude (a Pincheck scan)

Pincheck (`C:/Dovetail/tools/pincheck`) checks schematics offline against a library of part files. You are doing
the slower, deeper check by reading the design yourself, and writing down **every difference from the offline
check**, so the `pincheck-improve` skill can make the offline check catch it next time. Read
`C:/Dovetail/tools/pincheck/docs/claude-scan.md` (the scan format) and `docs/checks.md` (what the offline checks
do) first.

Arguments: the project folder or .zip (with its Protel2 `.NET`, or a KiCad XML netlist), and optionally the build
variant. If none is given, ask for the folder.

## Rules

- **Client data stays private.** Work in `C:/Dovetail/scratch/pincheck-scans/<design slug>-<scan id>/`. Scans go only
  to `pincheck_data` (private), with `scan.js push`. Never copy anything from the project into a public repo, and
  never change Pincheck's code in this skill (that's `pincheck-improve`).
- **Every claim has evidence**: a datasheet page (PDF page, 1-based) and what it says, or the pins and nets that show
  it. No evidence, no item. Never fill a datasheet value from memory.
- **Only problems a careful EE would act on.** No style nits, no "consider" items without a reason. Things you can't
  settle from the schematic (layout, firmware, the enclosure) are `idea` items, or `notCheckable` when they're a
  whole checklist area.
- **Nothing written to a repo without Chris's OK**: show the `push --dry-run` output and wait.
- **Datasheets only from the maker's own site** (Chris allowed downloading them for scans, 2026-11-13), saved in
  `C:/Dovetail/datasheets`. A distributor's copy or a datasheet aggregator is not a source.
- American English, metric, and the serial comma in everything you write.

## Steps

1. **Set up.** Pick the scan id now: the UTC time as `YYYYMMDD-HHMM`. Then:

   ```bash
   cd C:/Dovetail/tools/pincheck
   node tools/scan.js library
   node tools/scan.js run "<project>" --out "<work>" [--variant "<name>"]
   ```

   If it says there's no netlist, stop and ask Chris for the Protel2 netlist (Design › Netlist For Project ›
   Protel2): without nets nothing can be checked. Read `<work>/design/index.md` and `<work>/offline.json`.

2. **Fill the missing parts.** `<work>/missing.json` is a batch file in the `pincheck-part` skill's format (each
   entry also has `refs`). For each part:
   - find its datasheet in `C:/Dovetail/datasheets` (by part number, or the base part number without the
     packaging suffix); otherwise find it on the maker's site and download it there;
   - fill it with the `pincheck-part` skill's steps, its entry as the exported file, writing `<work>/parts/<id>.json`.
     Run these in subagents, three or four at a time, each given the `pincheck-part` skill (`C:/Dovetail/tools/.claude/skills/pincheck-part/SKILL.md`), its one entry, and the datasheet path;
   - a part with no part number, or no datasheet on the maker's site, goes in `parts.notFound` with why.

   Then run the offline checks again **with them**, which is the baseline the scan compares with:

   ```bash
   node tools/scan.js run "<project>" --out "<work>" --extra "<work>/parts" [--variant "<name>"]
   ```

3. **Find every IC's datasheet** (the review needs them, not just the missing parts): `C:/Dovetail/datasheets`, a
   `datasheets` folder in or near the project (search `C:/Dovetail` for `<MPN>*.pdf` if Chris keeps one per
   review), then the maker's site, downloading into `C:/Dovetail/datasheets`. List the ones you couldn't get.

   **Plan the review.** From `design/index.md`, split the design into areas of about 60 parts or fewer: each sheet,
   or a big sheet's subcircuits (a regulator and its parts, an MCU and its support, one interface). Note which
   offline findings touch each area's parts.

4. **Review each area in a subagent** (several at a time). Give each one:
   - its sheet file(s) from `<work>/design/`, and `design/index.md` (rails, nets shared across sheets);
   - the offline findings on its parts (from `offline.json`), and the list of offline checks (`offline.json`
     `checks`, and `docs/checks.md`);
   - for each IC: `node tools/part.js summary <part file>` (library files are in `~/.signoff/pincheck/data/parts/`,
     this scan's in `<work>/parts/`), and its datasheet path;
   - Signoff EE's Schematic Review checklist, `C:/Dovetail/tools/ee_design_review/templates/schematic.json`
     (179 items in 18 sections; use the ones that apply to the area);
   - these instructions: *Check the area as a senior EE reviewing it for release. For every IC, read the datasheet's
     pin table, absolute maximum and recommended conditions, application and layout sections, and check each pin's
     connection, the required external parts and their values, enable, reset, and boot pins, and every interface
     to the rest of the board. Check passives' values and ratings where the schematic gives them. Return JSON:
     `{ "reviewed": { "area", "sheets", "checked": [what you checked, in short phrases] }, "agrees": [offline finding
     ids you checked and agree with], "items": [ … ] }`, each item as in `docs/claude-scan.md` without `id`, with
     `type` your best guess. For an offline finding you think is wrong, a `false-alarm` item naming it in `offline`.
     Give evidence for each item (datasheet page and what it says, or the pins and nets).*

5. **Check across areas yourself:** the power tree (every rail's source, its load, sequencing, and enables), nets
   that cross sheets (both ends agree on direction, level, and pull), shared buses (addresses, pull-ups once per
   bus), and parts not fitted in the variant.

6. **Sort and verify every item.** For each candidate:
   - **Already found offline?** Then it goes in `agrees`, not `items`.
   - **`data`**: an offline check covers it (`check`), but the part file lacks the value or has it wrong. Say what
     in `needs` (the key, or a pin's `role`, `ext`, `unused`). If the file is wrong, say what the datasheet says
     and its page.
   - **`missed`**: no offline check looks for it, or one does and has its data but didn't fire (name it in `check`
     then). Write `rule` in general words, the way an offline check would decide it from the netlist and part
     files, never naming this board.
   - **`false-alarm`**: name the offline finding in `offline`, and in `rule` what the check should do instead.
   - **`idea`**: worth Chris's look, but not something a netlist check can decide.
   Then re-read the evidence for every `error` and `warn` item yourself (the datasheet page, the pins in the sheet
   file): drop what doesn't hold, and set `confidence` honestly. Number the items `c1`, `c2`, … with errors first.
   Add `ee` (the Schematic Review item id) where one matches.

7. **Write `<work>/scan.json`** (`pincheck.scan/1`: `id`, `design` as `offline.json` names it, `at`, `by`
   `"pincheck-scan skill"`, `model`, `reviewed`, `agrees`, `items`, `parts`, `notCheckable`) and check it:

   ```bash
   node tools/scan.js check "<work>"
   ```

   Fix every error.

8. **Report to Chris**, short: the offline baseline's counts, how many items of each type with the errors listed
   one line each, the parts filled and not found, and what you couldn't check. Then show him
   `node tools/scan.js push "<work>" --dry-run` and ask to store it. On his OK, run it with `--confirm <code>`.

9. **Tell him what's next:** in Pincheck, open the project, sync, and open Findings › *Claude's scan* to confirm or
   turn down each item (or Accept all), and import the scan's part files from there. Then the `pincheck-improve`
   skill builds what he confirmed.
