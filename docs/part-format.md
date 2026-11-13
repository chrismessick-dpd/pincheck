# The part file (`pincheck.part/1`)

One JSON file per part, or per family that shares a pinout and ratings. The library keeps them in the
private repo `pincheck_data` as `parts/<id>.json`, and in each browser's IndexedDB. Pincheck, the
`pincheck-part` Claude skill, and `tools/import_cubemx.py` all write this format;
`node tools/part.js check <file>` validates it.

```json
{
  "schema": "pincheck.part/1",
  "id": "tps562201ddcr",
  "mpn": "TPS562201DDCR",
  "match": ["TPS562201DDCT"],
  "manufacturer": "Texas Instruments",
  "kind": "regulator",
  "description": "4.5-V to 17-V input, 2-A synchronous step-down converter",
  "package": "SOT-23-6 (DDC)",
  "datasheet": { "title": "…", "rev": "SLVSCZ1", "url": "https://…", "sha256": "…" },
  "domains": ["VIN"],
  "pins": [
    { "num": "3", "name": "VIN", "role": "power-in", "domain": "VIN" },
    { "num": "4", "name": "VFB", "role": "feedback" }
  ],
  "values": [
    { "k": "reg.vin", "min": 4.5, "max": 17, "unit": "V", "page": 4, "src": "llm",
      "ok": { "by": "@chrismessick", "at": "2026-11-12T20:00:00Z" } },
    { "k": "io.absmax", "on": "VDD", "value": "VDD+0.3", "unit": "V", "page": 70, "src": "llm" }
  ],
  "made": { "by": "@chrismessick", "at": "…", "how": "from schematic" },
  "updated": "2026-11-12T20:00:00Z"
}
```

## Identity

| Field | Meaning |
|---|---|
| `id` | The file name in the library: the part number, lowercased, other characters as `-`. |
| `mpn` | The part number this file is for. |
| `match` | Other part numbers it covers, with `*` and `?` wildcards (`STM32G071K?U6*`). Only for parts with the same pinout and ratings: packing suffixes, temperature grades the checks don't care about. |
| `kind` | One of `node tools/part.js kinds`. It picks which parameters the editor offers. |
| `datasheet` | Which document the values came from: title, document number and revision, link, and the PDF's SHA-256. |
| `status` | `imported` (brought in by an LLM or a library, not yet gone through by hand) or `checked` (a person went through it against the datasheet). Set in the Identity tab; a file without it counts as `imported`. Per-value `ok` still says which values were verified. |
| `made`, `updated` | Who started the file and how (`from schematic`, `by hand`, `import:cubemx`, `llm (pincheck-part)`), and when it last changed. |

## Pins

Every pin of this package, numbered as on the schematic symbol (Pincheck compares the two and flags
differences).

| Field | Meaning |
|---|---|
| `num`, `name` | Pin number and name. |
| `role` | What the pin is for: `power-in`, `power-out`, `ground`, `io`, `input`, `output`, `open-drain`, `analog`, `bus` (a CAN, RS-485, RS-232, or USB data line: the domain's logic levels don't apply; its limits are `bus.absmax`, `can.vcm`, or the pin's own `vmax` and `absmax`), `clock-in`, `clock-out`, `reset`, `boot`, `enable`, `feedback`, `switch`, `bootstrap`, `power-good`, `nc` (may be tied), `dnc` (do not connect), `pad`, `other`. |
| `domain` | For a power pin, the supply group it belongs to; for an I/O pin, the supply that powers it. Must be in `domains`. |
| `ft` | `true` if the datasheet marks the pin 5 V tolerant. |
| `functions` | Alternate functions and interface roles: `"I2C1_SCL AF6"`, `"EXTI8"`, `"ADC1_IN5"`. |
| `reset` | State during and after reset: `hiz`, `analog`, `low`, `high`, `pull-up`, `pull-down`. |
| `unused` | What the datasheet says to do when unused: `float`, `gnd`, `supply`, `pull`, `must`. |
| `ext` | An external part the datasheet requires on the pin: `"4.7 µF to GND, ESR < 1 Ω"`. |
| `vmax`, `absmax` | The pin's own recommended maximum and absolute maximum voltage, where they differ from its domain's `io.absmax` (I2C pins rated 1.98 V on a 3.3 V part, a pin rated BATT+0.3). Numbers in volts or expressions. The checks use these before the domain's. |
| `aliases` | The datasheet's other names for the pin (a slash-joined pin name, or a name per variant: `["MODE"]` beside `SYNC`). A symbol using any of them matches (2026-11-13). |
| `contact` | On a connector, which pads are one contact (the two solder tails of a power contact): pads with the same `contact` must be on one net, or the board shorts them through it (`conn.contacts`). Only from the maker's drawing. |
| `note` | Anything else. |

## Values

Each value is one catalog key (`assets/params.js`; list them with `node tools/part.js catalog [kind]`),
optionally on one supply domain.

| Field | Meaning |
|---|---|
| `k` | The catalog key, e.g. `supply.range`. Keys outside the catalog are kept and shown, never checked; the skill prefixes its own with `x.`. |
| `on` | The domain, for keys the catalog marks `on: domain` (`supply.range` on `VDDA`). |
| `min`, `typ`, `max` | For range keys. Any of the three. |
| `value` | For single-value keys. |
| `text`, `list` | For text and list keys. |
| `unit` | The catalog's unit. Numbers are in SI base units: 100 nF is `1e-7`. |
| `cond` | Test conditions or the ordering code it applies to: `"Ta = 25 °C, IOUT = 1 A"`. |
| `page` | The PDF page it's on. |
| `src` | Where it came from: `datasheet`, `llm`, `import:cubemx`, `schematic parameter`, `hand`. |
| `note` | Anything else. |
| `ok` | `{ by, at }` once a person has checked it against the page. Editing the value clears it. Never written by a script or the skill. |

A limit given relative to a supply stays an expression in a string, naming the file's domains:
`"VDD+0.3"`, `"0.7*VDD"`, `"VSS-0.1"`, and `min(…, …)` or `max(…, …)` for a limit that is the
smaller or larger of two: `"min(VDD+0.4, 4.0)"`. The checks evaluate it with the net voltages they work out.

Checks treat a failure that rests on an unverified value as a warning that names the value to verify
(Chris, 2026-11-12).

## Bookkeeping that isn't saved

In the browser, each file also has `local` (`sha` of the repo blob it was based on, `dirty` when edited
since the last sync, `conflictOf` for a conflict copy). It is stripped before a file is written to the
repo or exported.
