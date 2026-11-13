# Send to Signoff EE

Pincheck's counterpart to Fabcheck's Send to Signoff (`../pcb_dfm/assets/signoff.js`, `repo.js`, and
`ee_design_review/docs/fabcheck-link.md`). Chris, 2026-11-13: the same send, into the board's
**Schematic Review** checklist, with stored runs and *Open in Pincheck* on the issues. No revisions:
Pincheck runs aren't listed or tagged in EE's Revisions tab.

## How Fabcheck does it (what we copy)

1. **Send panel** on the Overview: a Project picker over Signoff EE's working copies in this
   browser (`signoff.v1.projects`, or `signoff.demo.projects` in the demo), *Send to Signoff EE*, and
   *Details*. Details lists one row per issue it would write, each with a checkbox, plus boxes for
   all issues, errors, warnings, and *Waived, for reference* (unticked to start). Each row says
   whether it's new, updates the issue sent before (keeping the reviewer's status), or re-raises a
   deleted one. Issues sent before that the run no longer finds get a "no longer found" note.
2. **Sign-in** on first use (Fabcheck is a public tool), then a check that the token can write to
   the board's home repo (the shared `review-ee-…` repo, else the data repo under its data path).
3. **Confirm**: names the private repo, what will be stored, and its size. Cancel keeps it all in
   the browser.
4. **Busy card** (`.busy` in the suite's styles): a step line and a bar while it stores, then
   *Stay* or *Open in Signoff EE*.
5. **Stores first** (one commit through the engine's `GitHubStore.putFiles`, `force: false`, retried
   on a race). If storing fails, nothing is sent; the panel offers *Send without storing*.
6. **Writes the issues** into Signoff EE's working copy in localStorage, stamped and marked dirty, so
   Signoff's next Sync pushes them. One custom check per check and severity, with a stable id, so a
   re-send updates the same issue. `source: { tool, check, gone, run, locations }`.
7. **Open in Fabcheck** in the issue's details: EE reads the run from the repo with its own token,
   puts it in IndexedDB `dovetail-handoff` (store `runs`), and opens the link in the same tab.
   Fabcheck takes the entry, or finds the run among its own kept runs (the demo's way).

## What Pincheck sends

- **Errors** become Major issues and **warnings** Minor ones, on the *Schematic Review* checklist,
  grouped by check and severity as Fabcheck groups (one issue per group, at most 25 findings in its
  text, at most 50 clickable findings).
- **Notes** (Info findings: a part with no file, a floating pin with no rule, an address to check by
  hand) are offered with their own box, **unticked to start**, and go as Minor when ticked. Whether
  they go by default was Chris's call: they stay unticked (Chris, 2026-11-13).
- **Waived** findings go only when *Waived, for reference* is ticked, as reference rows (custom
  `reference: true`, `resolution: 'waived'`), counted nowhere, the way Fabcheck's do.
- Issue ids: `xpk` + a hash of the board id, check, and severity (`waived:` prefixed for reference
  rows). Fabcheck's are `xfc…`, so the two never meet.
- **Sections** of the Schematic Review checklist (`ee_design_review/templates/schematic.json`):

  | Pincheck checks | Section |
  | --- | --- |
  | `supply.range`, `supply.absmax`, `supply.unpowered`, `supply.tied` | `s-pwr` Power Architecture & Budget |
  | `supply.ground` | `s-gnd` Grounding |
  | `supply.switchnode`, `supply.rails`, `parts.regulator` | `s-reg` Regulators & Converters |
  | `parts.decoupling`, `parts.ext` | `s-dec` Decoupling & Bulk Capacitance |
  | `io.contention`, `pins.dnc`, `pins.unused` | `s-net` Connectivity & Net Integrity |
  | `pins.float`, `parts.crystal` | `s-clk` Clocks, Reset & Power Sequencing |
  | `io.absmax`, `io.recommended`, `io.vih`, `straps.i2c` | `s-dig` Digital Interfaces & High-Speed |
  | `func.*` | `s-mcu` Processor, MCU & FPGA |
  | `library.*`, anything else | `s-cmp` Component Selection, Ratings & Derating |

- `source` on each issue:

  ```json
  { "tool": "pincheck", "check": "supply.range", "gone": false,
    "run": { …run record… },
    "locations": [ { "finding": "supply.range:U4.4", "label": "U4 VDD at 5 V is above its 3.6 V maximum",
                     "refs": ["U4"], "nets": ["5V"] } ] }
  ```

## The stored run

### What reopening needs

To reopen a run, Pincheck needs the design as it was read, the part files it was checked against,
and the findings as sent (with their waived state):

- **The design**, parsed: its parts (pins, parameters), nets, and sheet drawings (for the Schematic
  tab and the scan panel). The parsed form survives JSON unchanged: on the demo and on a real Altium
  project, checking the JSON copy gives the same findings and rails as the original.
- **The part files used** (CubeMX-derived ones too: they may sit in a board's repo shared with a client or
  contractor, Chris 2026-11-13; never in a public repo): only those the design's parts matched, so the run is reproducible
  (same design, same part files, same Pincheck version → same findings) even after the library
  changes.
- **The findings** as sent, so links to a finding id always land.

### Footprint (measured 2026-11-13)

| Input | Parts / nets | Raw inputs | Inputs zipped | Parsed design, gzipped | Findings |
| --- | --- | --- | --- | --- | --- |
| Demo, Altium sheets + Protel2 | 39 / 32 | 112 KB | 14 KB | 12 KB | 7, < 1 KB |
| Demo, KiCad netlist | 39 / 32 | 36 KB | 4 KB | 3 KB | 7, < 1 KB |
| A real Altium project | 1,031 / 701 | 8.4 MB | 3.6 MB | 143 KB (61 KB without drawings) | < 2 KB gzipped |

The part files: `pincheck_data` holds 53 (801 KB raw, median 11 KB, largest 96 KB). A board using
30 of them is at most a few hundred KB raw and well under 100 KB gzipped.

Fabcheck stores per run a fab package zip (25 KB in the demo, typically 0.4–3 MB on real boards)
plus two board pictures (10–40 KB each). A Pincheck run stored as **the gzipped parsed design with
its part files** is about 250 KB on the largest real project tried, a tenth of what the raw sheets
would take, and smaller than a typical Fabcheck run. So Pincheck stores that, not the original
sheets.

### Layout

In the board's home repo (as Fabcheck's), under the data path when that's the data repo:

```
pincheck/<projectId>/runs/<runId>.json          { run, findings }
pincheck/<projectId>/designs/<key>.json.gz      gzip of { v: 1, design, library }
```

- `<key>` is the first 16 hex digits of the SHA-256 of the bundle's JSON, so re-sending the same
  design with the same part files uploads nothing new.
- One commit per Send holds the run file and the bundle. No `preview/` pictures (EE's header
  picture stays Fabcheck's).
- Sharing a board moves `pincheck/<id>/` with `fabcheck/<id>/` (the engine's `checkerDirs` and
  `moveChecker`).

### Run record

```json
{
  "id": "pk<base36 time><random>",
  "at": "2026-11-13T17:00:00.000Z",
  "by": "Chris Messick",
  "tool": { "name": "Pincheck", "version": "<build hash>" },
  "design": {
    "name": "Main PCBA (DT-1042 rev B)", "source": "altium", "netlist": "Protel2",
    "sheets": 4, "parts": 39, "nets": 32,
    "key": "<16 hex>", "path": "pincheck/<projectId>/designs/<key>.json.gz",
    "sha256": "<sha256 of the .json.gz bytes>", "size": 12345
  },
  "library": { "files": 2, "values": 40, "verified": 12 },
  "summary": { "error": 2, "warn": 3, "info": 2, "waived": 0 },
  "stored": { "repo": "chrismessick-dpd/review-ee-…", "dir": "pincheck/<projectId>/" }
}
```

`stored` is `null` for a run sent without storing.

## Open in Pincheck

EE's issue details show a *From Pincheck* card (the Fabcheck card's look): the design, when it ran
and who sent it, whether it's stored, *Open in Pincheck*, and each finding as a button. The link:

```
../pincheck/index.html[?demo]#/findings?run=<runId>&project=<projectId>&check=<check>&finding=<finding id>
```

1. EE reads `runs/<runId>.json` and its bundle with its own token, checks the bundle's SHA-256,
   and puts `{ id, tool: 'pincheck', run, findings, bundle: Uint8Array, at }` in `dovetail-handoff`.
   In the demo (no repo) it opens the link straight away.
2. Pincheck looks for the run among the runs it keeps (IndexedDB `pincheck-runs`, or
   `pincheck-runs-demo`), then takes the hand-off entry (and keeps it). It opens the design with the
   stored findings, not re-checked: a banner says it's a stored run and when it ran. *Run checks
   again* checks it against the library as it is now.
3. With `finding`, it shows that finding on the Schematic tab (or opens it in Findings when the
   design has no drawings); with only `check`, Findings filtered to that check.

## Not built, or open

- No list of stored runs in EE (no Revisions for Pincheck), and no board pictures.
- Pincheck doesn't read runs from a repo itself, as Fabcheck doesn't.
