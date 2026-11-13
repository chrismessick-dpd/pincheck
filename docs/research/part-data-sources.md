# Part data sources for an offline schematic checker

Research date: 2026-11-12. Scope: machine-readable sources for a per-part parameter library (supplies, I/O levels, alternate functions, and so on) used by a browser-only checker that reads Altium SchDoc and KiCad netlist XML.

Marked **verified** where a real file was downloaded and read in this session. Marked **not verified** or **not found** otherwise. Nothing below was committed anywhere; scratch downloads are in the session scratchpad only.

**The licensing question that matters most:** the checker is served from a public GitHub Pages repo, so any library data bundled with it is republished. Each source below says whether it is OK in a **public repo**, OK only in a **private data repo or local use**, or **not stated**.

---

## Summary table

| Source | What it gives | Format | Offline | License, and where the data may live |
| --- | --- | --- | --- | --- |
| ST `STM32_open_pin_data` (mcu/*.xml) | Pin list per package, every signal per pin, pin type (I/O, Power, Reset, Boot), VDD range, temperature range, max frequency (older series only) | XML | Yes (git clone, ~2,600 files) | BSD-3-Clause. **Public OK** |
| ST `STM32_open_pin_data` (mcu/IP/GPIO-*_Modes.xml) | AF number per pin and signal (`GPIO_AF5_LPTIM1`) | XML | Yes | BSD-3-Clause. **Public OK** |
| ST STM32C5 DFP `Descriptors/` (CubeMX2 JSON) | Pins with `io_structure` (FT, TT, RST), options (`a` analog, `f` Fm+), `power_source`, AF ids, analog functions, package bonds | JSON | Yes | BSD-3-Clause per LICENSE.md (GitHub API says NOASSERTION). **Public OK** |
| Full STM32CubeMX db (`db/mcu/families.xml`, per-MCU XML) | Same as open pin data plus a family index | XML | Yes, after installing CubeMX | Not checked (CubeMX isn't installed here). Treat as **private/local** until read |
| embassy-rs `stm32-data` | Generated per-chip JSON: packages, pins, AF numbers, memory, peripherals, interrupts, DMA, datasheet links. No voltages | JSON | Yes | MIT or Apache-2.0. **Public OK** |
| Microchip device packs (`.atpack`): ATDF (SAM, AVR) | Per-ordering-code `vccmin`, `vccmax`, `tempmin`, `tempmax`, `speedmax`, package, pinout (incl. power pads), signals per pad with mux letter | XML | Yes (zip) | Apache-2.0 (SAMD21_DFP and PIC10-12Fxxx_DFP checked). **Public OK** per pack; check each pack's LICENSE.txt |
| Microchip device packs: `.PIC` (EDC) files | VDD min, max, nominal; VPP; pin list with every function name per pin | XML | Yes | Apache-2.0 (PIC10-12Fxxx_DFP checked). **Public OK** |
| CMSIS-Pack `.pdsc` (any vendor) | `<feature type="VCC" n= m=>`, `Temp`, `Dclock`, memory, peripheral counts | XML | Yes | Per pack. Microchip's: Apache-2.0 |
| CMSIS SVD | Registers only, no electrical data (RP2040 SVD lists FUNCSEL per GPIO; not verified here) | XML | Yes | Per vendor |
| Infineon `device-db` (ModusToolbox) | Per-part `minvoltage`, `maxvoltage` (mV), package, memory; personality XML | XML | Yes | Infineon EULA. **Private/local only** |
| NXP MCUXpresso Config Tools data | Pins, signals, clocks (Data Manager can export a ZIP) | Proprietary pack | Yes, after download through the tool | LA_OPT_NXP_Software_License (per v13 release notes). **Private/local only** |
| TI SysConfig device data | Pin mux for MSP430, MSPM0, C2000, Sitara, SimpleLink | Inside SysConfig | Yes, after install | **Not verified** (format, location, and license not checked) |
| TI Product Information API | Basic details, parametric data, some quality data | JSON, REST | **No (online)**, approved accounts only, 3,000 calls/day | TI API terms (not read). **Not stated** for caching |
| TI datasheets (PDF; HTML viewer) | Fixed section set: 7.1 Absolute Maximum Ratings, 7.2 ESD Ratings, 7.3 Recommended Operating Conditions, 7.4 Thermal Information, 7.5 Electrical Characteristics | PDF text with layout | Yes, once downloaded | Datasheet copyright; extracted numbers in a private data repo |
| ADI datasheets (ADI, LTC, Maxim heritage) | AMR, Specifications or Electrical Characteristics | PDF | Yes, once downloaded | **Not verified** (analog.com timed out from this machine) |
| IBIS models | `[Pin]` with model per pin (incl. POWER, GND, NC), `[Model]` with `Model_type`, `Vinl`, `Vinh`, `[Voltage Range]`, `[Temperature Range]`, `[Model Spec]` hysteresis | Text keywords | Yes | Per vendor, usually per-part downloads with use terms. **Private/local** |
| SPICE models (TI PSpice, ADI LTspice) | Behavior, not parameter tables; many encrypted | Netlist text | Yes | Vendor terms. Not a good parameter source |
| KiCad symbol libraries | Pin names, numbers, and electrical types for ~20,000 symbols | `.kicad_sym` S-expressions | Yes | CC-BY-SA 4.0 with a design exception. Redistributing as a collection must stay CC-BY-SA. **Public OK with attribution and share-alike** |
| KiCad netlist XML | Components, fields, libparts with pin `num`, `name`, `type`; nets with `pin`, `pinfunction`, `pintype` per node | XML | Yes | The user's own file |
| DigiKey API v4, Nexar/Octopart | Parametric data ("Voltage - Supply" and so on) | JSON, GraphQL | **No (online)**, keys required | Their terms (not read). Not bundleable |
| Ultra Librarian, SnapMagic, SamacSys | CAD symbols and footprints; pin types sometimes | EDA formats | Per part | Per-download terms, no bulk redistribution |
| Passive MPN schemes (Murata, KEMET, Vishay, Samsung, and others) | Size, dielectric, voltage, tolerance, value | Published tables (encode as rules) | Yes | Facts, not copied data: **Public OK** as our own decoder |
| DC-bias data (Murata SimSurfing, TDK, Samsung, KEMET K-SIM) | Capacitance vs. DC bias curves | Web tools, per-part charts, SPICE libraries | **No bulk offline dataset found** | Murata's terms forbid redistribution |

---

## 1. STMicroelectronics

### STM32_open_pin_data (verified)

- URL: https://github.com/STMicroelectronics/STM32_open_pin_data. License: BSD-3-Clause (LICENSE file). The README calls it "a subset of STM32CubeMx internal database", updated with each CubeMX release. The latest commit is "Subset of official release STM32CubeMX 6.18.0" (2026-06-29). It doesn't accept contributions.
- Layout (git tree, 2,622 paths): `mcu/<RefName>.xml`, one per part and package (2,240 files: C0 84, F0 89, F1 58, F2 16, F3 53, F4 116, F7 92, G0 98, G4 118, H5 151, H7 175, L0 113, L1 90, L4 193, L5 32, MP 232, N6 28, U0 48, U3 171, U5 162, WB 71, WL 50); `mcu/IP/GPIO-*_Modes.xml` (98 files); `boards/*.ioc` (Nucleo and Discovery board configs).
- ST has said it won't add new series that only CubeMX2 supports (for example, STM32C5). Those come as JSON in the device family pack instead (below). Source: https://community.st.com/stm32cubemx2-mcus-151/please-keep-updating-the-stm32-open-pin-data-repo-with-new-families-as-of-now-stm32c5xx-165392

**Real file: `mcu/STM32G031K(4-6-8)Tx.xml`**

```xml
<Mcu ClockTree="STM32G0_64" DBVersion="V3.0" Family="STM32G0" HasPowerPad="false" IOType="" Line="STM32G0x1" Package="LQFP32" RefName="STM32G031K(4-6-8)Tx">
    <Core>ARM Cortex-M0+</Core>
    <Frequency>64</Frequency>
    <Ram>8</Ram>
    <IONb>30</IONb>
    <Die>DIE466</Die>
    <Flash>16</Flash> <Flash>32</Flash> <Flash>64</Flash>
    <Voltage Max="3.6" Min="1.7"/>
    <Temperature Max="125" Min="-40"/>
    <IP InstanceName="ADC1" Name="ADC" Version="aditf4_v3_0_G0_Cube" .../>   (29 IP instances)
    <Pin Name="PB9" Position="1" Type="I/O">
        <Signal Name="I2C1_SDA"/> <Signal Name="SPI2_NSS"/> <Signal Name="TIM17_CH1"/> ...
        <Signal IOModes="Input,Output,Analog,EVENTOUT,EXTI" Name="GPIO"/>
    </Pin>
    <Pin Name="VDD/VDDA" Position="4" Type="Power"/>
    <Pin Name="PF2 - NRST" Position="6" Type="I/O"> ...
    <Pin Name="PA0" Position="7" Type="I/O"> <Signal Name="ADC1_IN0"/> <Signal Name="SYS_WKUP1"/> ...
```

Element names in the whole file: `Mcu`, `Core`, `Frequency`, `Ram`, `IONb`, `Die`, `Flash`, `Voltage`, `Temperature`, `IP`, `Pin`, `Signal`, `Condition`.

**Real file: `mcu/STM32U3 (an LQFP64 or UFBGA64 file)` (UFBGA64)** adds `ContextProject`, `Context`, `MemoryMap`, `TrustZone`. Pin `Type` values: `I/O` (51), `Power` (12: VBAT, VSS, VDD, VDDUSB, VSSA, VDDA, VCAP), `Reset` (1). Some pins carry `<Condition Expression="!(RTC_OUT2 & (WakeUp_Outputed | ...))"/>`.

**Real file: `mcu/IP/GPIO-STM32G03x_gpio_v1_0_Modes.xml`** (where the AF numbers are):

```xml
<GPIO_Pin PortName="PA" Name="PA0">
    <SpecificParameter Name="GPIO_Pin"><PossibleValue>GPIO_PIN_0</PossibleValue></SpecificParameter>
    <PinSignal Name="LPTIM1_OUT">
        <SpecificParameter Name="GPIO_AF"><PossibleValue>GPIO_AF5_LPTIM1</PossibleValue></SpecificParameter>
    </PinSignal>
```

The AF number is parsed from `GPIO_AF<n>_<IP>`. The per-MCU file names its GPIO modes file through `<IP Name="GPIO" Version="STM32G03x_gpio_v1_0" .../>`.

**What it has, item by item**

| Asked about | In open pin data? |
| --- | --- |
| Supply min/max | `<Voltage Min Max>`, **but missing on newer series.** Sampled: C011 has it, but C071 and C092 don't; H725, H735, H745, H753, H7A3, and H7R3 have it, but H7S3 doesn't; WB55 and WBA54 have it, but WBA65 doesn't; and N655, U031, U073, and every sampled U3 (U335, U356, U366, U375, U385, U3B5, U3C5) don't. The full CubeMX `families.xml` (community mirror `esden/stm32cube-database`, 2025-05) has the same gap: 1,988 `<Voltage>` entries for 2,619 `<Mcu>` entries, and STM32U375CETx has none. |
| Per-domain supplies (VDDA, VDDUSB, VBAT, VDDIO2) | **Only as power-pin names.** No ranges, and no mapping of which I/O sits on which domain. |
| Max frequency | `<Frequency>` (MHz). Also missing on U3 and the other newer series above. |
| Temperature range | `<Temperature Min Max>` per file (one per RefName, not per suffix 6/7/3). Missing where Voltage is missing. |
| Pin list with signals | Yes, every package variant has its own file (`Position` is a pin number or ball). |
| AF numbers | Only in `IP/GPIO-*_Modes.xml` (517 `GPIO_AF` entries in the G03x file). |
| EXTI lines | Implicit: a pin whose GPIO signal has `IOModes` containing `EXTI` maps to EXTI line = pin index. No explicit table. |
| ADC channels | Yes, as signal names (`ADC1_IN0`, `ADC1_INP5`, and so on). |
| 5 V tolerant (FT) flags | **Not in the MX1 XML.** |
| Package variants | Yes (file per package; `Package` attribute). |
| Abs max, VIH/VIL, injection current, per-pin and total current, decoupling, crystal gm, ESD | **Not present.** Datasheet only. |

### STM32CubeMX2 JSON (STM32C5 DFP) (verified)

- URL: https://github.com/STMicroelectronics/stm32c5xx-dfp/tree/main/Descriptors. LICENSE.md says BSD-3-Clause.
- Folders: `pinout/`, `clock/`, `peripherals/` (`<die>_peripherals.json`, `_DMA`, `_EXTI`, `_NVIC`), `limitations/`, `middlewares/`, `utilities/`.
- **Real file: `pinout/STM32C531C(B-C)Tx_pinout.json`.** Top keys: `copyright`, `schema_version` ("1.0.0"), `characteristics` (`package_name` "LQFP48", `package_type`, `die_name`, `NbIOs`), `die_pads`, `pin_type_description`, `io_structure_type_description`, `io_structure_options_description`, `power_source_description`, `package_pins`, `signals`, `bonds`, and `version`.

```json
"PA11": { "type": "gpio", "port": "A", "index": 11, "pin_type": "I/O",
          "io_structure": { "type": "FT", "options": ["f"] }, "power_source": "VDD" }
"io_structure_type_description": { "RST": "Bidirectional reset pin with embedded weak pull-up resistor",
                                   "FT": "5V tolerant I/O", "TT": "3.6V tolerant I/O" }
"io_structure_options_description": { "a": "I/O with analog switch function supplied by VDDA", "f": "I2C Fm+ capable I/O" }
{ "name": "USART2_TX", "instance": "USART2", "die_pad": "PA2", "function": { "type": "alternate", "id": "AF7" } }
{ "name": "ADC1_IN2",  "instance": "ADC1",   "die_pad": "PA2", "function": { "type": "analog" } }
"bonds": [ { "die_pad": "PA0", "position": "10" }, ... ]
```

This is the first ST machine-readable source with **FT/TT flags and the supply domain per pin** (`power_source`). It covers only CubeMX2 series so far. No supply min/max was found in the pinout file. The peripherals JSON has a `vddio` key in places (not explored).

### Full STM32CubeMX database

- Installed with CubeMX under `db/mcu/` (`families.xml`, per-MCU XML, `IP/`). The open pin data is a subset. CubeMX isn't installed on this machine (CubeIDE 2.0 no longer bundles it), so its extra content and license terms were **not checked**. The community mirror https://github.com/esden/stm32cube-database has no license file. Don't treat it as redistributable.
- Derived open datasets: https://github.com/embassy-rs/stm32-data (MIT or Apache-2.0; CubeMX db + SVD + HAL headers → per-chip JSON with AF numbers, packages, and pinouts; no voltage data). https://github.com/modm-io/modm-devices (MPL-2.0, now superseded by https://github.com/modm-io/modm-data, MPL-2.0, which extracts hardware descriptions from technical documentation).

### What only ST datasheets have

Absolute maximum ratings (VDD, VIN on FT and TT pins, injected current per pin and total, total IO current), I/O static characteristics (VIL, VIH, Vhys, Ilkg, RPU, RPD), output VOL and VOH at a given IIO, per-domain operating ranges (VDDA, VDDUSB, VDDIO2, VBAT, VREF+), NRST filter, HSE/LSE oscillator requirements (gm crit, drive level, load capacitance), decoupling, and FT pin footnotes. The FT, TT, and `a`/`f` options per pin for MX1 series are in the datasheet's pinout table ("I/O structure" column).

---

## 2. Other MCU vendors

### Microchip (verified, the richest after ST)

- Pack index: https://packs.download.microchip.com/index.idx (52 MB XML). Packs: `https://packs.download.microchip.com/Microchip.<Name>.<version>.atpack` (zip).
- **SAM and AVR: ATDF.** Real file `samd21a/atdf/ATSAMD21G18A.atdf` (from SAMD21_DFP 3.8.270):

```xml
<variant ordercode="SAMD21G18A-MU" package="QFN48" pinout="SAMD21G" speedmax="48000000"
         tempmin="-40" tempmax="85" vccmin="1.62" vccmax="3.63"/>
<variant ordercode="SAMD21G18A-MZ" ... tempmax="125" vccmin="2.7" vccmax="3.63"/>
<pinout name="SAMD21G"> <pin position="5" pad="GNDANA"/> <pin position="6" pad="VDDANA"/> <pin position="17" pad="VDDIO"/> ...
<signal group="AIN" index="0" function="B" pad="PA04"/>
```

  This gives **supply, temperature, and speed per ordering code** (the -MZ variant differs), power pads by name, and the peripheral mux letter (A–H) per signal. No VIH/VIL, FT, or abs max.
- **PIC: `.PIC` EDC files.** Real file `edc/AC162050_AS_PIC12F675.PIC`: `<edc:VDD edc:minvoltage="2.500" edc:maxvoltage="5.500" edc:nominalvoltage="5.000" .../>`, `<edc:VPP edc:minvoltage="12.750" edc:maxvoltage="13.250"/>`, and `<edc:PinList>` with `<edc:VirtualPin edc:name="GP5"/>` and `"T1CKI"` per pin. These VDD values come from the programming tools; check them against the datasheet before treating them as operating limits.
- **CMSIS `.pdsc`** in the same pack: `<feature type="VCC" n="1.62" m="3.63"/>`, `<feature type="Temp" n="-40" m="125"/>`, and `Dclock="48000000"`.
- License: `LICENSE.txt` in SAMD21_DFP and PIC10-12Fxxx_DFP is Apache-2.0. Check each pack.

### NXP

- MCUXpresso Config Tools fetches "processor data" on demand. Its Data Manager exports it as a ZIP for offline use (https://docs.mcuxpresso.nxp.com/config/latest/introduction.html). The tool's license is LA_OPT_NXP_Software_License (Config Tools v13 notes, https://community.nxp.com/t5/MCUXpresso-Config-Tools/MCUXpresso-Config-Tools-v13-Now-Available/ta-p/1585537). No separate license for the data was found. Treat it as **private/local**.
- Zephyr's `hal_nxp` builds pinctrl headers from these packs (`signal_configuration.xml` inside them): https://github.com/zephyrproject-rtos/hal_nxp/tree/master/mcux/scripts/pinctrl. The pin-mux content of Zephyr's generated files is open, but there's no electrical data.
- SVDs: https://github.com/nxp-mcuxpresso/mcux-soc-svd (registers only).
- No supply or I/O electrical data was found in machine-readable form.

### Nordic

- Not found: no machine-readable pin or electrical data beyond SVD/MDK headers and Zephyr devicetree. nRF pin assignments are in the Product Specification PDF.

### Espressif

- https://github.com/espressif/esp-idf (Apache-2.0): `components/soc/<chip>/include/soc/soc_caps.h`, `gpio_sig_map.h`, and `io_mux_reg.h` give GPIO counts, the signal matrix, and IO_MUX functions as C macros. Not opened in this pass. No supply ranges or VIH/VIL (datasheet only).

### Raspberry Pi RP2040 and RP2350

- https://github.com/raspberrypi/pico-sdk (BSD-3-Clause): register headers (`hardware/regs/io_bank0.h`) list FUNCSEL values per GPIO. Not opened in this pass. Electrical data is datasheet only. Public IBIS download URLs tried here returned 404.

### TI (MCUs)

- **SysConfig** (https://www.ti.com/tool/SYSCONFIG) carries per-device pin mux data for MSPM0, MSP430, C2000, SimpleLink, and Sitara. It is installed locally with the tool. Its file format, location, and license were **not verified** (SysConfig isn't installed here, and no public schema was found).
- **CMSIS packs** for MSPM0 exist on TI's site (not opened).

### Renesas

- https://github.com/renesas/fsp (license NOASSERTION per GitHub; not read). Pin data for RA lives in e² studio's pin configurator and FSP packs. **Not found** as open machine-readable electrical data.

### Silicon Labs

- https://github.com/SiliconLabs/simplicity_sdk (NOASSERTION). **Not found** in this pass: no pin-electrical dataset identified.

### Infineon (verified)

- https://github.com/Infineon/device-db, about 14,500 files. Real file `devices/M0S8/PSOC4HV144K/CY8C4126LCE-HV403/base/view.xml`: `<package>32-QFN</package> <minvoltage>3600</minvoltage> <maxvoltage>28000</maxvoltage>` (mV). Also `info.xml` and `studio_*/view.xml` per part.
- License: **Infineon End User License Agreement**. Not for a public repo. Local use only.

### onsemi

- Not found: no machine-readable device database. Product pages offer IBIS and SPICE per part.

### CMSIS-Pack `.pdsc` and SVD in general

- `.pdsc` (https://open-cmsis-pack.github.io/Open-CMSIS-Pack-Spec/main/html/pdsc_family_pg.html) can carry `<feature type="VCC" n= m=>`, `<feature type="Temp" ...>`, `IOs`, and package features, plus `Dclock`, memory, and peripheral counts. It's verified in Microchip's pack. Other vendors fill these unevenly (not checked). The Arm pack index: https://www.keil.arm.com/packs/.
- SVD: registers, fields, and interrupts. **No electrical information.**

---

## 3. General part data

### KiCad symbol libraries (verified license)

- https://gitlab.com/kicad/libraries/kicad-symbols. LICENSE.md: CC-BY-SA 4.0, with an exception so that designs using the symbols aren't adapted material. **Redistributing the libraries, or parts of them, as a collection must stay CC-BY-SA with attribution.** That's fine for a public repo if we keep the license and attribution; it does make that slice of our library share-alike.
- Per pin: number, name, and electrical type. Canonical names in KiCad's exporter (`GetCanonicalElectricalTypeName`) are `input`, `output`, `bidirectional`, `tri_state`, `passive`, `free`, `unspecified`, `power_in`, `power_out`, `open_collector`, `open_emitter`, and `no_connect`. Also a `datasheet` field and footprint filters. No voltages.

### IBIS models (keywords verified from the IBIS 3.1 spec text, https://ibis.org/ver3.1/ver3_1.txt; latest is IBIS 8.0, https://ibis.org/specs/)

- Fields useful to a checker:
  - `[Component]`, `[Manufacturer]`, `[Package]`.
  - `[Pin]`: signal_name and model_name per pin. Model names `POWER`, `GND`, and `NC` mark supply pins. Useful for spotting supply pins and their names.
  - `[Model]` with `Model_type` (Input, Output, I/O, 3-state, Open_drain, I/O_open_drain, and so on), `Vinl`, `Vinh`, `Vmeas`, `C_comp`.
  - `[Voltage Range]` (typ/min/max), `[Temperature Range]`, `[Pullup Reference]`, `[POWER Clamp Reference]`.
  - `[Model Spec]` with `Vinh+`, `Vinh-`, `Vinl+`, `Vinl-` (hysteresis), and `S_overshoot_high`/`low`.
  - `[Model Selector]` for per-supply or drive-strength variants. `[Pin Mapping]` ties pins to supply buses.
- Limits:
  - It gives VIH/VIL only at the one supply each model was characterized at.
  - It has no abs max, and its clamp curves are only implicit.
  - It's common for digital ICs and MCUs (ST, NXP, Microchip, TI, ADI publish them), rare for power and analog parts.
  - Downloads are per part from product pages, under vendor terms. No public sample file could be fetched in this session (Raspberry Pi URLs 404; GitHub code search needs auth). **Private/local.**

### SPICE models

- TI PSpice and ADI LTspice models describe behavior, not tables, and many are encrypted. They aren't a practical source of supply ranges or thresholds. **Not verified** per vendor.

### Online parametric APIs (not offline)

- **TI Product Information API**: https://ti.com/developer-api/product-information-api-suite/product-information-api.html. It returns basic details, parametric data, and limited quality and reliability data. Approved my.ti.com accounts only, 3,000 calls a day, 5 a second. Caching terms are on separate pages (not read).
- **DigiKey API v4** (https://developer.digikey.com/) and **Nexar/Octopart** (https://nexar.com/api): parametric attributes such as "Voltage - Supply" and "Operating Temperature". Both are online with keys. Terms not read. Use only as a one-time import aid if the terms allow storing results.
- **Ultra Librarian, SnapMagic, SamacSys**: per-part CAD symbol and footprint downloads in EDA formats. Pin types are sometimes present, never electrical limits. Per-download terms bar bulk redistribution.

### TI and ADI depth (added at the user's request)

**TI, verified on three PDFs** (TPS62840 buck, OPA2333 op amp, and MSPM0G3507 MCU, pulled from `https://www.ti.com/lit/gpn/<part>` and run through `pdftotext -layout`):

| Part | Specifications sections |
| --- | --- |
| TPS62840 | 7.1 Absolute Maximum Ratings, 7.2 ESD Ratings, 7.3 Recommended Operating Conditions, 7.4 Thermal Information, 7.5 Electrical Characteristics |
| OPA2333 | 6.1 Absolute Maximum Ratings, 6.2 ESD Ratings, 6.3 Recommended Operating Conditions, 6.4/6.5 Thermal Information (per variant), 6.6 Electrical Characteristics |
| MSPM0G3507 | 7.1 Absolute Maximum Ratings, 7.2 ESD Ratings, 7.3 Recommended Operating Conditions (spans pages: "(continued)"), 7.4 Thermal Information, 7.5 Supply Current Characteristics, … 7.10 Digital IO |

- The section names are consistent; the section numbers vary (6.x or 7.x). AMR columns are `MIN MAX UNIT`, ROC columns `MIN NOM MAX UNIT`, EC columns `PARAMETER, TEST CONDITIONS, MIN TYP MAX UNIT`.
- Pitfalls seen in the TPS62840 AMR text:
  - Row groups span cells ("Pin voltage(2)" covering VIN, SW, EN, MODE, STOP, VSET, VOS).
  - Limits are expressions ("VIN + 0.3", "VIN + 0.3 < 3.6").
  - Footnote markers are glued to names ("Absolute Maximum Ratings(1)").
  - Minus signs and degree signs come out as non-ASCII bytes.
  - MCU datasheets split the EC into many subsections.
- An LLM or a layout-aware table extractor can rely on the section names. A fixed column parser can't.
- **TI HTML datasheets**: https://www.ti.com/document-viewer/<part>/datasheet exists. Fetched with curl, the page is a script shell with no `<table>` content (TPS62840: no tables; MSPM0G3507: the server returned the PDF). Structured HTML tables are **not verified**.
- **TI parametric search exports** (product selection tables): **not verified**.
- **TI WEBENCH exports**: **not verified**.
- **TI IBIS and PSpice packs** are per-part downloads from product pages. No bulk download was found. Encryption and license **not verified**.
- Iq, Vref, current limit, UVLO, and similar values are EC rows; they appear in the parametric API and selection tables only as headline values.

**ADI, not verified:** analog.com and its PDFs timed out from this machine, and Mouser mirrors returned HTML. From general knowledge, to be checked:
- Three datasheet lineages: ADI ("SPECIFICATIONS" tables and "ABSOLUTE MAXIMUM RATINGS" as a Parameter/Rating table), LTC (AMR as a run-in list; Electrical Characteristics where a "●" marks specs over the full temperature range), and Maxim (AMR as run-in text; EC with conditions in a header paragraph).
- This is less uniform than TI. An extractor needs a per-lineage prompt or rules.
- ADI parametric tables reportedly export a spreadsheet (secondhand: https://forum.digikey.com/t/finding-parts-in-digikeys-linear-amplifiers-instrumentation-op-amps-buffer-amps-category/22992).
- No ADI parametric API was found.
- LTspice models ship with LTspice (many LTC models encrypted). IBIS models are on product pages for digital and mixed-signal parts.

---

## 4. Parsers and formats

### Altium SchDoc

**Container.** An SchDoc is an OLE compound file (CFB). In the browser, read it with https://github.com/SheetJS/js-cfb (Apache-2.0).

**Records** (verified from https://github.com/vadmium/python-altium/blob/master/format.md, WTFPL):
- Streams: `FileHeader` holds the schematic, `Storage` holds images, `Additional` is optional.
- Framing: each record starts with a 2-byte little-endian length, a 0 byte, and a type byte. Type 0 is a `|KEY=value|...` text property list ending in a null.
- Record numbers: 1 Component, 2 Pin, 15 Sheet symbol, 16 Sheet entry, 17 Power port, 18 Port, 25 Net label, 26 Bus, 27 Wire, 29 Junction, 31 Sheet, 34 Designator, 41 Parameter, 44 Implementation list, 45 Implementation.
- Pin `ELECTRICAL`: 0 Input (the default), 1 I/O, 2 Output, 3 Open collector, 4 Passive, 5 Hi-Z, 6 Open emitter, 7 Power.
- `OWNERINDEX` ties a pin to its component (the zero-based record number). Units are 1/100 inch (10 mil = 0.254 mm).
- Not verified: binary pin records in some SchLib/SchDoc versions; check against real files.

**Existing parsers**

| Parser | License | Status | Use |
| --- | --- | --- | --- |
| https://github.com/gsuberland/altium_js | MIT | Browser SchDoc parser and renderer (AD 22.5); its own OLE reader handles only one contiguous stream; last push 2025-05 | Usable or adaptable directly |
| https://github.com/tscircuit/altiumts | MIT | TypeScript, active (2026-11); browser-local viewer; needs a build step to use | Port or read for reference |
| https://github.com/vadmium/python-altium | WTFPL | Format documentation and SVG converter | The best format reference |
| https://github.com/issus/AltiumSharp | Apache-2.0 | C# reader for Altium library files | Reference for SchLib binary pins |
| https://github.com/thesourcerer8/altium2kicad | GPL-2.0 | Perl converter | Reference only (GPL) |
| KiCad's Altium importer (`eeschema/sch_io/altium/`) | GPL-3.0 | The most complete schematic importer, including connectivity via KiCad | Reference only (GPL) |
| `altium-toolkit` (npm, https://github.com/SunboX/altium-toolkit) | GPL-3.0-or-later, paid commercial license | ESM, parses SchDoc and PcbDoc | Not usable in a non-GPL tool without buying a license |

**Deriving nets from an SchDoc yourself**

You need to:
- compute each pin's hot-spot from `LOCATION` plus `PINLENGTH` and the orientation bits in `PINCONGLOMERATE`;
- handle multi-part components (`CURRENTPARTID` / `OWNERPARTID`), alternate display modes, and hidden pins;
- join wires (vertex lists), junctions, and T-joins, then name nets from net labels, power ports, and ports;
- handle buses with ranges and harnesses, sheet symbols and entries across sheets, and net ties.

**Net scope across sheets is set in the `.PrjPcb`, not the SchDoc.** It can be Automatic, Flat, Hierarchical, Global, or Strict Hierarchical, plus "Allow ports to name nets" and similar options. A single-SchDoc parse can't resolve multi-sheet nets without the project file. That's weeks of work to match Altium's own connectivity. Field names other than those in python-altium's doc are **not verified** here.

**Use an Altium-exported netlist instead.** The Protel netlist (`.NET`) lists components (designator, footprint, comment) and nets (designator-pin pairs). Its pin names and electrical types weren't verified in this pass. If they're absent, the checker still needs the SchDoc (or SchLib) for pin names and types, but only per component, which is easy (records 1, 2, and 41). The pragmatic plan:
1. Netlist for connectivity.
2. SchDoc for components, parameters, and pins.
3. Join on designator and pin number.

### KiCad netlist XML (verified in KiCad source)

From https://gitlab.com/kicad/code/kicad/-/raw/master/eeschema/netlist_exporters/netlist_exporter_xml.cpp:
- The root is `<export version="E">`.
- `<components><comp ref=...>` carries `value`, `footprint`, `datasheet`, `<fields><field name=...>`, and `<property name= value=>` (including `dnp` and `exclude_from_bom`).
- `<libparts><libpart>` has `<pins><pin num= name= type=/>`, where `type` is the canonical electrical type.
- `<nets><net code= name= class=>` has `<node ref= pin= pinfunction= pintype=/>`:
  - `pinfunction` is the pin name, written only when the pin has one; stacked pins get `name_num`.
  - `pintype` gets a `+no_connect` suffix when a no-connect flag sits on a single-pin net, as in `passive+no_connect`.
- So yes: **pin names and pin types are in the KiCad XML netlist**, per node and per libpart. Export command: `kicad-cli sch export netlist --format kicadxml`.

---

## 5. Passive MPN decoding

Encode these as our own rules, which is fine in a public repo. Code tables below come from vendor documents read in this session unless marked.

**Murata GRM/GCM** (verified: Murata GRM catalog Feb 2019, https://www.ttieurope.com/content/dam/tti-europe/manufacturers/murata/resources/GRM_Feb.2019_F.pdf)

Example `GRM 18 8 R6 0J 105 K A01 D`:

| Position | Field | Codes |
| --- | --- | --- |
| 1 | Product | GR = MLCC |
| 2 | Series | M = tin-plated termination (GCM is the automotive series; its codes not fetched) |
| 3 | Size | 01 = 0.25 × 0.125 mm (008004), 02 = 0.4 × 0.2 mm (01005), 03 = 0.6 × 0.3 mm (0201), 15 = 1.0 × 0.5 mm (0402), 18 = 1.6 × 0.8 mm (0603), 21 = 2.0 × 1.25 mm (0805), 31 = 3.2 × 1.6 mm (1206), 32 = 3.2 × 2.5 mm (1210) |
| 4 | Thickness | 3 = 0.3 mm, 5 = 0.5 mm, 8 = 0.8 mm, 9 = 0.85 mm, A = 1.0 mm, B = 1.25 mm, C = 1.6 mm, D = 2.0 mm, E = 2.5 mm, and so on |
| 5 | Temperature characteristic | R7 = X7R, C7 = X7S, D7 = X7T, E7 = X7U, C8 = X6S, D8 = X6T, R6 = X5R, C6 = X5S, 5C = C0G, 7U = U2J |
| 6 | Rated voltage | 0E = 2.5 V, 0G = 4 V, 0J = 6.3 V, 1A = 10 V, 1C = 16 V, 1E = 25 V, YA = 35 V, 1H = 50 V, 2A = 100 V |
| 7 | Capacitance | Two digits and a multiplier, in pF; R = decimal point |
| 8 | Tolerance | B, C, D, G, J (C0G); K = ±10%, M = ±20% |
| 9 | Individual specification | A01 and so on |
| 10 | Packaging | D = 180 mm paper, L = 180 mm embossed, J = 330 mm paper, K = 330 mm embossed |

**KEMET C (now part of Yageo)** (verified: KEMET C1002_X7R datasheet, https://search.kemet.com/download/datasheet/C0603C104K5RACTU)

`C 1206 C 106 M 4 R A C TU`: ceramic, EIA case size, C = standard specification, capacitance code (pF), tolerance (J ±5%, K ±10%, M ±20%), voltage (9 = 6.3 V, 8 = 10 V, 4 = 16 V, 3 = 25 V, 6 = 35 V, 5 = 50 V, 1 = 100 V, 2 = 200 V, A = 250 V), dielectric (R = X7R in this datasheet; other letters not fetched), failure rate (A = N/A), termination (C = 100% matte Sn), and packaging C-spec (TU = 7 in reel, marked or unmarked per its table).

**Vishay CRCW (e3)** (verified: https://www.vishay.com/docs/20035/dcrcwe3.pdf)

`CRCW0603 562R F K EA`:
- Type and size: CRCW0402, 0603, 0805, 1206, 1210, 1218, 2010, or 2512.
- Resistance in 4 characters: R = decimal, K = thousand, M = million, 0000 = jumper.
- Tolerance: F = ±1%, J = ±5%, Z = jumper.
- TCR: K = ±100 ppm/K, N = ±200 ppm/K, 0 = jumper.
- Packaging: EA, EC, ED, EE, EF, EG, EH, EI, or EK.

**Samsung CL** (partly verified)
- Voltage codes (Samsung catalog, via search summary of https://m.samsungsem.com/resources/file/jp/support/product_catalog/MLCC_2512.pdf): R = 4 V, Q = 6.3 V, P = 10 V, O = 16 V, A = 25 V, L = 35 V, B = 50 V, C = 100 V, D = 200 V, E = 250 V, and higher.
- Layout, read from a Samsung datasheet (https://www.farnell.com/datasheets/4788233.pdf, example `CL 10 C 180 J B 8 1 P N C`, where 10 = 0603): series, size, dielectric, capacitance, tolerance, voltage, thickness, plating (Ni/Sn), product (P = automotive AEC-Q200), special code, and packaging.
- Dielectric letters (A = X5R, B = X7R, C = C0G) are from a secondary summary. **Verify.**

**Yageo RC, Panasonic ERJ, TDK C, Taiyo Yuden: code tables not fetched** (the vendor PDFs returned 404 or 403 from this machine). Layouts below are from memory; **verify before coding**:
- Yageo RC: `RC0603FR-0710KL` = series, size, tolerance (F 1%, J 5%), packaging (R paper), TCR (-), reel (07 = 7 in), value (10K), and L. Docs: https://www.yageo.com/en/ProductSearch/PartNumber
- Panasonic ERJ: `ERJ-3EKF1002V` = size digit (2 = 0402, 3 = 0603, 6 = 0805, 8 = 1206), series, tolerance (F 1%; J 5% on the GE series), 4-digit (1%) or 3-digit (5%) value, and packaging (V). Docs: https://industrial.panasonic.com/ww/products/pt/general-purpose-chip-resistors
- TDK: `C1608X7R1H104K080AA` = C, metric size (1608), dielectric (X7R), voltage (1H = 50 V), capacitance, tolerance, thickness (080 = 0.80 mm), packaging, and special. Docs: https://product.tdk.com/en/search/capacitor/ceramic/mlcc/
- Taiyo Yuden: legacy `EMK107B7105KA-T` = voltage letter (E = 16 V), series, size (107 = 1608), temperature characteristic, capacitance, tolerance, thickness, and packaging. Taiyo Yuden has been moving to a new numbering system (`MSAST…`); not checked.

**DC-bias derating data**
- **Murata SimSurfing** (https://ds.murata.com/simsurfing/): web only. Measurement conditions: https://ds.murata.com/simsurfing_data/pdf/en-us/mlcc/sim_mlcc_measuringcond_e.pdf. Murata's EDA libraries model DC bias and are downloadable (https://www.murata.com/tool/data/librarydata/library-pspice), but the terms say the data may not be redistributed and may only be used to confirm characteristics and to simulate. **Local use only.**
- **TDK, Samsung, KEMET K-SIM**: per-part web tools and charts. **No downloadable bulk or offline dataset found.**
- A practical fallback: a generic derating rule per dielectric, case size, and voltage ratio, flagged as an estimate, with a per-part override field filled from vendor charts by hand or by an LLM.

---

## Recommendation: import order

1. **ST open pin data + ST GPIO modes + C5 JSON** (BSD-3, public OK).
   - Pins, power pins, signals, ADC channels, AF numbers, packages, and VDD, temperature, and frequency where present. Use the C5 JSON for FT/TT and `power_source`.
   - Expect gaps: on U3, U0, N6, newer C0, H7S, and WBA65, the supply and temperature ranges must come from the datasheet.
   - embassy `stm32-data` (MIT/Apache) is a cleaner pre-joined alternative for AF numbers.
2. **Microchip ATDF, `.PIC`, and `.pdsc`** (Apache-2.0, public OK).
   - The only source found with **supply and temperature ranges per ordering code**, machine-readable, for a whole vendor.
3. **KiCad netlist XML** as the KiCad input format. It already carries pin names and types, so no library is needed for those.
4. **Altium**:
   - Use `altium_js` (MIT) plus `js-cfb` (Apache-2.0) for components, parameters, and pins.
   - Ask for an Altium-exported netlist for connectivity, rather than deriving nets from the SchDoc. Project-level net scope makes a SchDoc-only connectivity engine a large, error-prone job.
5. **Datasheets via LLM** for everything electrical that no source has: abs max, VIH/VIL, VOL/VOH, injection current, per-domain ranges, FT flags on MX1 STM32 parts, crystal and decoupling notes, and all TI and ADI analog and power limits.
   - Start with TI: section names are uniform across the three lines checked.
   - Store the extracted values in the private data repo with the datasheet revision. Keep extracted numbers, not copied tables.
6. **IBIS** as an optional cross-check for VIH/VIL and supply-pin names where the user has the files locally. Not bundled.
7. **Skip for bundling:** Infineon device-db (EULA), NXP Config Tools data (NXP license), Murata, TDK, Samsung, and KEMET curves (no offline data, or no-redistribution terms), and the online APIs (TI, DigiKey, Nexar). These are only an import aid if their terms allow storing results.
8. **Passive decoders**: write rule tables for Murata, KEMET, Vishay, and Samsung from the verified layouts above first. Fetch the Yageo, Panasonic, TDK, and Taiyo Yuden numbering PDFs before coding those.

## Not verified in this pass (follow-ups)

- TI SysConfig device data: format, location, and license.
- TI parametric and WEBENCH exports, and TI IBIS/PSpice terms.
- ADI datasheet structure, parametric export, and LTspice/IBIS terms (analog.com unreachable from this machine).
- Full CubeMX db contents and license.
- Altium Protel netlist pin fields.
- Binary pin records in SchDoc/SchLib.
- Espressif and pico-sdk header contents.
- Renesas and Silicon Labs data.
- Code tables for Yageo, Panasonic, TDK, and Taiyo Yuden.
