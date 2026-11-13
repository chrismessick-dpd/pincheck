# Check with Claude, and self-improve

Chris, 2026-11-13: beside the offline check, a whole project can be handed to Claude, as a part can be filled by
hand or by Claude. Claude runs the offline checks as its baseline, reviews the schematic itself, notes whatever the
offline checks missed or got wrong, and fills the parts the library lacks. A second skill then turns what Chris
confirms into offline checks, so the offline check keeps growing. The offline check stays the fast one: it reruns
in under a second with no connection, and it never calls an LLM.

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| `tools/scan.js` | this repo | The offline checks headless on a project folder or .zip, the parsed design as text for Claude, and scans to and from `pincheck_data` |
| `pincheck-scan` skill | `skill/scan/SKILL.md` → `../.claude/skills/pincheck-scan/` | Claude's review of a whole project, written as a scan |
| *Check with Claude…* | Pincheck's Findings page | Writes the prompt, then shows a stored scan's items beside the offline findings, each with Confirm, Not a problem, and a reply, and Accept all |
| `pincheck-improve` skill | `skill/improve/SKILL.md` → `../.claude/skills/pincheck-improve/` | Builds what Chris confirmed into the offline checks, the catalog, or the part files, and records what it did |
| `docs/learned.md` | this repo | The ledger: every rule self-improve added, and every idea Chris turned down, in general words, so no scan proposes it again |

## Decisions (Chris, 2026-11-13)

- **A scan is pointed at the project folder** (or its .zip), with the Protel2 netlist in it.
- **Scans are kept in `pincheck_data`**, `scans/<design slug>/<scan id>/`, since they name the client's parts and nets.
  Stored at Chris's OK after a dry run, new files only, read back.
- **Chris confirms first.** Self-improve builds only the items Chris confirmed in Pincheck (one by one, or Accept
  all), and stops at a reviewed diff; Chris says when to commit.
- **The button is in Pincheck now**, with the review list there (not in the terminal).
- **Missing parts:** the scan downloads each missing datasheet from the maker's own site into
  `C:\Dovetail\datasheets`, fills it with the `pincheck-part` skill, and stores the part files with the scan, for
  Chris to import from the scan in Pincheck.

## A scan

`scans/<design slug>/<scan id>/` in `pincheck_data`, where the id is the scan's UTC time, `YYYYMMDD-HHMM`:

| File | Written by | What |
| --- | --- | --- |
| `project.json` | `scan.js run` | The project's files (path, size, SHA-256), netlist kind, variant, and where it was on Chris's computer |
| `offline.json` | `scan.js run` | The offline run the scan compared with: Pincheck's version, the library's head, every finding, the rails, and coverage |
| `scan.json` | Claude | `pincheck.scan/1`, below |
| `parts/<id>.json` | Claude (`pincheck-part`) | Part files filled for this scan, unverified, for import |
| `decisions.json` | Pincheck | `pincheck.scan-decisions/1`: Chris's answer to each item |
| `improved.json` | `scan.js record` | `pincheck.scan-improved/1`: what self-improve did with each confirmed item |

The offline run in `offline.json` is the one made **after** the scan's new part files were added (`scan.js run
--extra parts/`), so the comparison is between checks, not between libraries.

### `scan.json` (`pincheck.scan/1`)

```json
{
  "schema": "pincheck.scan/1",
  "id": "20261113-2215",
  "design": "Demo_Board",
  "at": "2026-11-13T22:15:00Z",
  "by": "pincheck-scan skill",
  "model": "claude-opus-5-5",
  "reviewed": [
    { "area": "Power: the 12 V input and U2's buck", "sheets": ["Power.SchDoc"], "checked": ["Cin and Cout against the datasheet", "EN and PG wiring", "…"] }
  ],
  "agrees": ["supply.range:U1.4"],
  "items": [
    {
      "id": "c1",
      "type": "missed",
      "severity": "error",
      "title": "C12 is rated 10 V on the 12 V input",
      "detail": "Plain text: what, the numbers, and why it matters.",
      "refs": ["C12"], "pins": ["C12.1"], "nets": ["+12V"],
      "evidence": [{ "says": "C12's Voltage parameter is 10V; +12V comes from J1, a 12 V input" }],
      "rule": "A capacitor's voltage rating (from its parameters) at least the rail's voltage, with derating",
      "ee": "sc2",
      "confidence": "high"
    }
  ],
  "parts": { "filled": ["tps562201ddcr"], "notFound": [{ "mpn": "ABC123", "why": "no datasheet on the maker's site" }] },
  "notCheckable": ["Title blocks (the netlist has none)", "…"]
}
```

Item types:

- **`missed`**: a real problem no offline check looks for. Needs `rule`, the general rule an offline check would
  follow. `check` names the nearest existing check, if any.
- **`data`**: an offline check exists (`check`) but didn't fire because the part data was missing or wrong. `needs`
  says what (the key, or the pin field). The fix is the part file (or a catalog key), not the checks.
- **`false-alarm`**: an offline finding (`offline`, its id) that Claude believes is wrong. Needs `rule`, what the check
  should do instead.
- **`idea`**: something worth a look that Claude can't confirm from the schematic, or a judgment call. Never becomes a
  check unless Chris says so in his reply.

`agrees` lists the offline findings Claude checked and agrees with. `ee` is the matching item of Signoff EE's
Schematic Review checklist, when there is one. `scan.js check <dir>` validates all of it against the design.

### `decisions.json` (`pincheck.scan-decisions/1`)

```json
{ "schema": "pincheck.scan-decisions/1", "scan": "20261113-2215", "design": "Demo_Board", "updated": "…",
  "items": { "c1": { "state": "confirmed", "reply": "Yes, and also for CC pins", "by": "Chris Messick", "at": "…" } } }
```

`state` is `confirmed` or `rejected`. An item with no entry hasn't been answered. Accept all confirms every
unanswered item. Pincheck writes this file to the scan's folder when Chris saves; it's the only file in a scan
that changes.

### `improved.json` (`pincheck.scan-improved/1`)

```json
{ "schema": "pincheck.scan-improved/1", "scan": "20261113-2215", "at": "…",
  "items": { "c1": { "outcome": "check", "what": "parts.vrating: capacitor voltage ratings against their rails", "commit": "pincheck abc1234" } } }
```

`outcome` is `check` (a new or changed offline check), `catalog` (a new catalog key, and the `pincheck-part` skill
told), `part` (part files fixed, for import), `ledger` (turned down, noted in `docs/learned.md`), or `later` (left for
Chris, with why).

## Client data

The scan holds the client's names; this repo never does. A rule self-improve adds is written in general words, its
test board is made up (in `tests/test.js` or the demo), and the client terms from `../CLAUDE.md` and the scanned
project's own net names, part numbers, and designators are grepped for before Chris sees the diff.
