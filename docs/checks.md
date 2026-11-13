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
2. **Regulator outputs:** a part file's `reg.vout`; or, for an adjustable part, `reg.vref` × (1 + Rtop/Rbottom)
   from the divider on its feedback pin, set on the net the top resistor goes to.
3. **Net names** that state a voltage ("3V3", "+5V", "VCC_1V8", "24V"), when nothing better sets one.
4. **Through parts that pass DC:** resistors of 1 Ω or less, ferrite beads, inductors, fuses, and load
   switches and eFuses (assumed on), from a net with a voltage to one without.

Signal nets get a **high level** from pull-up resistors to a known rail and from the output pins on them
(their domain's voltage).

## The catalog

`PK.checks.CATALOG` lists every check: key, group, title, and what it needs. The Findings filter comes
from it. There is no check matrix in Pincheck (Chris, 2026-11-13).
