---
name: pincheck-part
description: Make or fill a Pincheck part file (pincheck.part/1 JSON) for one part from its datasheet, with every parameter the datasheet gives, each with its page, all unverified. Use when Chris asks to extract a part's parameters, fill a part for Pincheck, run /pincheck-part, or turn a datasheet into a Pincheck file. Also handles STM32s from the local STM32CubeMX database.
---

# Pincheck part file from a datasheet

Pincheck (`C:/Dovetail/tools/pincheck`) checks schematics offline against a library of part files.
You are filling one part file so that its checks have data. **Be exhaustive and exact.** Find every
parameter the catalog has a key for that the datasheet states, cite its page, and never guess.

Arguments: a part number, a datasheet PDF path, and optionally a part file exported from Pincheck
(it holds the pins from the schematic symbol). If the PDF is missing, ask for it. Download a datasheet
only if Chris asks, and only from the manufacturer's own site.

**A batch file** from Pincheck's *Batch configure* (`pincheck-batch-<design>.json`) is a JSON array of exported
part files. Fill each entry as its own part, exactly as below, with that entry as its exported file, and write
each finished file as `<id>.json` in the folder the prompt names. Run the parts in subagents, a few at a
time, each given this skill's steps and its one entry. Report every part at the end, with any datasheet not found.

## Rules

- **Only the datasheet (and CubeMX for STM32s) is a source.** Don't fill values from memory. If the
  datasheet doesn't state something, leave the key out and list it under "Not in the datasheet".
- **Every value is unverified.** Set `"src": "llm"` and never write `ok`. A person ticks each one in
  Pincheck against the page.
- **Every value has `page`**: the PDF page number (1-based, as the PDF viewer shows it, not the printed
  page label if they differ; note the printed label in `note` if it helps).
- **Conditions go in `cond`**, short: `"Ta = 25 °C, VIN = 12 V"`, `"IOUT = 1 A"`, `"Suffix 6"`.
- **Units are the catalog's unit for that key**, with numbers unscaled: 100 nF is `1e-7` (unit F),
  48 MHz is `48000000` (Hz), 2.5 µA/V is `2.5e-6` (A/V), 125 °C is `125` (°C), 94 % is `94` (%).
  The unit string must equal the catalog's.
- **Limits written relative to a supply stay expressions** in a string: `"VDD+0.3"`, `"0.7*VDD"`,
  `"VSS-0.1"`. Use the file's domain names. A limit that is the smaller or larger of two uses
  `min(…, …)` or `max(…, …)`: `"min(VDD+0.4, 4.0)"`.
- **Ranges** use `min`, `typ`, `max` (any of them). Single numbers use `value`. Text uses `text`.
  Lists use `list` (an array of short strings).
- **Absolute maximum and recommended operating are different keys.** Never copy one into the other.
- **Per-domain keys** (`on: domain` in the catalog) need `"on": "<domain>"`, and the domain must be in
  the file's `domains`. Fill each domain the datasheet gives separately (VDD, VDDA, VDDIO2, VBAT…).
- **One row per key (and domain).** Pincheck shows only the first. When the datasheet gives several
  (supply current per mode, high-side and low-side current limits), put the one a check needs most in
  the value (the lowest quiescent current, the high side) and the rest in `note`. Pincheck shows notes
  under the parameter; keep the qualifiers that change the meaning in `cond`.
- **Thresholds:** `io.vih` is the lowest voltage always read high (a threshold's **max**), `io.vil` the
  highest always read low (a threshold's **min**). Ranges like `en.vih` take the table's min, typ, and
  max as they are. Rising and falling thresholds have their own keys (`reg.uvlo`, `reg.uvlo.fall`;
  `supply.por`, `supply.por.fall`).
- **Recommended, not effective:** where the catalog asks for effective capacitance or a range but the
  datasheet gives a nominal recommendation (Cin 2.2 µF, L 2.2 µH), fill it with `cond` starting
  `"Recommended nominal"`, and give a design-procedure table's range as the range.
- **A limit stated only as an equation or in words** ("Isat above ILmax") isn't a number: leave the
  key out and list it with the equation's page.
- **Fields:** `datasheet.url` only if the PDF prints it or Chris gave it; `made.by` is
  `"pincheck-part skill"`; `match` takes ordering variants the datasheet's ordering table shows with the
  same die and package (reel sizes like …DRYR and …DRYT), never other grades or packages; a pin's
  a pin whose own voltage limit differs from its domain's (I2C pins rated 1.98 V, a sense pin rated
  BATT+0.3 V) gets `vmax` (recommended maximum) and `absmax` (absolute maximum) on the pin, never an
  `x.` key, so the checks see it; `unused: "must"` means it must be driven or tied (no internal pull), `pull` means a resistor is
  recommended.
- **Other pin names** the datasheet gives (a slash-joined name like "SYNC/MODE", or a name per variant) go in the pin's
  `aliases` list, so a symbol using either matches. On a connector, pads that are one contact (a power contact's two solder
  tails) get the same `contact` value, but only when the maker's drawing numbers them; otherwise say so in the pin's note.
- **Keys the checks read since 2026-11-13** (from a Claude scan of a real board), filled whenever the datasheet states them:
  `reg.vout.strap` for an output set by strap resistors (one line per setting: `"SEL = high, CFG1 = 36.5 kΩ, CFG2 = 0 Ω |
  511 Ω: 3.3 V"`, every row of the table, read as page images); `reg.vout`'s `cond` saying "set by I2C" when the output is
  programmable, with `reg.vout.range`; `sw.ilim.k` (the k in ILIM = k / RILM); `sw.default` for a signal switch or mux (open
  or closed at power-up, and what closes it); `sense.vfs` for a gauge or protector (the sense voltage at full scale across
  CSP and CSN); and a charger's charge voltage range in `reg.vout.range`. I2C pins (SDA, SCL) are `open-drain` or `input`,
  never `io` or `output`.
- If a value depends on the ordering code (temperature grade, output voltage option), fill it for
  **this** part number and say so in `cond`.
- Keep American English and the serial comma in notes.

## Steps

1. **Read the catalog** for the part's kind, so you know every key you may fill:

   ```bash
   node C:/Dovetail/tools/pincheck/tools/part.js kinds
   node C:/Dovetail/tools/pincheck/tools/part.js catalog <kind>
   ```

   Kinds: mcu, regulator, switch, interface, analog, converter, logic, driver, memory, sensor, power,
   module, supervisor, crystal, protection, transistor, diode, connector, resistor, capacitor,
   inductor, ic, other. Read `C:/Dovetail/tools/pincheck/docs/part-format.md` for the file format.

2. **Start the file.**
   - If an exported file was given, start from it: keep its `id`, `mpn`, `match`, pins (numbers
     and names from the schematic), and any values a person already entered or verified (never
     change a value that has `ok`, or one with `src` "hand"). Values with `src` "schematic parameter" or
     "import:cubemx" came from a library or database, not the datasheet: where the datasheet differs,
     replace them (`src` "llm", with the page) and say what they were in `note`.
   - **STM32:** run the CubeMX importer first; it adds the pins, every alternate function with its AF
     number, EXTI lines, and the CubeMX supply range:

     ```bash
     python C:/Dovetail/tools/pincheck/tools/import_cubemx.py <MPN> [--merge <exported.json>] --out <out.json>
     ```

     Then continue from `<out.json>` with the datasheet for everything else.
   - Otherwise start from `{"schema": "pincheck.part/1", "id": "<mpn lowercased, non-alphanumerics to ->",
     "mpn": "<MPN>", "match": [], "manufacturer": "", "kind": "", "description": "", "package": "",
     "datasheet": {"title": "", "rev": "", "url": "", "sha256": ""}, "pins": [], "domains": [], "values": [],
     "made": {"by": "", "at": "<now, ISO>", "how": "llm (pincheck-part)"}, "updated": "<now>"}`.

3. **Map the datasheet.** Read its first pages and table of contents (`pdftotext -enc UTF-8 -f 1 -l 4
   -layout <pdf> -`, or the Read tool with `pages`, which takes one page or one range like `"5-7"`).
   Text extraction scrambles tables with merged cells (TI's specification tables, package addenda):
   **read every specification table as page images** with the Read tool, and use text only to find
   pages. The Bash tool's heredocs can fail on quotes; write helper scripts with the Write tool.
   Note the pages of what this kind has:
   - every part: pin configuration and functions, absolute maximum ratings, ESD ratings, recommended
     operating conditions, thermal information, electrical characteristics (all tables), and the
     ordering information or package addendum;
   - regulators and switches: the detailed design procedure and component selection (Cin, Cout, L);
   - MCUs and interface parts: I/O characteristics, reset and power control, clocks, timing, the
     address or strap tables, and the hardware or layout guidelines (required external parts);
   - analog parts: the input and output tables and the stability (capacitive load) section.
   Fill `datasheet.title`, `datasheet.rev` (document number and revision), and the SHA-256 of the PDF
   (`sha256sum <pdf>`).

4. **Pins.** From the pin table, for every pin of **this package**:
   - `num`, `name` (keep the schematic's name if the file came with pins; if they differ beyond
     formatting, keep both by putting the datasheet's in `note` and report it);
   - `role` (from `part.js kinds`): power-in, power-out, ground, io, input, output, open-drain, analog,
     clock-in, clock-out, reset, boot, enable, feedback, switch, bootstrap, power-good, bus (CAN, RS-485, RS-232, or USB data lines, which take the bus limits, not the domain's logic levels), nc, dnc, pad, other.
     A switching regulator's inductor pin (SW, LX, VLXSMPS, PH), on its own or inside an MCU, is `switch`, never
     `power-out`: the checks flag a switch node tied to a rail;
   - `domain`: which supply powers this I/O pin, or which domain a power pin belongs to;
   - `ft: true` only where the datasheet marks the pin 5 V tolerant (FT, TT…); never by guess;
   - `functions`: alternate functions, interface roles (`I2C SDA`, `UART TX`), EXTI, ADC channels;
   - `reset` (state during and after reset), `unused` (what to do with it when unused), and `ext` (an
     external part the datasheet requires on that pin, e.g. `"4.7 µF to GND, ESR < 1 Ω"`), when stated.
   Set `domains` to the supply groups.

5. **Values.** Go through the catalog for the kind, group by group, and for each key search the
   datasheet. Read every electrical table in full; most parts have more than one. Typical places:
   - Supply: recommended conditions (`supply.range`), absolute maximum (`supply.absmax`, `supply.absmin`),
     supply current (`supply.iq`, `supply.imax`), POR or UVLO (`supply.por`), sequencing and relations.
   - Decoupling (`dec.c`, `dec.bulk`, `dec.note`) and required parts: the application and layout sections.
   - I/O: VIH, VIL, VOH, VOL with their test currents in `cond`; absolute limits; per-pin and total
     current; injection current; internal pulls; pin capacitance; state at reset.
   - Clocks: oscillator ranges, gm critical per drive level (`clk.gm` as a list), pin capacitance.
   - Reset, boot, and straps: polarity, pulse width, internal pull, boot modes, I2C address table
     (`i2c.addr` as a list like `"ADDR = GND: 0x48"`), enable thresholds.
   - Regulator: input range and absolute maximum, Vout or Vref, current limit, dropout, frequency,
     UVLO, and the component ranges from "Detailed Design Procedure" (Cin, Cout and its ESR, L, Isat,
     bootstrap, soft-start).
   - Analog, interface, crystal, discrete, and passive keys as the catalog lists.
   - Environment: temperature range for this ordering code, junction maximum, θJA and θJC (from the
     thermal table, with the package and board in `cond`), ESD HBM, MSL, grade.
   A value the catalog has no key for but the checks would plausibly use may go in with a new key under
   a prefix `x.` (e.g. `x.vcap.esr`), with a `note`. Pincheck keeps it but doesn't check it.

6. **Check the file.**

   ```bash
   node C:/Dovetail/tools/pincheck/tools/part.js check <out.json> [--pins <exported.json>]
   node C:/Dovetail/tools/pincheck/tools/part.js summary <out.json>
   ```

   Fix every error. For each remaining catalog key that's missing, confirm it really isn't in the
   datasheet (search the text for its usual names before giving up).

7. **Write** `<id>.json` next to the input file (or where Chris said), and report:
   - counts: pins, values filled, keys checked and not found;
   - **"Not stated"**: keys that apply to this part but the datasheet doesn't give (or gives only as an
     equation or in words, with its page);
   - **"Not applicable"**: keys for features the part doesn't have (no PG pin, no straps), briefly;
   - **"Check these first"**: values you read from graphs, footnotes, or tables with merged cells, any
     conflicts between sections (say both pages), and pin names that differ from the schematic;
   - how to load it: Pincheck → the part → **Import JSON…**, check each value against its page, tick
     Verified, and Save.

Never write into `pincheck_data` or any repo yourself: the file goes into the library through Pincheck.

## Mate profiles and connector assignments (not part files)

When Chris asks for a **mate profile** (what a programmer, cable, or other board needs on each pin of a board
connector) or to say **which connector mates with what** on a design, write those instead of a part file. The formats
are in `docs/connectors.md`.

- A profile is `pincheck.mate/1`, from the maker's own document (user manual, pinout PDF), every pin with its page.
  State each pin **from the target's side**, the board being checked: `uart-tx` is where the target's TX goes (the
  tool receives). Decide direction from the document's direction or description column, never from a label like
  `T_VCP_RX` alone; when the document leaves it unclear, say so in the pin's `note`. Never set `ok`.
- An assignment file is `pincheck.connectors/1`, one per design (`design` is the name Pincheck shows). Suggest a
  connector's mate only from what the schematic shows (its part number, its nets' names, its pin count), and list your
  reasons to Chris; a power input's voltage and current come from Chris or the product's spec, not from a guess.
- Write them as JSON files beside the batch file (or where Chris says); Chris imports them from the Connectors tab.
  Pincheck does the checking; you never judge the pinout yourself.