# Pincheck checks

The checks run in the browser (`assets/checks.js`) on a design (`assets/design.js`) and the part
library (`assets/library.js`). They never call an LLM. This file is the contract with the rest of the
tool, the schematic viewer included.

## Running them

```js
const run = PK.checks.run(design, library);   // synchronous; a few hundred ms on a 1,000-part board
run.findings   // [finding], most severe first
run.rails      // [{ net, v, from, unverified }], the net voltages worked out
run.coverage   // { check key: { checked, skipped, findings } }, how much each check could check
run.parts      // { ref: { file id or null, why } }, which parts were checked against which file
```

## A finding

```js
{
  id: 'supply.range:U4.4',          // stable within a run: check key + where
  check: 'supply.range',            // a key in PK.checks.CATALOG
  group: 'Supply',                  // the catalog's group
  severity: 'error' | 'warn' | 'info',
  title: 'U4 VDD at 5 V is above its 3.6 V maximum',
  detail: 'Plain text: what was found, the numbers, and why it matters.',
  refs: ['U4'],                     // board designators involved (U19.2 for a channel copy)
  pins: ['U4.4'],                   // designator.pin
  nets: ['5V'],                     // net names involved
  basis: [                          // the part-file values the finding rests on
    { file: 'stm32g071kbu6', mpn: 'STM32G071KBU6', k: 'supply.range', on: 'VDD', page: 72, verified: true }
  ],
  unverified: false,                // true when it rests on a value no person has verified
}
```

**Unverified values only warn** (Chris, 2026-11-12): a finding that would be an error but rests on a
value without `ok` is a warning with `unverified: true`, and its detail names the values to verify.

**For the viewer:** `refs`, `pins`, and `nets` are what to frame and highlight. A channel copy's
schematic part is `design.parts.find(p => p.ref === ref).schRef` (`U19.2` → `U19`).

## Net voltages

Worked out before the checks, each with where it came from:

1. **Ground:** nets a ground pin is on, or named GND, VSS, AGND, PGND, and the like: 0 V.
2. **Regulator outputs:** a part file's `reg.vout` on its power-out pins, or on its FB pin when it has no output pin
   and no resistor from FB to ground (a fixed part like the TPS62231 senses its output there); or, for an adjustable
   part, `reg.vref` × (1 + Rtop/Rbottom) from the divider on its feedback pin, set on the net the top resistor goes to.
3. **Net names** that state a voltage ("3V3", "+5V", "VCC_1V8", "24V", and "V1.8MCU" or "V3.3IO": a V, a voltage with
   a decimal point, then any name), when nothing better sets one.
4. **Through parts that pass DC:** resistors of 1 Ω or less, ferrite beads, inductors, fuses, and load
   switches and eFuses (assumed on), from a net with a voltage to one without.

Signal nets get a **high level** from pull-up resistors to a known rail and from the output pins on them
(their domain's voltage).

## Logic levels between parts (2026-11-13)

Chris: a review missed an isolated CAN transceiver whose logic side ran on 5 V, talking through 22 Ω resistors to 3.3 V
MCUs. The checks are general: any input driven by another part's output.

- **Series resistors join a signal.** A two-pin resistor of known value up to **1 kΩ** (Chris) joins its two nets into
  one signal when neither end is ground or a rail (that's a pull), each end has a logic pin (an IC's I/O pin or a
  connector), and neither end has a resistor to ground less than 20 times its value (that's a divider, worked out by
  Thevenin as before). Up to two hops. Findings name the resistors ("through R12").
- **Thresholds on the receiver's own supply.** `io.vih` (`0.7*VCC1`) is evaluated with the receiver's domains, the
  driver's `io.voh` (`VDD-0.4`) with the driver's. Push-pull drivers set the level whatever pulls the net. A VOH or VOL
  that is a plain number holds for one test supply, so between parts on one rail only one that scales with the supply
  is used; across rails a plain number is used as written.
  - `io.vih`: the driver's guaranteed high below the input's VIH is an error; within 10% of the receiver's supply,
    a warning.
  - `io.vil`: the driver's VOL above the input's VIL.
- **`io.unpowered`: a driver on a rail that can be up while the receiver's isn't.** Each rail is traced to where it
  enters the board (a power input from the Connectors tab, a connector, up through regulators' highest input, load
  switches, and series parts). Two rails are independent when they come from different sources or a load switch sits
  between them, and not when one is made from the other. The receiver's limit with its supplies at 0 V is
  `io.absmax.off` when the file has it, else the pin's usual maximum evaluated at 0 V (an STM32 FT pin's `VDD+4.0` is
  4.0 V). An input the file calls fail-safe (`io.failsafe` naming it, or all) is fine. Independent rails: an error.
  Sources not found: a warning.
- **Parts not fitted leave the checks** (`fitted()`): an Altium variant's not-fitted list (`.PrjPcb` or
  `.PrjPcbVariants`, the project's current variant; `design.js` `parseVariants`), or the part's own DNP parameter or
  comment. Overview and Findings show the build variant being checked as `· <variant>` under a *Build variant* label, after the design's name on
  the title's line (on the line under it when narrow, so the scan panel keeps its room), with a picker of the
  project's variants (and *No variant*) when it has any; picking one marks its parts and checks again (Chris, 2026-11-13).
  The demo's project has two: Development fits everything, Production leaves the debug header J5 off.

The blind run that set this up, on the real board from git-ignored files: every one of the six transceiver channels
gave its TXD VIH failure and its RXD into an unpowered MCU, and the DNP alternate's false alarms went away.

## The catalog

`PK.checks.CATALOG` lists every check: key, group, title, and what it needs. The Findings filter comes
from it. There is no check matrix in Pincheck (Chris, 2026-11-13).

## Waivers

A finding can be waived, with a reason (Chris, 2026-11-13: a variant choice where only one of two parts is fitted,
an open pin that's fine on this board). One finding, or every finding like it: the same check and title once
channel suffixes are dropped (`U5.1` on `BUS_RX.1` is like `U5.2` on `BUS_RX.2`). Waivers are kept in the
browser per design name, as Fabcheck's are; waived findings leave the counts and show under Waived, where they
can be restored. Severities don't change for being waivable: an open VBAT is an error you waive if it's fine.

## How a few checks read the board (2026-11-13)

From a run on a real board whose false alarms these fixed:

- **A supply pin is on a rail** when its net, or one reached through an inductor, bead, fuse, or a series resistor up to
  1 kΩ (a 10 Ω filter on a gauge's BATT, the 1 kΩ to a MAX17335's PCKP), has a source. The resistor feeds the pin; its
  voltage isn't carried through (only 1 Ω or less is). A part counts as a connector when its part file's kind says so, even
  when its designator (JUSB1) made it look like an IC.
- **Capacitors past a 0 Ω link count** for decoupling, regulator input and output capacitance, and pin notes: a 1 Ω or
  smaller resistor makes one node. They're listed as "C1 (past R3)".
- **Pin notes (`ext`)** are read as written: a capacitance after ≤, <, "at most", "up to", or "max" is a limit on what the
  pin may see; an "Optional" part isn't required; "0.1 µF between CP and BATT" looks for a capacitor between those two
  pins; every inductance named counts ("1 µH or 2.2 µH", "22 µH to 47 µH").
- **An exposed pad** the file numbers PAD (or EP) takes the net of the symbol's pad pin (EP, EXP, PAD, THERMAL, and the like).
- **`supply.tied`** reads "VDDUSB to VDD (or VSS)" as VDDUSB and VDD; what follows "or" is a choice.
- **A range for when a feature is used** (`cond` "USB used") applies only when the feature is wired: a pin offering it is on
  a net named for it, or meets another part's pin named for it.
