# What the Claude scans taught the offline checks

The `pincheck-improve` skill's ledger (`docs/claude-scan.md`). One row per item Chris answered: what was built into
the offline checks, the catalog, or the part files, and what he turned down, so no scan proposes it again. In general
words only: the scans themselves, with the client's names, are in `pincheck_data`.

| Date | Scan | Rule | Outcome |
| --- | --- | --- | --- |
| 2026-11-13 | 20261113-2223 | A supply pin on a net with no source, which the part file ties to another domain: say "tie it to" that rail, and name a power port nothing else uses | `supply.unpowered` message; `nets.names` (a power port and another name on one wire) |
| 2026-11-13 | 20261113-2223 | A signal switch that starts open, with no MCU on its control lines | `func.switch`, catalog `sw.default` |
| 2026-11-13 | 20261113-2223 | An eFuse's overvoltage trip, from its OVLO divider and threshold range, above a protected load's recommended maximum | `supply.range` (OVLO) |
| 2026-11-13 | 20261113-2223 | A rail's voltage is a range over all its sources: a battery through a protector's FETs, and a programmable regulator's maximum | Rail ranges merged; `supply.range` (programmable maximum); battery as a power input |
| 2026-11-13 | 20261113-2223 | A charger fed from a regulator whose power-up default is below the charge voltage | `supply.charge` |
| 2026-11-13 | 20261113-2223 | Power entering on a connector into an eFuse or regulator with no clamp or capacitor, even with no power input set | `power.protection` |
| 2026-11-13 | 20261113-2223 | An eFuse's resistor-set current limit (with tolerance) above the input connector's contacts | `power.contacts`, catalog `sw.ilim.k` |
| 2026-11-13 | 20261113-2223 | A connector power input that isn't set up leaves the power checks idle | Part fix: a draft Connectors-tab file to confirm and import |
| 2026-11-13 | 20261113-2223 | An inductor's saturation current against the regulator's need or switch limit; a tiny chip inductor when unknown | `parts.regulator` |
| 2026-11-13 | 20261113-2223 | Bulk counted from capacitors drawn on another sheet | `parts.decoupling` (on another sheet; a warning for bulk of 4.7 µF or more) |
| 2026-11-13 | 20261113-2223 | Speaker, motor, and coil lines on one small contact; a linear regulator's input on too few contacts | `power.contacts` |
| 2026-11-13 | 20261113-2223 | A named signal reaching one connector pin and test points; a protection channel to nothing | `nets.dangling` (two connectors without the interface's other lines isn't checked) |
| 2026-11-13 | 20261113-2223 | An I2C bus with no pull-ups on the board, and the voltage window the far board's must use | `func.i2cpull`; I2C pins never drive high |
| 2026-11-13 | 20261113-2223 | A reset or enable nothing on the board holds: only a connector drives it, or only MCU pins with a pull that lets go | `pins.float` |
| 2026-11-13 | 20261113-2223 | An MCU held in reset by a buffer whose input is pulled up only to another board's rail | `io.unpowered` |
| 2026-11-13 | 20261113-2223 | A strap pin that becomes an output, tied straight to a rail | `straps.output` |
| 2026-11-13 | 20261113-2223 | The current a sense resistor lets a gauge or protector measure and protect at | `parts.sense` (a note), catalog `sense.vfs` |
| 2026-11-13 | 20261113-2223 | Value, Comment, and Description that disagree, a "?" value, a footprint size against the package, an IC Value naming another part | `parts.fields` |
| 2026-11-13 | 20261113-2223 | A regulator held off by its enable makes no rail, and its findings are notes | Held regulators; `parts.regulator` |
| 2026-11-13 | 20261113-2223 | A part file's thresholds for one supply band used at another | Part fix (VIH and VIL as expressions of the supply) |
| 2026-11-13 | 20261113-2223 | A three-pad 0 Ω jumper read as a crystal, and nets not passed through it | Links (`fitted`), `design.classify` |
| 2026-11-13 | 20261113-2223 | A driver's VOL, given at a test current, compared with a CMOS input that sinks nanoamps | `io.vil` (only when pull-ups sink a tenth of the test current) |
| 2026-11-13 | 20261113-2223 | No inductor saturation current in a regulator's file | The check falls back to the switch current limit (a datasheet giving only an equation isn't a value) |
| 2026-11-13 | 20261113-2223 | An output set by strap resistors, not worked out | Catalog `reg.vout.strap`, `strapPick`; part fix |
| 2026-11-13 | 20261113-2223 | A switch's power-up state only in free text | Catalog `sw.default`; part fix |
| 2026-11-13 | 20261113-2223 | Which pads of a connector are one contact | Pin field `contact`, `conn.contacts`. Later: the maker's catalog doesn't number the pads, so the part file waits for its drawing |
| 2026-11-13 | 20261113-2223 | A decoupling title saying none where smaller capacitors add up | `parts.decoupling` (real count and total; microfarad values made up in parallel) |
| 2026-11-13 | 20261113-2223 | Conditional bulk ("if the supply is far away") as a warning, and on a regulator held off | `parts.decoupling` (a note) |
| 2026-11-13 | 20261113-2223 | Pin names that are synonyms, a port with its use after it, or a datasheet's other name | `library.pins`, pin field `aliases` |
| 2026-11-13 | 20261113-2223 | An address strap tied straight to a rail, or set in memory with a default | `straps.i2c` |
| 2026-11-13 | 20261113-2223 | A rail that comes only through connectors and feeds loads | `supply.offboard` (a note) |
| 2026-11-13 | 20261113-2223 | Two pull resistors from one net to one rail | `nets.pulls` (a note) |
| 2026-11-13 | 20261113-2223 | A debug header with SWDIO and SWCLK but no reset (Chris: a warning) | `conn.mate` |
| 2026-11-13 | 20261113-2223 | An MCU pin pulled up from reset into a part on a switched rail | `io.unpowered` (a note) |
| 2026-11-13 | 20261113-2223 | Zero-volt charging enabled; the crystal drive level; a footprint named for another part; an option that fights a regulator's discharge; output capacitance behind an ideal diode; a divider idling mid-rail into a connector | Ideas: noted, no check (no reply asked for one) |
