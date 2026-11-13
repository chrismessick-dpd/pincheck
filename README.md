# Pincheck

A schematic checker for the Dovetail Signoff suite: Fabcheck's companion for the schematic. It
checks a design against what each part allows (supply ranges, I/O levels, pin functions, required
external parts, straps) from a library of part files, offline. Prototype, started 2026-11-12.

Hosted at https://chrismessick-dpd.github.io/pincheck/ (once Pages is on). `?demo` opens the made-up
Smart Thermostat's Main PCBA with a small library.

## Use

1. Drop the schematic: every `.SchDoc` of an Altium project with its Protel2 netlist (Design › Netlist
   For Project › Protel2) for the nets, and its `.PrjPcb` for the name; or a KiCad XML netlist (`kicad-cli sch export netlist --format kicadxml`). It's read in the tab and never
   uploaded.
2. Pincheck lists the ICs and crystals and says which are in the part library.
3. **Configure** a part that isn't: its pins come from the schematic symbol, with guessed roles and
   supply domains. Fill the parameters by hand, or with Claude (below), then tick each value Verified
   against its datasheet page.
4. Signed in to GitHub (the suite's sign-in), the library syncs with the private `pincheck_data` repo.
5. Overview and Findings list what the checks found: supply pins against their ranges, I/O levels across
   domains, pins that must be connected, interface nets on the right pin functions, required capacitors,
   crystal load, and I2C addresses. A finding that rests on a value nobody verified is only a warning.
   How the checks work: `docs/checks.md`.

## Part files

The format is in `docs/part-format.md`; the parameters a file may hold are the catalog in
`assets/params.js`:

```bash
node tools/part.js catalog regulator
node tools/part.js check my-part.json --pins exported-from-pincheck.json
```

**With Claude:** in Claude Code started in the Dovetail tools folder, `/pincheck-part <MPN> <datasheet.pdf>`
(the skill is `skill/SKILL.md`, installed in `../.claude/skills/pincheck-part/`). It fills every parameter
the datasheet gives, each with its page, all unverified. Import the file in the part window.

**STM32s** from STM32CubeMX's database on this computer (pins, alternate functions, EXTI lines):

```bash
python tools/import_cubemx.py STM32G071KBU6 --out stm32g071kbu6.json
```

## Files

| File | What |
|---|---|
| `index.html`, `assets/app.js` | The page |
| `assets/cfb.js`, `assets/schdoc.js` | Altium SchDoc reading (compound file, records) |
| `assets/kicad.js` | KiCad XML netlist reading |
| `assets/design.js` | One design from the dropped files: parts, part numbers, kinds |
| `assets/params.js` | The parameter catalog, pin roles, units |
| `assets/library.js` | Part files: making one from the schematic, matching, IndexedDB, sync with `pincheck_data` |
| `assets/editor.js` | The part window |
| `tools/part.js` | Catalog, check, and summary from the command line |
| `tools/import_cubemx.py` | STM32 part files from STM32CubeMX |
| `tools/make_demo.py` | The demo netlist and library |
| `docs/research/` | The audit of schematic checks and of part data sources (2026-11-12) |
