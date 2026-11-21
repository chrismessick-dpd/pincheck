# MCU pin planner (plan, 2026-11-20)

Status: planning, with a lab (`pincheck/lab/pinmap.html`). Nothing built in a tool yet.

Chris (2026-11-20): "I have an MCU that I've assigned to a block. Since we know the MCU pinout and
alternate pins already, I'm wondering if there's a way to incorporate a CubeMX type functionality into
the MCU block. … I'd like to know that when I connect an I2C interface to the MCU, there's actually an
I2C available and what peripheral number it is. Then something like CubeMX's part and used pin view,
where you can click available pins for peripherals." Start with STM32, open to other families later.

## What we already have

- **The pins and their alternate functions.** Pincheck's part file (`pincheck.part/1`,
  `docs/part-format.md`) lists every pin with `functions` such as `"I2C1_SCL AF6"`, `"ADC1_IN5"`, and
  `"USB_DM"`. `tools/import_cubemx.py` writes them for any STM32 from the CubeMX database on this
  computer. The files live in private `pincheck_data`.
- **The connections.** A Scribe EE block's `Connects:` lines already name the interface in brackets:
  `IMU (I2C1)`, `microSD (SPI1)`, `Wi-Fi module (UART)`, `Probe port (2 ADC + 4 drive, in)`. Ports,
  routes, and labels are kept per section.
- **The block's parts.** `Parts: U4, C4–C7` names designators, not part numbers.

So the pin data and the connection list both exist; what's missing is the link between them and a
place to make the choices.

## What a real board's description shows

One real board (an STM32G0B1 in LQFP48) has 18 connections into its MCU block. Read against the
CubeMX data for that part:

| Connection label | What the part says |
| --- | --- |
| `I2C1`, on six blocks | One bus, one instance: fine, but it's six connections and one pin pair. |
| `DAC1 via RC` and `DAC2` | The part has one DAC with two outputs (DAC1_OUT1 on PA4, DAC1_OUT2 on PA5). `DAC2` doesn't exist; it means DAC1_OUT2. |
| `touch sense` | The part has no touch controller (TSC). Touch needs another method or another part. |
| `PB8–PB15`, one byte-wide port | All eight are bonded in LQFP48, but PB8 and PB9 are I2C1's usual pins, so I2C1 has to move to PB6 and PB7 (or PA9 and PA10). |
| `PA14/PA13` (boot button and SWD) | PA14 is both BOOT0 and SWCLK: one pin, two roles, on purpose. |
| `LCD SPI` (not SPI1) | Any SPI but SPI1: SPI2 or SPI3, each with its own pin choices. |
| `EXTCOMIN`, `TIM PWM`, `ADC` | A signal name, not an interface: a GPIO, a timer channel, and an ADC channel. |

Those are exactly the catches Chris described. The lab replays them on a made-up part.

## The data: what's missing from the part file

- **Pads bonded to two GPIOs.** On G0 parts, pads 33 and 34 carry PA11 or PA9 and PA12 or PA10 (a
  remap). CubeMX lists both; `import_cubemx.py` keeps only the first, so PA9's and PA10's functions
  on those pads are lost, and their AF numbers too. Fix: a pin gets `bond: [{ name, functions }]` for
  the second GPIO.
- **Peripheral instances.** CubeMX's `<IP>` list says which peripherals the part has (I2C1 to 3, SPI1
  to 3, DAC1 …), including ones with no pins. The functions imply most of them; write the list too
  (`peripherals: ["I2C1", …]`), so "no DAC2" is a fact, not an absence.
- **Signals without an AF number** (`ADC1_IN0`, `USB_DM`, `COMP1_INP`) are analog or additional
  functions, chosen by enabling the peripheral, not by the AF mux. The planner treats them the same
  way for pin use; an export has to know the difference, so keep it (it is: no ` AFn`).
- **Other families.** Keep the planner on the generic `INSTANCE_SIGNAL AFn` strings, so only an
  importer is family-specific. Some families don't fit a fixed table: nRF and ESP32 route most
  peripherals to any GPIO, RP2040 has a function per pin from a small set. A part-level
  `route: "matrix"` (any signal of the listed instances on any `io` pin) covers the first; RP2040 fits
  the table. Importers to write later: NXP (MCUXpresso pins data), Microchip (device packs), Nordic,
  Raspberry Pi.

## The planner

1. **Read each connection label** into what it needs: a type (I2C, SPI, UART, USB, CAN, ADC, DAC,
   timer, touch, SWD, GPIO), an optional instance (`I2C1`, `SPI2`), an optional count (`2 ADC`), or
   explicit pins (`PB8–PB15`, `PA14/PA13`). Words it doesn't know (`EXTCOMIN`, `via RC`, `LCD`) are
   kept: a lone unknown word plans one GPIO and says so.
2. **Group buses.** Connections with the same bus label (six `I2C1`) share one instance and one set
   of pins. Point-to-point types (UART, ADC, GPIO) don't group.
3. **Check against the part.** No instance of that type (touch sense), no such instance (`DAC2`, with
   the nearest match offered: DAC1_OUT2), or not enough pins left.
4. **Place the pins.** Explicit pins and pins the person locked first, then the most constrained
   connection next. A bus takes its signals from one instance (SCL and SDA both from I2C1); an
   instance goes to one connection; a pad goes to one signal. GPIOs prefer pads with the fewest other
   uses. When a connection can't be placed, it says which connections hold the pads it could use.
5. **Click to choose.** Click a pad for its functions (CubeMX's way), or click a connection to light
   the pads it could use and pick one. A pick is a lock; the rest re-plans around it. A function set
   on a pad that no connection asks for shows as "not in Scribe", with an offer to add the connection.

Every state has a mark and a pattern as well as a color (Chris is colorblind): placed (filled), locked
(a padlock), candidate (a dashed ring), problem (the issue hatch and ×), warning (the warn dots and
!), fixed pins (power, reset, boot) gray and labeled.

## The views (in the lab)

- **Package.** The part drawn as CubeMX does: pads round the body, the pin name inside, the planned
  signal outside. LQFP and QFN as four sides, SO and TSSOP as two, BGA as a ball grid.
- **Block.** The MCU as a Scribe block with its connected blocks round it, and each connection's pins
  on the edge facing it ("I2C1 · PB6 SCL, PB7 SDA"). This is the view that belongs in Scribe.
- **Ports.** PA0 to PA15, PB0 to PB15 … as a grid, unbonded pins struck out: for byte-wide port
  requirements and for seeing what's free at a glance.
- **Matrix.** Peripheral instances against pads, a dot where the instance can use the pad: why I2C1
  can't stay on PB8 and PB9, at a glance.
- **Table.** Pad, name, planned signal, connection, and the other functions; sortable, and the shape
  an export takes.

## Where it fits

**Decided (Chris, 2026-11-20): in Scribe EE, on the MCU block.**

**In Scribe EE, on the MCU block.** The block panel of a block whose part is an MCU
gets a **Pins** section: the part, a count ("14 of 37 I/O planned, 2 problems"), and each connection's
peripheral and pins, with *Open pin map*, which opens a full-window view (like the diagram's expand)
with the five views above. Connection lines in the diagram get the instance as a quiet suffix
("I2C1 · PB6/PB7") and a problem mark when the part can't do it. It lives where the connections are
written, so a label change re-checks at once.

- *Data:* the part's pin and function data comes from the Pincheck library, but contractors don't
  read `pincheck_data`, so when a pin map starts, the part file is copied into the review (as
  Pincheck's Send already stores part files in review repos, which Chris allowed for CubeMX-derived
  files on 2026-11-13). The copy is the plan's reference; *Update from library* refreshes it.
- *Storage:* on the MCU block's section, beside `ports` and `labels`: `pins: { part: { id, sha },
  map: { "<pad>": { sig: "I2C1_SCL", edge: "<connection id>", lock: true } } }`, merged per pad like
  other section data. Unplaced connections aren't stored; they're worked out.
- *The part number:* a `Part:` line on the block, from the shared library (see *One part library*).

**Pincheck checks the schematic against the plan.** Once a board has a schematic, Pincheck already
knows each MCU pin's net. A new check compares it with the plan: a pin planned as I2C1_SCL whose net
doesn't reach the IMU, a planned pin left unconnected, a used pin with no plan. That closes the loop
from description to schematic.

**FW reads it.** Signoff FW's Scribe *Hardware* section and Jig read the board's pin map from the EE
review's summary (a short `pins` list), so firmware sees I2C1 on PB6/PB7 without asking. Exports:
`pins.h` defines, a CSV, and later a CubeMX `.ioc` (pins and modes only; CubeMX reads it and does the
clock tree and code). Importing an `.ioc` back is the other half: an engineer who planned in CubeMX
brings the result into Scribe.

**Not a new tool.** A standalone pin planner would repeat the connection list. If one is wanted for
boards without a Scribe description, Pincheck could open the same view on any part in its library.

## One part library, shared with Pincheck (Chris, 2026-11-20)

Chris: the planner is independent of Pincheck but compatible with it. A block diagram usually comes
before any schematic to run through Pincheck, so EE must be able to make a part that isn't in the
library yet, with the same part maker Pincheck uses, and a part made in either tool is there in the
other.

- **One library.** Pincheck's library is IndexedDB `pincheck` in the browser, synced with
  `pincheck_data/parts/`. Every tool is served from one origin, so EE loading Pincheck's own
  `library.js` (and `params.js`) from `../pincheck/assets/` reads and writes the same database and the
  same repo: a part saved in EE is in Pincheck's list at once, and the other way round. No copy, no
  second format. (Partcheck already loads the hub's `auth.js` this way.)
- **One part maker.** EE opens Pincheck's part window (`PK.editor.open`, `editor.js`) as a sheet, with
  its Identity, Pins, and Parameters tabs, Import JSON, and *Fill with Claude…* (the `pincheck-part`
  skill, which reads CubeMX for STM32s). For the planner only the Pins tab's functions matter; the
  parameters can wait for Pincheck. Its styles move into a file EE can load too (`editor.css` beside
  `editor.js`), or stay in Pincheck's `styles.css` under `.pk-ed`.
- **CubeMX in the browser.** The Python importer can't run from a page, so the part window gains
  *Import from CubeMX…*: pick the MCU's XML from `STM32CubeMX/db/mcu/` (and its GPIO modes file for
  the AF numbers) on this computer, and the page reads it as `import_cubemx.py` does, shared pads and
  peripherals included. The data still goes only to `pincheck_data` and review repos.
- **The block names its part** with a `Part:` line (`Part: STM32G0B1CBT6`, beside `Parts: U4`), set
  in the block panel by a picker over the library, with *New part…* opening the part window filled
  with that number. When a Fabcheck or Pincheck run later knows U4's part number and it differs, the
  panel says so.
- **Access.** FTEs read and write the library. When a pin map starts, the part file is copied into
  the review (Chris: copy), so contractors see the pin map and its alternate functions without
  `pincheck_data`; *Update from library* refreshes the copy, and a newer library file is flagged.
- **Labels stay as written** (Chris). The pin map holds the planner's choices; the line and the panel
  show "UART · USART1 · PB6/PB7". A label that names an instance (`I2C1`) still binds.
- **`.ioc` after the planner works** (Chris).

## Phases

1. **Part data (built 2026-11-20; the library's STM32s re-imported, `pincheck_data` `3c6d818`):** `import_cubemx.py` writes `bond` and `peripherals`; the format doc and
   `tools/part.js check` learn them; Pincheck's Pins tab shows a shared pad. Re-import the STM32s
   already in the library (dry run first). Then *Import from CubeMX…* in the part window.
2. **The planner as an engine module (built 2026-11-20):** `ee_design_review/assets/pinmap.js`
   (`window.SignoffPinmap`, pure: label reading, grouping, checks, placement, candidates, picks), with EE tests on a
   made-up part; the lab draws it. Requirement ids are stable (`bus:I2C|I2C1`, `<connection id>#<item>`), so picks
   stored by pad survive edits. On the real board, read-only: the same catches as above, and after the DAC fix
   DAC1_OUT2 goes to the function generator and DAC1_OUT1 to the buck.
3. **Scribe EE (in progress 2026-11-20: the Part line, the copy, the panel's Pins section, the full-window pin map (engine file `pinview.js`, which the lab mounts too), marks on the diagram's lines, and New part… / Edit part… (Pincheck's part window in EE) built: phase 3 done but for the demo; see `ee_design_review/docs/scribe-ee.md`, *Pins*):** Pincheck's library and part window loaded from `../pincheck/assets/`, the block's
   `Part:` line with its picker and *New part…*, the copy into the review, the Pins section in the
   panel, the full-window pin map, and marks on connection lines. EE only (ME and FW get the synced
   file, inert).
4. **Exports and FW:** `pins.h`, CSV, the summary's `pins`, FW Scribe's Hardware section, Jig.
5. **Pincheck's plan check,** then `.ioc` import and export, then other families' importers.

## Decisions

1. Scribe EE's MCU block (Chris, 2026-11-20).
2. A `Part:` line on the block, from one part library shared with Pincheck, made in Pincheck's part
   window when it's missing (Chris, 2026-11-20; see *One part library*).
3. The part file is copied into the review when a pin map starts (Chris).
4. Labels stay as written; the pin map holds the choice (Chris).
5. `.ioc` export and import after the planner works (Chris).
