# Pincheck design notes

Pincheck is the suite's schematic checker, Fabcheck's companion for the schematic. It checks a design
against what each part allows, offline, from a library of part files. Started 2026-11-12 (Chris).

## Decisions (Chris, 2026-11-12)

- **A new tool**, its own public repo `pincheck`, not linked from the other tools yet. The name is
  Pincheck: every pin checked against its part's parameters.
- **Offline first.** Schematics are read in the browser tab and never uploaded. An LLM is optional and
  only *makes* part files (the `pincheck-part` skill in Claude Code); checks never call one.
- **The part library is the asset**, like Fabcheck's fab profiles: parameter sets built up over time,
  checked by people, reused across projects. It lives in the private repo `pincheck_data` (the files
  hold only public datasheet facts, but which parts exist shows what clients use).
- **A value nobody has verified can only warn**, never fail.
- **Inputs:** Altium SchDoc and KiCad XML netlists, so both EDA packages work.
- Vendors to cover first: TI, ST, ADI, and the other mainstream ones.

## The flow

1. Drop the schematic sheets (or a KiCad netlist). Pincheck lists the parts, finds each one's part
   number (a part-number parameter, else Comment, else the library reference), and groups parts that
   share one.
2. It looks each IC and crystal up in the library (by `mpn` or a file's `match` patterns). Parts with a
   close part number get a "Close to … Use its file" offer.
3. **Configure** opens the part window with a new file made from the schematic: pins with guessed
   roles and domains, and any values the schematic's own parameters give (Altium vault parts often carry
   Min/Max Supply Voltage and temperature). Fill it by hand, or export it, run the `pincheck-part` skill
   on the datasheet, and import what it writes. People tick each value Verified against its page.
4. **Check** (next): see below.

## Inputs

- **KiCad XML** (`kicad-cli sch export netlist --format kicadxml`): parts with fields, each library
  part's pins (number, name, type), and nets whose nodes name the pin and its type. Complete.
- **Altium SchDoc**: a compound file; `assets/cfb.js` reads it and `assets/schdoc.js` reads the
  components, pins, designators, and parameters. Multi-part components appear on each sheet with all
  their pins and are merged by designator. Nets aren't derived from the sheets (that would mean wires,
  junctions, labels, ports, sheet entries, the project's net scope, and channels).
- **Altium Protel2 netlist** (Design › Netlist For Project › Protel2; chosen 2026-11-12 after trying
  Altium's exports on a real project): `assets/protel.js`. One block per part (designator, footprint,
  part type, description, then every parameter) and one per net, each pin as
  `<designator>-<pin> <part type>-<pin name> <electrical type>`. Designators are the board's, with
  repeated channels expanded (`C1.2` is channel 2 of C1), and nets are merged across sheets. Altium writes
  it in Windows-1252. It lists only pins on a net, so with the sheets dropped too, `design.build` takes the
  netlist's parts and fills in each one's pins on no net (`unconnected: true`) and parameters from its
  sheet part (`C1.2` → `C1`, or `C1_2` → `C1`). The older Protel format has no pin names and is refused
  with a pointer to Protel2. The EDIF export carries the same, but heavier.
- Altium vault parts put the part number in Comment, not a parameter (seen in two real projects); the
  library reference can be a hash. `design.identify` handles both.

## The parameter catalog

`assets/params.js`: 201 keys in groups (supply, digital I/O, clocks, reset and straps, interfaces,
regulator, switch, supervisor, analog, crystal, discrete, ratings, environment), each with a unit, a
shape (range, value, text, list), whether it's per supply domain, and the part kinds it's offered for.
The first set came from Chris's list (voltage, current, MCU alternate function) and the suite's
experience; the second from the audit of commercial checkers and review checklists in
`docs/research/checks-audit.md` (about 130 checks, the fields each needs). Pins carry role, domain,
5 V tolerance, functions, reset state, what to do when unused, and required external parts.

## Sources of part data

From `docs/research/part-data-sources.md`:

- **STM32**: STM32CubeMX's database (on Chris's machine) gives pins, every signal with its AF number,
  EXTI lines, and one supply range; `tools/import_cubemx.py` turns it into a part file. ST also
  publishes the same pin data as `STM32_open_pin_data` (BSD-3). Newer series (U3, U0, N6, …) have no
  supply range there. Absolute maximums, VIH/VIL, injection, decoupling, and oscillator gm come from
  the datasheet.
- **Microchip** device packs (Apache-2.0) give VCC and temperature per ordering code: a likely second
  importer.
- **TI and ADI**: no offline per-part data found; TI's datasheets use the same section names
  (Absolute Maximum Ratings, Recommended Operating Conditions, Electrical Characteristics), which the
  skill uses as its map.
- **IBIS** models carry VIH/VIL and voltage ranges, machine-readable, per part (a later importer).
- **Passives** need no file: their part numbers decode to value, tolerance, voltage, and dielectric
  (Murata GRM, KEMET, Vishay CRCW verified; others to check). No offline DC-bias data was found.

## Checks (built 2026-11-13; details in `docs/checks.md`)

In order, each needing only the netlist and part files:

1. **Net voltages**: from regulator outputs (fixed `reg.vout`, or `reg.vref` and the divider on the
   feedback pin), carried through 0 Ω, ferrite beads, inductors, and closed load switches; nets nothing
   drives get a value from the review (connectors, batteries).
2. **Supply pins**: each power-in pin's net within its domain's `supply.range` (fail above
   `supply.absmax`); power pins on nets with nothing driving them (say, only a capacitor); ground pins not on
   ground; `supply.tied` and `supply.rel`.
3. **I/O levels**: a pin on a net driven or pulled to more than its domain allows (`io.absmax`, or
   `io.ft.absmax` for `ft` pins); VOH/VIH across domains.
4. **Pin functions**: net names that say an interface (SDA, SCL, TX, RX, MOSI, …) on a pin with no such
   function; two interrupt nets on one EXTI line.
5. **Required parts**: `dec.c`, `dec.bulk`, and pins' `ext` (VCAP, VDDA) found on the net; regulator
   `reg.cout`, `reg.l`, and `reg.l.isat` against the parts fitted (with passives decoded from their part
   numbers).
6. **Straps**: I2C addresses from `i2c.addr` and the strap pin's net, duplicates on one bus; boot pins.

Every finding names the part file's value and page, and warns instead of failing when that value is
unverified. Planted errors for the demo come with the checks.

## The schematic viewer (2026-11-13)

Chris asked for a viewer like Fabcheck's Board that jumps to the findings on the schematic.

- **Reading.** `PK.schdoc.graphics` reads what each sheet draws, in Altium's units (10 mil, `_FRAC` in
  1/100000, Y up, a key left out means 0). That covers the sheet size (`SHEETSTYLE`, or the custom size, grown
  to what's drawn), component graphics, pins, designators, visible parameters, wires, buses, junctions, net
  labels, power ports, ports, sheet symbols and entries, text frames, notes, and No ERC marks. Only the placed
  unit (`OWNERPARTID` is the component's `CURRENTPARTID`, or -1) and its display mode are drawn.
  `PINCONGLOMERATE`'s low two bits turn a pin, 0x04 hides it, 0x08 shows its name, and 0x10 its number. The
  connection end is `LOCATION + PINLENGTH`. On a real project, 95% of visible pins land on a wire, label,
  port, or other pin, and the rest are open in the drawing. Title block texts (`=Title`) come from the
  document's parameters. Images and harnesses aren't drawn.
- **Connections.** `PK.schdoc.connect` groups wires per sheet: shared ends, an end on another wire (a T),
  and junctions join; crossings don't. Pins, labels, ports, and power ports join the wire they sit on. A
  group's net is the netlist's net of a pin on it (channel sheets list one net per channel), or else its
  labels. Hovering a pin or wire names it.
- **Findings.** A finding's `refs`, `pins`, and `nets` map to each sheet (channel copies through
  `schRef`). The sheet with most of its pins opens, framed on its pins (or its parts, or its nets), with
  its nets glowing and its parts boxed. Every finding with a place on the sheet has a mark: errors are a
  striped circle with ✕, warnings a dotted triangle, and notes a circle with i. The rail lists the sheet's
  findings with Prev and Next (N and P keys), and links to the other sheets it's on. F fits the sheet.
- **Checked on a real project** (2026-11-13, local only): an Altium project of 18 sheets with its Protel2
  netlist, 1,031 parts of which 810 are channel copies. All 1,194 drawn pins on a net sit on wired groups, no
  group mixes two nets, and a finding made for each of the 3,067 netlist pins (2,409 on channel copies) opens
  on a drawn pin carrying that net.
- **Drawing.** A canvas with one `Path2D` per style, text culled below 3.5 px. A 586-pin sheet paints in
  under 7 ms. Colors come from the suite's tokens, not the file's.
- **KiCad XML** carries no drawing, and the tab says so. A Protel2 netlist alone asks for the sheets.
- **The demo** is the thermostat's Main PCBA as three Altium sheets and their Protel2 netlist
  (`tools/make_demo_altium.py` lays them out, `tools/schdoc_write.py` writes the compound files, readable by
  Pincheck but untested in Altium), from the same parts and nets as the KiCad netlist. Both demos give the same
  findings (a test).

## The scan panel (2026-11-13)

Chris asked for Fabcheck's inspection stage for schematics: a live picture of what's being checked. It was
designed in `lab/scan-panel.html`, where three directions were tried: a sheet gallery, a sheet stack, and a
part close-up. Chris chose the gallery and shaped it over five rounds. `assets/scan.js` and the *scan panel*
section of `assets/styles.css` build it.

- **Where:** at the top of a design's Overview, as Fabcheck's stage. While it plays, the totals show "–"
  and Findings' tab count waits, as Fabcheck's do.
- **What:** every sheet as a thumbnail, drawn from `design.drawings` without text. The thumbnails sit in
  equal columns at least 208 px wide that fill the space left of the words, with a short last row
  centered. Card widths come from the panel's width alone, so they never move during a run.
- **While it runs:**
  - Each check reads every sheet it touches at once (a lane per sheet). Dots pop in and fade over the pins
    it reads.
  - What has been read stays as small solid dots.
  - A sheet being read pulses its outline and shows a ● by its number. With reduced motion, the pulse is a
    steady ring.
  - Findings land as marks: ✕ in a striped square, ▲ dotted, and i in a ring. A click on one opens it on
    the Schematic tab (`data-show`).
  - The words on the right say which check is running and which part it's reading.
- **The bar:** Fabcheck's, with each check's start ticked and checks that found something hatched. A click
  while it plays skips to the end.
- **Replaying one check:** once the run is done, the bar is a slider of the 25 checks.
  - Press and slide, or use the arrow keys, Home, and End.
  - The picked check plays again in a loop, its findings listed on the right.
  - Escape, or *Back to all results*, returns to the finished run.
- **When it plays:** when a design opens, and on *Run checks again* (`d.scanPlay`). It doesn't play on a
  library change; the panel is rebuilt finished.
- **Only with sheets:** a netlist alone (KiCad, or Protel2 without the .SchDoc files) gets no panel, as
  Fabcheck shows no stage without a board (Chris).
- **The start page:** an empty panel is the drop target. Click it, press Enter, or drop files anywhere.
- **A replay, about 8 s (Chris):** the checks finish in milliseconds, so the panel plays the finished run.
  Each check gets a share of the 8 s by how much it reads, and a busy sheet groups its parts so it has at
  most 8 beats per check.
- **Guessed, not traced:** what each check reads is worked out in `scan.js` (`plan`, `TARGETS`) from pin
  roles, part kinds, net names, and `run.coverage`. Only the findings' places are exact (their `pins`,
  `refs`, and `nets`). Next step: have `checks.js` record the pins and parts at its `tick()` calls behind
  an option, and draw those instead.

## Not built yet

- Nets derived from SchDoc files without a netlist (not planned while Protel2 works).
- A zip or folder drop (the project zip Chris sent; JSZip, as Partcheck loads it).
- Microchip and IBIS importers; passive part-number decoding.
- Sharing findings with Signoff EE, the way Fabcheck sends a run.
