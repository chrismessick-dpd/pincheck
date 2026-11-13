---
name: pincheck-improve
description: Make Pincheck's offline checks catch what a Claude scan found. Reads a stored scan (pincheck.scan/1) and Chris's answers to it from pincheck_data, then turns each confirmed item into a general offline check, a fix to a check, a catalog key, or a part-file fix, with made-up tests, proves the scanned project now gets the finding offline, records turned-down ideas in the ledger, and stops at a diff for Chris. Use when Chris asks to self-improve Pincheck, improve the offline checks from a scan, or run /pincheck-improve on a scan.
---

# Self-improve Pincheck from a Claude scan

The `pincheck-scan` skill writes down what Pincheck's offline checks missed, got wrong, or lacked data for, and
Chris answers each item in Pincheck (Findings › *Claude's scan*). You build what he confirmed, so the offline check
(fast, no connection, never an LLM) catches it next time. Read first:
`C:/Dovetail/tools/pincheck/CLAUDE.md`, `docs/claude-scan.md` (the scan format), `docs/checks.md` (how the checks
read a board), `docs/learned.md` (what was built or turned down before), and `C:/Dovetail/tools/CLAUDE.md`'s hard
rules.

Arguments: a scan, as `<design>/<scan id>`, or "the latest scan of <design>".

## Rules

- **Only what Chris confirmed.** An unanswered item waits. A turned-down item goes in the ledger, never in code. An
  `idea` becomes a check only when Chris's reply asks for one. His reply on any item overrides the scan's wording.
- **The repo is public; the scan is the client's.** Every rule is written in general words (no net names, part
  numbers, designators, or project names from the scan). Tests use made-up boards built in `tests/test.js` (as its
  other tests do) or the demo. Docs say "a real board" as `docs/checks.md` already does. Before showing Chris the
  diff, grep it for the suite's client terms (`etna|koya|1100200|1100201`) **and** for the scan's own part numbers,
  net names, and the project's name. Nothing may match.
- **Pincheck's own rules hold:** checks never call an LLM; a failure resting on an unverified value is a warning
  (`unverified: true`); new catalog keys go in `assets/params.js` with a unit and shape, and the `pincheck-part`
  skill (`skill/SKILL.md`, then copied to `../.claude/skills/pincheck-part/`) learns to fill them; severities are
  never shown by hue alone; American English, metric, and the serial comma.
- **Prefer the general fix.** Extend an existing check before adding one; a check that fires on this board alone is
  wrong. Think about the false alarms a rule would raise on other boards, and guard against them.
- **Never commit or push without Chris's go-ahead**, and only your own hunks: `git status` first, since other
  sessions often have uncommitted work in Pincheck. Part files are never written into `pincheck_data` by you except
  at Chris's OK.

## Steps

1. **Get the scan and the answers.**

   ```bash
   cd C:/Dovetail/tools/pincheck
   node tools/scan.js list "<design>"
   node tools/scan.js pull "<design>/<scan id>" --out "C:/Dovetail/scratch/pincheck-improve/<design slug>-<scan id>"
   node tools/scan.js library
   ```

   No `decisions.json`: stop and tell Chris to answer the items in Pincheck first. If `improved.json` is there,
   skip the items it already handled.

2. **Sort the confirmed items** into what each needs, and show Chris the list before building if any item's fix is
   unclear or would change how an existing check behaves on every board:
   - **`data`**: the part file is missing a value or has it wrong. Fix it from the datasheet with the `pincheck-part`
     skill's rules (the datasheet page, `src: "llm"`, never `ok`). Write the fixed file to `<work>/parts-fixed/` for
     Chris to import (Pincheck › Import JSON). If the catalog has no key for it, add one (`catalog` outcome).
     Then ask: should the check have warned that the value was missing? If so, that's also a check change.
   - **`missed`**: a new or wider offline check, from the item's `rule` and Chris's reply.
   - **`false-alarm`**: change the check so it doesn't fire there, keeping every case it rightly catches.
   - **`idea`** with a reply asking for a check: as `missed`.

3. **Build each one:**
   - the code in `assets/checks.js` (a `CATALOG` entry for a new check, with its group, title, and `needs`), or
     `assets/params.js` for a catalog key;
   - a test in `tests/test.js` on a made-up design that fails before your change and passes after; for a false
     alarm, also one that shows the check still fires where it should;
   - a short general section in `docs/checks.md`, and the demo (`tools/make_demo.py`, `tools/make_demo_altium.py`)
     only if the check should show there.

4. **Prove it.**
   - `python tools/stamp_version.py`, then the test page (`pincheck/tests/test.html` served from the tools folder,
     preview `signoff-suite-alt` or `signoff-suite`): PASS, with the new count.
   - Run the scanned project again (its folder is `project.json`'s `path`; add `--extra <work>/parts` and
     `--extra`-style fixed parts as needed):

     ```bash
     node tools/scan.js run "<project path>" --out "<work>/after" [--variant "<variant>"] [--extra "<work>/parts-fixed"]
     ```

     Every confirmed `missed` item now has an offline finding on its parts or pins; every confirmed `false-alarm`
     finding is gone. Compare `<work>/after/offline.json` with the scan's `offline.json` and explain **every** other
     finding that appeared or went away.
   - Every other scan in `pincheck_data` whose project folder is still on this computer: run it again the same way
     and compare with its `offline.json`. Nothing may change that you can't explain.
   - The client-data grep over `git diff` (rules above).

5. **Update the ledger**, `docs/learned.md`: one row per item, in general words: the date, the rule, the outcome
   (the check key added or changed, the catalog key, a part-file fix, or *Turned down* with Chris's reason), and the
   scan as `<scan id>` only (no design name).

6. **Show Chris and stop:** for each item, what you did (or why not); the test count; what the scanned project's
   offline run finds now that it didn't, and what it no longer finds; anything that changed on earlier scans; and
   `git diff --stat`. Wait for his go-ahead.

7. **On his go-ahead:** commit your hunks in `pincheck` (end the message with the session's Co-Authored-By line),
   and push only if he says so. Then write `<work>/improved.json` (`pincheck.scan-improved/1`: `scan`, `at`, and
   per item `outcome` of `check`, `catalog`, `part`, `ledger`, or `later`, with `what` and the `commit`), and store it:

   ```bash
   node tools/scan.js record "<work>" --improved "<work>/improved.json" --dry-run
   ```

   Show Chris the dry run, then run it with `--confirm <code>`. Remind him to import `<work>/parts-fixed/` in
   Pincheck if there are part fixes.
