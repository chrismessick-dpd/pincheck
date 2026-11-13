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

## Not built yet

- Nets derived from SchDoc files without a netlist (not planned while Protel2 works).
- The schematic viewer (a separate session Chris started paused, 2026-11-13).
- A zip or folder drop (the project zip Chris sent; JSZip, as Partcheck loads it).
- Microchip and IBIS importers; passive part-number decoding.
- Sharing findings with Signoff EE, the way Fabcheck sends a run.
