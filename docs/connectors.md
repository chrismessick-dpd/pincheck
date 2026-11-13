# Connectors: what mates with them, and power inputs

Chris, 2026-11-13: a board had its UART on the programming connector, but not on the pins an ST-LINK's virtual COM
port uses. `func.af` passed it, because it reads net names: `UART_TX` on a real USART TX pin is fine by name, wherever
it lands on the header. Pincheck now lets you say what mates with each connector, per design, and checks the pins against
it. The same goes for power inputs, which carry a voltage and a current.

Decisions (Chris, 2026-11-13):

- **An LLM makes mate profiles and may suggest which connector is which; the comparison is a normal check.** Checks
  never call an LLM.
- **Assignments are kept per design in `pincheck_data`** (synced like the part library) and travel in the run bundle sent
  to Signoff EE.
- **First profiles:** ST STDC14 (STLINK-V3), Arm's 10-pin Cortex debug connector, Tag-Connect TC2030 and TC2050, and an
  FTDI TTL-232R cable.
- **A wrongly wired pin is an error** while its profile is verified, and a warning while it isn't (as for part files).
- **Power inputs** set their rail's voltage (a range), check the contacts' current rating, note missing protection
  (fuse, TVS, reverse polarity) before the first load, and check the ratings of the parts in the path. FETs, fuses, and
  inductors in a power path may need part files; Parts and Batch configure include them.

## The Connectors tab

Every connector of the design (a J, P, CN, or X designator, or a part file of kind `connector`) with a *Mates with*
choice: a mate profile, or *Power input…*. A connector nobody has set, whose nets are named for a profile's signals,
gets a *Looks like …* offer. A set connector shows the profile's pins, the net each is on, and its result; a power input
shows its pins, voltage, and current. Findings land under the Connectors group.

## Mate profiles (`pincheck.mate/1`)

What a programmer, cable, or other board needs on each pin of the board's connector, stated **from the target's side**:
the board being checked. Debugger labels such as `T_VCP_RX` read either way; the profile's `expect` says which.

```json
{
  "schema": "pincheck.mate/1",
  "id": "st-stdc14",
  "name": "ST STDC14 (STLINK-V3)",
  "kind": "debug",
  "mates": "The STLINK-V3's 14-pin flat cable, on a 2×7 1.27 mm header on the board",
  "connector": "2×7, 1.27 mm pitch, keyed",
  "numbering": "Odd pins in one row, even in the other; pin 1 at the key",
  "source": { "title": "…", "doc": "UM2448", "rev": "…", "url": "https://…", "page": 0 },
  "pins": [
    { "num": "3", "signal": "T_VCC", "expect": "vref", "required": true, "page": 0 },
    { "num": "4", "signal": "T_SWDIO", "expect": ["swdio", "tms"], "required": true }
  ],
  "status": "imported",
  "ok": { "by": "@someone", "at": "…" },
  "made": { "by": "…", "at": "…", "how": "…" }
}
```

(The pin rows above show the shape; the real tables are in `interfaces/`.)

| `expect` | The target puts here | Checked |
|---|---|---|
| `gnd` | Ground | the net is ground |
| `vref` | Its I/O supply, which the tool senses to set its levels | a rail, at the voltage of the MCU it talks to (a warning when not) |
| `power-in` | Nothing: the tool supplies power (`v` volts) | not ground, and not a rail at another voltage |
| `swdio`, `swclk`, `swo`, `nrst`, `tdi`, `tdo`, `tms`, `tck`, `ntrst` | That debug signal | the MCU pin reached offers it |
| `uart-tx`, `uart-rx` | The target's TX (the tool receives) or RX | the MCU pin offers USART*n*_TX or _RX; TX and RX on one peripheral |
| `uart-rts`, `uart-cts` | The target's RTS or CTS | as above |
| `nc` | Nothing | left open (a warning when not) |
| `key`, `other` | (no pin, or not checked) | — |

`expect` may be a list of alternatives (`["swdio", "tms"]`). `required: true` makes an unconnected pin an error;
otherwise an open pin is fine (an unused VCP, SWO), except reset, which is a note.

**How a pin is followed:** from the connector pin's net across series resistors up to 1 kΩ, ferrite beads, and inductors
(never into ground or a rail), to the parts it reaches. An MCU pin with alternate functions is checked; anything else (a
buffer, a level shifter, an IC without a part file) is reported as not checked, never as passing. A wrong pin names what
it is instead and, when that's another pin of the profile, says the two are likely swapped. A profile pin the connector's
symbol doesn't have is an error that points at the header's numbering (odd/even rows against a footprint numbered
along each row).

**Where they live:** the standard profiles ship in this repo's `interfaces/` (listed in `interfaces/index.json`) and are
loaded into the browser's store when missing; an unedited one is replaced when a newer one ships. Others, and any that
someone edits or verifies, sync with `pincheck_data/interfaces/<id>.json`. A profile is verified as a whole (`ok`), from
the Connectors tab, after checking every pin against its source page.

## A design's connectors (`pincheck.connectors/1`)

One file per design, named by the design's name as waivers are: `pincheck_data/designs/<slug>.json`.

```json
{
  "schema": "pincheck.connectors/1",
  "id": "main-pcba-dt-1042-rev-b",
  "design": "Main PCBA (DT-1042 rev B)",
  "connectors": [
    { "ref": "J5", "mate": "st-stdc14", "by": "@someone", "at": "…" },
    { "ref": "J3", "power": { "pins": ["A4", "B4"], "return": ["A1", "B1"], "v": { "min": 4.75, "typ": 5, "max": 5.5 }, "i": 1.5 }, "by": "…", "at": "…" }
  ],
  "updated": "…"
}
```

Volts and amps. Import accepts either schema (a file or a list), from the Connectors tab or the Library page.

## The checks (`assets/checks.js`, group Connectors)

| Key | What |
|---|---|
| `conn.mate` | Each profile pin against the target, as above. |
| `power.input` | Supply pins on one net and not ground; return pins on ground (or through an N-FET to it). |
| `power.contacts` | The current against the connector's `rate.i` per contact, times the contacts in parallel (the fewer of supply and return). A note above 50% (ECSS and NASA derating). |
| `power.protection` | A note naming what's missing before the first load: a fuse (F designator, fuse or PTC text, an eFuse), a TVS (TVS, varistor, or a part file with `tvs.vrwm`), and reverse-polarity protection (a series diode or FET, an ideal-diode part, an N-FET in the return, or a shunt diode). |
| `power.ratings` | Each series part's current rating (`rate.i`, `l.irms`, `l.isat`, `q.id`, `d.if`; a resistor's `rate.p` from I²R), FETs' `q.vds` and diodes' `d.vr` against the maximum voltage, and a TVS's `tvs.vrwm` against it. Parts without a file or rating are listed in one note and added to Batch configure. |

**The rail:** a power input sets its supply net's voltage before regulators and net names: `v` is the typical (or the
middle of the range), and the range's ends go with it. It reaches the first load through the path's parts (fuses,
diodes, FETs, load switches), over what a net's name says. `supply.range` checks the range's minimum against a pin's
lower limit and its maximum against the upper; `supply.absmax` and the I/O checks use the maximum.

**The path:** from the supply net through series parts (≤ 1 Ω, inductors and beads, fuses, diodes other than LEDs, a
FET's drain and source, load switches and ideal-diode parts), stopping at the first net that feeds an IC's supply pin.

## The run bundle

A sent run's bundle holds `connectors: { assign, profiles }`, the assignments and the profiles they named, so a run
reopened from Signoff EE is checked as it was sent (`assets/runs.js`).

## The shipped profiles (2026-11-13)

Made by a research agent from the makers' documents, all unverified: ST UM2448 (STDC14), Arm 100956 (Cortex 10-pin),
Tag-Connect's TC2030-CTX and TC2050-ARM2010 sheets, and FTDI's TTL-232R datasheet. Worth knowing:

- **STDC14 pins 13 and 14:** UM2448 section 7.4.4 says T_VCP_RX is the target's RX, so pin 13 is `uart-rx` and pin 14
  (T_VCP_TX) `uart-tx`.
- **TC2050** pads run 1 to 5 along one row and 6 to 10 back along the other, not odd and even like a header; pad 5 is GND
  or the debugger's 5 V by an adapter bridge.
- **FTDI TTL-232R:** VCC is 5 V on the 3.3 V cable too.
- **Tag-Connect TC2070** (14-pin, STDC14 with the VCP) exists; no profile yet.

## Not built yet

- AC inputs (a mains terminal block): the rail is DC only.
- Board-to-board: two designs' connectors checked against each other (`conn.mates` in a part file is the start).
- Pin-level `ok` in profiles; a profile editor (profiles are JSON, made by the skill or by hand).
