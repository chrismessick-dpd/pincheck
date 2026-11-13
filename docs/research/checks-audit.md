# Schematic checks audit: checks, sources, and the part parameters they need

Research date: 2026-11-12. Web research only. Every tool or source claim below links to what was
actually read (see *Sources* at the end). Where a vendor page names a category but not the rule, the
row says so. "Not found" means the material wasn't found or couldn't be read, not that the tool
lacks the check.

## 1. What each source actually says it checks

| Short name | Source | What was found |
| --- | --- | --- |
| SIE | Siemens HyperLynx / Xpedition Schematic Analysis (formerly Valydate) | Product page lists 12 rule groups, "…and many more": extended net verification through series resistors, switches, and AC coupling; multi-board and backplane interfaces; I/O compatibility for maximum, minimum, and logic thresholds; address and data bus errors (MSB to LSB, bus source); external passive requirements; unconnected mandatory pins; power and ground plane connection; differential connectivity; I/O net missing driver or receiver; pin function compatibility (resets, I2C swapping); symbol mismatch to datasheet; derating of capacitors, resistors, and diodes. Models come from the BOM's MPN against a vendor-datasheet library, not the user's symbols. Blog adds "missing pull ups" and "capacitor derating failures". [S1, S2] |
| CDN | Cadence Allegro System Capture *Design Integrity* audit; OrCAD Capture DRC | Only one named rule found: "IC Power and Ground Pins Without Voltage" (power and ground nets with no voltage value are flagged). OrCAD DRC has single-node nets and unconnected pins. Full rule list: not found (Cadence community blog returned 403). [S3, S4] |
| ZUK | Zuken CR-8000 Design Gateway *Circuit Adviser* | 2025 release adds "component lifespan verification against the expected product lifecycle", "thermal checks … operating near or beyond safe limits", and "Power IC analysis that evaluates voltage margins and power dissipation". Rule-level detail: not found (datasheet PDF failed TLS). [S5, S6] |
| ALT | Altium Designer ERC (Error Reporting and Connection Matrix) | Full violation list read (buses, components, documents, harnesses, nets, others, and parameters), plus a pin-type Connection Matrix (output to output is an error, passive to passive is not). Relevant net rules: floating power objects, nets with no driving source, nets with only one pin, nets with multiple names, nets containing floating input pins, differential pair polarity inversed or missing P/N, unconnected objects. [S7] |
| A365 | Altium 365 BOM Portal | BOM health: "Unknown Part Number", deprecated parts, low stock, compliance failures (REACH example), duplicate designators; lifecycle and compliance roll-up. Full list: not found. AI schematic review in Altium Develop: not found. [S8] |
| KIC | KiCad 9 ERC | 43 checks read verbatim: pin not connected; input pin not driven; power input not driven by power output; NC flag connected; labels and global labels; duplicate references; units with different values or footprints; hierarchical label mismatch; multiple names on a net; footprint link and footprint-filter mismatch; symbol vs library mismatch; unplaced power-input units; pin-type conflict matrix. [S9] |
| FLX | Flux.ai ERC and AI Design Review | ERC: unconnected power pins, missing decoupling, missing I2C pull-ups, single-pin nets. Review tab: Resistor Power Rating, Pull-Up/Pull-Down Configuration, Capacitor Voltage Margins, Parts Availability, Resistor/Capacitor/Inductor Misconfigurations, Switching Power Stage, USB-C Port, Missing Datasheet, EMC review (rule content not published). [S10, S11, S12] |
| DRCY | AllSpice DRCY (AI agent) | Regulator: input in range traced from the source net, output caps vs datasheet, enable pin controlled; feedback divider vs intended Vout (worked example: "1.8 V" rail wrong); total capacitance vs datasheet (310 nF found where 10 µF required); swapped pins (JTAG TDI/TDO); net-name voltage mismatches; symbol pinout vs datasheet. Each finding cites a datasheet page. Schematic only, no layout. [S13, S14, S15] |
| CM | Circuit Mind AVE | Trade press and aggregators only: agents check "operating voltages, pin assignments, electrical constraints" against datasheets, app notes, and in-house checklists; "power analysis, FMEA". No rule list found. [S16, S17] |
| JITX | JITX checks | Built-in checks named in docs search snippets: voltage input/output correctness, pull-ups and pull-downs, rated temperature, passive derating, landpattern manufacturability, regulator input voltage; nets need a voltage property to enable them. Component example: BQ2407 EP tied to VSS. Crystal example: frequency, drive level, critical gain, and tolerance plus pullability vs timing budget. Docs pages themselves returned 404. [S18, S19, S20] |
| Cadstrom, Celus, and Traceformer | AI tools | Cadstrom: parses datasheets for bounds, then sets up simulations; no named checks. Celus: generates schematics from "Cubos"; no review checks found. Traceformer: no named checks found. [S21, S22, S23] |
| TI | TI SPRAD21 (AM62x/AM64x schematic guidelines and review checklist) | Read: supply slew rates and sequencing, PORz delay after supplies, fail-safe I/O and same-source I/O supplies, dual-voltage I/O groups and their caps (ESR < 1 Ω), external pulls (10 kΩ or 47 kΩ default, no contention with internal pulls), series resistors (22 Ω on clock outputs), external ESD on connector I/O, boot mode straps held until latched at PORz, and crystal load caps. [S24] |
| TI-I2C | TI SLVA689 | Rp(min) from VCC, VOL(max), and IOL; Rp(max) from rise time and bus capacitance. Exact equations are images (not read as text). [S25] |
| ST | STM32 AN4488, AN5373, AN5673, AN2867 | AN5373: VCAP 4.7 µF; VDDA 100 nF + 1 µF, may share VDD through a ferrite. AN5673: BOOT0 sampled on NRST rising edge. AN4488 PDF timed out (not read). AN2867 via ECS: gm_crit = 4·ESR·(2πF)²·(C0+CL)², gain margin gm/gm_crit ≥ 5; Cs = pin + PCB stray, about 5 pF. [S26, S27, S28, S29] |
| MCHP | Microchip SmartFusion2/IGLOO2 design checklist (58 items) | Drivers not overloaded (VOH, VOL, VIH, VIL, load C); VDD 1.2 V; VPP 2.5 or 3.3 V; VDDI per bank I/O standard; VREF = VDDQ/2; PLL VDDA common source; unused supply pins; brownout; 10 kΩ pull-ups on reset and FLASH_GOLDEN_N; TCK pull-down; pull up all open-drain pins; level translators between domains; incompatible I/O standards in one bank. [S30] |
| ALTCL | Altium blog schematic review checklist | Read in full: decoupling on every power pin, tantalum ≥ 20% voltage margin, resistor power and voltage (0402 and smaller), LED and optocoupler current resistors from Vf, pulls on reset/enable/floating gates, op-amp polarity, unused array sections, diode/LED polarity, sequencing, regulator input range, total output capacitance within regulator capability, ESD on all external access, reverse polarity, OV/OC/UV protection, fuses, flyback/TVS on MOSFETs, lifecycle and stock, and one PN per passive. [S31] |
| ESDCL | embedded-systems-design.github.io schematic checklist | Read in full: bypass caps per power pin; flyback diode per coil; crystal support circuit; resistor wattage ≥ 50% margin; capacitor voltage ≥ 25% margin; supply capacity ≥ 25% margin; fuses with current ratings, not in series with motors; BJT base resistors; and unused inputs pulled. [S32] |
| MEM | Memfault "Schematic review checklist for firmware engineers" | I2C address uniqueness, UART TX/RX and RTS/CTS crossing, reset pull, peripherals held in a safe state while MCU is in reset, bus recovery after reset, debug access (SWD/SWO), test points, and a GPIO map with alternate-function conflicts. [S33] |
| ECSS | ECSS-Q-ST-30-11C Rev.2 (2021), derating | Text extracted from the official Rev.2 PDF; every ECSS number in §3.7 was found in that text (a third-party rendering of unknown revision was used only as a guide and differs in places: it gives logic-IC supply as "±5% or 90%" and connector voltage as 50%, where Rev.2 says otherwise). The ceramic capacitor table (Table 6-1) is an image: not read. [S34, S35] |
| NASA | GSFC PD-ED-1201 (from MIL-STD-975) | Read from the page-2 image: capacitors 60% rated voltage; resistors 60% rated power; semiconductors 50% power, 75% voltage, and Tj 110 °C; microcircuits 80% supply voltage, 75% power, and Tj 100 °C; inductive devices 50% voltage and 60% rated temperature; relays and connectors 50% current. Rows with an empty part-type cell were read as continuing the row above. [S36] |
| EEE-INST-002 | NASA EEE-INST-002 | Only secondary summaries found; its tables were not read. Lean on ECSS. |
| IPC-9592B | IPC-9592B Appendix A | Paywalled. Covers capacitors, resistors, diodes, transistors, magnetics, microcircuits, breakers, fuses, relays, switches, and oscillators. One third-party figure (aluminum electrolytic ≤ 90% rated voltage) is unverified. [S37] |
| r/PCB | r/PrintedCircuitBoard wiki (schematic and BOM tips) | Mirrors unreachable; the BOM page asks not to be copied. Link only. [S38] |
| Not audited | NXP i.MX hardware developer's guides, ADI, Nordic, EEVblog | NXP guides found by title (each has a design checklist) but not read. ADI and Nordic: not audited. EEVblog: no checklist thread found. [S39] |

## 2. Inputs that are not part parameters

Several checks need design context, not just the netlist and part files. Without these they are only
"partly" offline. Keep them in a per-design file next to the netlist.

| Field | Unit | Meaning |
| --- | --- | --- |
| `env.t_amb_max`, `env.t_amb_min` | °C | Ambient range the board must work in (derating, lifespan, crystal tolerance) |
| `env.mission_life` | h | Required life (Zuken's lifespan check, electrolytic and flash retention) |
| `rail.i_load_max` per net | A | Expected load per rail when no part gives it (regulator margin, resistor and FB current) |
| `net.i_max`, `net.v_max` overrides | A, V | Known stress on a net that propagation can't infer (connector input, battery) |
| `bus.c_bus` per I2C bus | F | Bus capacitance (pull-up maximum) |
| `bus.speed` per bus | Hz | I2C mode, SPI clock, CAN bit rate |
| `derate.policy` | — | Which derating table applies (ECSS, NASA, in-house percentages) |
| `ext.port` on connector pins | — | Marks a pin as user-accessible (ESD, reverse polarity, short-circuit checks) |
| `seq.required` | — | Required supply order, when the parts don't state it |
| `board.c_stray` | F | PCB stray capacitance at the crystal pins (about 5 pF when unknown) |
| DNP flags per variant | — | Which parts are fitted (pulls left out leave pins floating) |

## 3. Checks by area

Offline column: **yes** = netlist + part parameters suffice; **partly (§2)** = also needs a design-context
value from §2 (load current, ambient, bus capacitance); **partly** = a bound or screen is possible but
the full answer needs layout, simulation, or judgment; **no** = not checkable offline.

Field names: `pin.x` is a per-pin field, `vdd.x` per supply-pin group, and `io.x` per I/O domain or pin (§4).

### 3.1 Power and supply

| Check | Sources | Part parameters needed | Offline | Notes |
| --- | --- | --- | --- | --- |
| Every net has a known voltage; power/ground nets with no voltage flagged | CDN, JITX | `reg.vout_fixed`, `reg.vref`, `pin.kind=power_out`, net seeds | yes | Cadence's "IC Power and Ground Pins Without Voltage"; JITX needs net voltage to enable checks |
| Voltage propagation through series parts | SIE | `fb.r_dc`, `fb.i_rated`, `res.value`, `ind.dcr`, `sw.ron`, `sw.vin_range`, `cap` blocks DC | yes | Siemens "extended net verification through series resistors, switches, AC coupling". Propagator needs pass-through rules: 0 Ω, bead, R, L, load switch (with `ron`); AC-coupling caps block DC |
| Regulator output from Vref and feedback divider | DRCY, SIE | `reg.vref` (min/typ/max), `reg.vout_formula`, `pin.func=fb`, `reg.vout_fixed`, `reg.fb_ibias`, `res.tol` | yes | DRCY's worked example; use resistor tolerance and Vref accuracy for a min/max Vout |
| Supply pin within recommended operating range | DRCY, CM, ZUK, TI, MCHP | `pin.domain`, `vdd.rec_min`, `vdd.rec_max` per supply pin | yes | Use propagated min/max; keep recommended separate from absolute maximum |
| Supply pin below absolute maximum (incl. regulator tolerance) | ECSS, ALTCL | `vdd.abs_max` | yes | |
| Regulator input within its input range | DRCY, JITX, ALTCL | `reg.vin_min`, `reg.vin_max`, `reg.vin_abs_max` | yes | DRCY traces the input net to its source |
| LDO dropout headroom | ALTCL | `ldo.vdo` at `i_out`, `reg.vin_min` | partly (§2) | Needs load current |
| Regulator/rail current budget | ALTCL, ESDCL, CM | `reg.iout_max`, `vdd.i_max`, `sw.i_max`, `fb.i_rated` | partly (§2) | ESDCL asks ≥ 25% margin; per-pin supply currents are often missing from datasheets |
| Power IC voltage margin and dissipation | ZUK | `rth_ja`, `tj_max`, `reg.efficiency` curve | partly (§2) | LDO: P = (Vin−Vout)·I is offline; switcher loss needs curves |
| Enable pin driven or tied, within its range | DRCY, ALTCL | `pin.kind=enable`, `en.vih`, `en.vil`, `en.abs_max`, `en.internal_pull` | yes | DRCY: "enable pin is properly controlled" |
| Power-good pins pulled up | MCHP, TI | `pin.kind=od`, `pg.vpullup_max` | yes | Open-drain outputs need a pull-up |
| Sequencing and slew rate required by a part | TI, ALTCL, MCHP | `seq.before[]`, `seq.after[]`, `seq.max_delay`, `vdd.slew_min`, `vdd.slew_max`, `reg.t_ss`, `reg.css_formula` | partly | Order can be inferred from enable/PG chains; timing needs Css and simulation |
| Reset held until supplies valid (POR delay) | TI, ALTCL | `rst.t_hold_min`, `sup.t_delay`, `rst.c_max` | partly | TI: PORz low ≥ 9.5 ms after supplies for the crystal |
| Power-input pin driven by a power output | KIC, ALT | `pin.kind` (power_in/power_out) | yes | KiCad needs PWR_FLAG; better to use propagated voltage |
| Supply pins of one part on consistent rails | SIE, MCHP | `pin.domain`, `vdd.must_equal` (e.g. all VDD pins on one rail) | yes | e.g. MCHP: all PLL VDDA from the same source |
| Analog supply/reference connection | ST, MCHP | `vdd.rec_min`, `vdd.rec_max` (VDDA group), `adc.vref_range`, `vdd.rel` (e.g. VREF = VDDQ/2), `pin.required_ext` | yes | ST: VDDA may tie to VDD through a ferrite bead |
| Unused supply pins handled as specified | MCHP | `pin.unused` ("tie_gnd", "tie_vdd", "nc", "must_power") | yes | |
| Powered-when-unused I/O banks | MCHP | `bank.must_power` | yes | |
| Brownout / supervisor present where needed | MCHP, ALTCL | `ic.has_bor`, `bor.levels`, `sup.vth` | partly | Requirement is judgment |
| Back-powering via I/O when a domain is off (fail-safe) | TI | `pin.fail_safe`, `pin.domain` | yes | TI SPRAD21 §5.4.6: non-fail-safe I/O must share a supply source with the attached device |
| Reverse current / back-feed through regulator | ALTCL | `reg.reverse_block`, `ldo.reverse_i_max` | partly | |

### 3.2 I/O levels and interfaces

| Check | Sources | Part parameters needed | Offline | Notes |
| --- | --- | --- | --- | --- |
| Driver VOH/VOL meet every receiver's VIH/VIL on the net | SIE, MCHP, JITX | `io.voh(min)`, `io.vol(max)` at `io.ioh/iol`, `io.vih` (min), `io.vil` (max) (fixed or as fraction of the domain voltage) | yes | Siemens "I/O compatibility for maximum, minimum and logic thresholds" |
| Input voltage ≤ its absolute maximum (5 V tolerance, VDD+0.3 V) | SIE, ALTCL, TI | `io.vin_abs_max` (absolute or VDD + x), `pin.tolerant_v` | yes | "1.8 V domain driven at 3.3 V" lives here |
| Input not above supply when powered off | TI, ECSS | `pin.fail_safe` | yes | ECSS logic ICs: input ≤ supply unless stated |
| Net has a driver and a receiver | SIE, ALT, KIC | `pin.kind` (input, output, io, oc, od, tri, passive, power) | yes | Siemens "missing driver/receiver"; Altium "Nets with no driving source" |
| Output-to-output conflict | ALT, KIC | `pin.kind` | yes | Pin-type matrix |
| Open-drain/collector nets have a pull-up to a valid rail | SIE, FLX, MCHP | `pin.kind=od`, `io.vin_abs_max` of every pin on the net | yes | Flux: missing I2C pull-ups; MCHP: pull up all OD pins, even unused |
| Pull-up value range (I2C Rp min/max) | TI-I2C | `io.iol` at `io.vol`, `i2c.modes`, `i2c.c_in`, `bus.c_bus` (§2) | partly (§2) | Rp(min) = (VCC−VOL)/IOL is offline; Rp(max) needs bus capacitance |
| Pull resistor contention with an internal pull | TI | `pin.internal_pull` (type, R min/max, default at reset) | yes | TI: avoid mid-supply from external vs internal pulls |
| Floating inputs (unused, Hi-Z at reset) | ALTCL, ESDCL, TI, ALT | `pin.unused`, `pin.reset_state`, `pin.internal_pull` | yes | Altium "Nets containing floating input pins" |
| Mandatory pins connected | SIE, ESDCL | `pin.must_connect`, `pin.required_ext` | yes | Siemens "unconnected mandatory pins" |
| Exposed pad / thermal pad tied correctly | JITX | `pin.ep_net` (e.g. "VSS") | yes | JITX BQ2407 example |
| Pin function swaps (TX/RX, SDA/SCL, MOSI/MISO, TDI/TDO) | SIE, DRCY, MEM | `pin.func` (role per interface: `uart.tx`, `i2c.sda`, `spi.sdo`, `jtag.tdi`) | yes | Siemens "pin function compatibility … I2C swapping"; DRCY JTAG example; Memfault UART/RTS/CTS |
| I2C address uniqueness per bus | MEM | `i2c.addr_base`, `i2c.addr_straps[]` (pin → bit), `i2c.addr_fixed` | yes | Strap pins' propagated levels set the address |
| Bus bit order (MSB to LSB) and bus source | SIE, ALT | `pin.bus`, `pin.bit` | yes | Siemens address/data bus errors |
| Level translator present between mismatched domains | MCHP, SIE | `pin.domain`, `xlat.va_range`, `xlat.vb_range`, `xlat.side` | yes | |
| Output current / fan-out | MCHP, ECSS | `io.i_pin_max`, `ic.i_total_max` | partly (§2) | Needs load current (LED, base drive) |
| Load capacitance on an output | MCHP | `io.c_load_max` | partly | Needs layout capacitance |
| Series resistor provision on clocks / interfaces | TI | `pin.series_r` (recommended Ω) | yes | TI: 22 Ω on clock outputs |
| Peripheral resource conflicts (pin mux, timers, DMA) | MEM, TI | `pin.alt_funcs[]` | partly | Needs firmware GPIO map |
| Multi-board / connector interface consistency | SIE | `conn.pinmap`, `conn.mates_with`, `pin.domain` across boards | yes | Siemens multi-board and backplane verification |

### 3.3 Clocks and crystals

| Check | Sources | Part parameters needed | Offline | Notes |
| --- | --- | --- | --- | --- |
| Crystal frequency matches what the IC supports | JITX, MCHP | `xtal.f`, `osc.f_range` (HSE/LSE) | yes | |
| Load capacitors match CL | ST, TI | `xtal.cl`, `osc.c_pin` (OSC_IN/OUT), `board.c_stray` (§2, ≈5 pF default) | yes | CL = C1·C2/(C1+C2) + Cs. TI notes some parts need no PCB capacitance |
| Oscillator gain margin | ST (via ECS), JITX | `xtal.esr_max`, `xtal.c0`, `xtal.cl`, `osc.gm` (or `osc.gm_crit_max`) | yes | gm/gm_crit ≥ 5 (ECS summary of AN2867) |
| Drive level | ST, JITX, ECSS | `xtal.dl_max`, `osc.drive` (or Rext) | partly | ECSS: 25% of rated drive level; actual DL needs measurement or a model |
| Frequency tolerance budget | JITX | `xtal.tol`, `xtal.stab` vs T, `xtal.pull_ppm_per_pf`, `cap.tol`, `cap.tc` | partly (§2) | JITX: cap tolerance over temperature × pullability vs timing spec |
| Oscillator (active) supply and output level | none found (derived) | `osc.vdd_range`, `osc.voh`, `osc.vol`, `osc.out_type` (CMOS/LVDS) | yes | Same as I/O levels |
| Unused oscillator pins handled | TI | `pin.unused` (e.g. ground XO when XI is driven) | yes | TI: ground XO with an external clock |
| External clock series resistor | TI | `pin.series_r` | yes | |

### 3.4 Reset, boot, and straps

| Check | Sources | Part parameters needed | Offline | Notes |
| --- | --- | --- | --- | --- |
| Reset pin pulled to its inactive level and not floating | MCHP, ALTCL, MEM | `rst.active` (low/high), `pin.internal_pull`, `rst.r_ext_rec` | yes | MCHP: 10 kΩ on DEVRST_N |
| Reset capacitor / RC within limits | ST (forum), TI | `rst.c_max`, `rst.c_rec` | yes | ST forum: 100 nF on NRST; ST AN not read |
| Reset not held by a powered-off supervisor (domains) | TI, SIE | `pin.domain`, `rst.vih` | yes | |
| Boot/strap pins at the intended level at latch | ST, TI | `strap.pins[]`, `strap.latch_event` (e.g. NRST rising, PORz), `strap.table` (value → mode), `strap.pull_r_max` | yes | Level comes from pulls; check pull vs internal pull and other loads on the pin |
| Straps shared with outputs (contention at latch) | TI | `pin.reset_state`, `strap.shared` | yes | e.g. PHY straps |
| Programming/debug interface present and wired | MCHP, MEM, ESDCL | `dbg.type` (SWD/JTAG), `dbg.pins` with required pulls (e.g. TCK pull-down) | yes | |
| Peripherals in a safe state while MCU in reset | MEM, ALTCL | `pin.reset_state`, enable polarity of driven parts | yes | Gates of MOSFETs, enables of switchers |

### 3.5 Regulators and passives sizing

| Check | Sources | Part parameters needed | Offline | Notes |
| --- | --- | --- | --- | --- |
| Output capacitance within regulator min/max (and ESR range) | DRCY, ALTCL | `reg.cout_min`, `reg.cout_max`, `reg.cout_esr_min`, `reg.cout_esr_max`, `cap.dc_bias` | yes | DRCY 310 nF vs 10 µF example. Needs DC-bias derating of MLCCs |
| Input capacitance present and sized | DRCY, ALTCL | `reg.cin_min` | yes | |
| Inductor value in recommended range | FLX (named, rule not published) | `buck.l_min`, `buck.l_max`, `buck.l_rec` (vs Vout) | yes | Flux "Inductor Misconfigurations" |
| Inductor saturation and RMS current | none found (derived) | `ind.isat`, `ind.irms`, `buck.ilim_peak` | yes | Isat ≥ switch current limit is a common rule |
| Bootstrap, soft-start, compensation, RT/FSW parts present and in range | FLX "Switching Power Stage" (named, rule not published) | `pin.required_ext` (e.g. `boot.c = 100 nF`), `reg.rt_formula`, `reg.css_formula` | partly | Values offline; loop stability needs simulation |
| Feedback divider current / value range | DRCY | `reg.fb_r_max`, `reg.fb_ibias` | yes | |
| Switching node diode rating (async) | ECSS (diode derating) | `diode.vrrm`, `diode.if_avg`, `reg.vin_max` | yes | |
| Datasheet-required external passives on any IC (VCAP, VDDA) | SIE, ST, TI | `pin.required_ext[]` (kind, value min/max, dielectric, ESR, to-net) | yes | ST: VCAP 4.7 µF; TI: dual-voltage I/O cap ESR < 1 Ω |
| Divider outputs recalculated (ADC, comparator, UVLO, OVP) | ALTCL | `res.value`, `res.tol`, `uvlo.vth_rise`, `uvlo.vth_fall`, `en.vih`, `en.vil` | yes | |
| LED and optocoupler current resistor | ALTCL | `led.vf`, `led.if_max`, `led.if_rec`, `opto.ctr_min` | yes | |
| BJT base resistor and drive | ESDCL | `bjt.hfe_min`, `bjt.vbe_sat`, `bjt.ic_max` | yes | |
| One PN per passive value and size; merge values | ALTCL | MPN, value, package | yes | BOM-level |
| Resistor/Capacitor misconfiguration (generic) | FLX (named, rule not published) | — | unknown | Flux doesn't publish the rules |

### 3.6 Decoupling

| Check | Sources | Part parameters needed | Offline | Notes |
| --- | --- | --- | --- | --- |
| Each supply pin has a decoupling capacitor on its net | FLX, ALTCL, ESDCL | `pin.kind=power_in`, `pin.decap_rec[]` (value, count) | partly | Netlist shows the cap is on the rail, not that it's near the pin. ESDCL default: 0.1 µF per pin |
| Datasheet decoupling scheme met (values, bulk) | DRCY, ST, MCHP | `pin.decap_rec`, `vdd.bulk_rec` | yes | |
| Connector power pins decoupled | ALTCL | connector `pin.kind=power` | yes | |
| Total capacitance on a rail within the regulator's capability / inrush | ALTCL | `reg.cout_max`, `sw.c_load_max` (load switch or eFuse) | yes | |

### 3.7 Derating and stress

Load ratios are policy (§2 `derate.policy`). The ECSS and NASA values below are what the sources
say, for reference.

| Check | Sources | Part parameters needed | Offline | Notes |
| --- | --- | --- | --- | --- |
| Capacitor voltage margin | SIE, FLX, ALTCL, ESDCL, NASA, ECSS | `cap.v_rated`, `cap.dielectric` | yes | ESDCL ≥ 25%; ALTCL tantalum ≥ 20% above max; NASA 60% of rated; ECSS ceramic table not read |
| MLCC effective capacitance at DC bias | DRCY (indirect) | `cap.dc_bias` (curve or C at V), `cap.dielectric`, `cap.case` | yes | Feeds regulator Cout and decoupling checks |
| Tantalum surge, reverse voltage, ripple | ECSS | `cap.esr`, `cap.i_ripple`, `cap.v_rev_max` | partly | ECSS: surge 75% of Vr/(ESR+Rs); reverse 75%; ripple power 50% |
| Aluminum electrolytic life at temperature | ZUK | `cap.life_h` at `cap.t_rated`, `cap.i_ripple` | partly (§2) | Zuken lifespan check; needs ambient (§2) |
| Resistor power | SIE, FLX, ALTCL, ESDCL, NASA, ECSS | `res.p_rated` at `res.t_knee`, `res.t_max` | partly | Offline when both node voltages are known (pull-ups, dividers, LED); ESDCL ≥ 50% margin; NASA 60%; ECSS chip 50% to 85 °C, 0% at 125 °C |
| Resistor voltage (small cases) | ALTCL, ECSS | `res.v_max` (working) | yes | ECSS 80%; ALTCL flags 0402 and smaller |
| Diode reverse voltage, forward current, Tj | SIE, ECSS | `diode.vrrm`, `diode.if_avg`, `diode.ifsm`, `tj_max`, `rth_ja` | partly | ECSS: VR 75%, IF 75%, Tj ≤ min(110 °C, Tjmax − 40 °C) |
| Zener/TVS power | ECSS | `zener.p_max`, `zener.izm` | partly | ECSS 65% |
| MOSFET VDS, VGS, ID | ECSS | `fet.vds_max`, `fet.vgs_max`, `fet.id_max`, `fet.pd_max` | yes for V, partly for I | ECSS: VDS 80%, VGS 75%, ID 75%, PD 65% |
| BJT VCEO, IC, PD | ECSS | `bjt.vceo`, `bjt.vcbo`, `bjt.vebo`, `bjt.ic_max`, `bjt.pd_max` | yes for V | ECSS 75%/75%/65% |
| IC supply voltage derating | ECSS, NASA | `vdd.abs_max`, `vdd.rec_max` | yes | ECSS Rev.2: logic ICs and memories at most the maximum recommended value; linear ICs 90% of maximum rating (DC + ripple); NASA microcircuits 80% |
| Op-amp input voltage derating | ECSS | `opamp.vin_abs_max`, `opamp.vcm_min`, `opamp.vcm_max` | yes | ECSS Rev.2: op-amps within maximum rated VIN (or 50% of input current); comparators and rail-to-rail amps ≤ 100% or derated supply; regulators 90% |
| IC output current | ECSS | `io.i_pin_max` | partly (§2) | ECSS 80% |
| Junction temperature (all semis) | ZUK, ECSS, NASA | `tj_max`, `rth_ja`, `rth_jc`, power estimate | partly (§2) | ECSS: Tj ≤ min(110 °C, Tjmax − 40 °C), with a 125 °C / Tjmax − 25 °C exception for qualified ICs |
| Connector contact current and voltage | ECSS, NASA | `conn.i_contact`, `conn.v_rated`, `conn.v_dwv` | partly (§2) | ECSS Rev.2: current 50%; voltage ≤ min(25% of DWV, 75% of rated working); 30 °C below maximum temperature |
| Crystal drive level | ECSS | `xtal.dl_max` | partly | ECSS 25% |
| Inductor and transformer insulation, hot spot | ECSS, NASA | `ind.v_insul`, `ind.t_max` | partly | |
| Relay contacts (resistive, inductive, motor) | ECSS | `relay.i_contact` by load type, `relay.coil_v_range` | partly | ECSS: inductive 50%, motor 50%, filament 10% of resistive |
| Thermistor, fuse, wire, LED, optocoupler | ECSS | `ntc.p_max`, `fuse.i_rated`, `led.if_max`, `led.vr_max`, `opto.ic_max` | partly | ECSS LED IF 50% if no recommendation; LED VR 75% |
| Temperature rating vs ambient | JITX, ZUK, ECSS | `t_op_min`, `t_op_max` per part | partly (§2) | JITX rated-temperature check |

### 3.8 Protection and ESD

| Check | Sources | Part parameters needed | Offline | Notes |
| --- | --- | --- | --- | --- |
| External-access pins have ESD protection | ALTCL, TI | `ext.port` (§2), `tvs.vrwm`, `tvs.vbr`, `tvs.vclamp`, `tvs.c_line` | yes | Presence offline; effectiveness needs layout |
| TVS working voltage ≥ signal's max | none found (derived) | `tvs.vrwm`, propagated `net.v_max` | yes | |
| TVS clamp ≤ protected pin's absolute max | none found (derived) | `tvs.vclamp` at `tvs.ipp`, `io.vin_abs_max` | yes | |
| TVS capacitance vs interface speed | none found (derived) | `tvs.c_line`, `iface.c_max` | yes | e.g. USB 2.0 HS |
| Reverse polarity, overvoltage, undervoltage, overcurrent on input | ALTCL | `efuse.ovp`, `efuse.uvlo`, `efuse.ilim`, `fuse.i_rated`, `fet.vgs_max` | partly | Presence and ratings offline; transient energy needs analysis |
| Flyback diode on inductive loads | ESDCL, ALTCL | load `kind=coil` (relay, motor, solenoid), `diode.vrrm`, `diode.if_avg` | yes | |
| MOSFET gate protected and pulled | ALTCL | `fet.vgs_max`, gate pull | yes | |
| Series current-limit resistors to MCU pins from external | ALTCL | `io.i_inject_max`, `ext.port` | yes | |
| Fuses rated, not in series with motors | ESDCL | `fuse.i_rated`, `fuse.v_rated` | partly | |
| Short-circuit protection on outputs leaving the board | ALTCL | `reg.ilim`, `sw.ilim`, `efuse.ilim` | partly | |

### 3.9 Connectivity and ERC

| Check | Sources | Part parameters needed | Offline | Notes |
| --- | --- | --- | --- | --- |
| Unconnected pins (not marked NC) | KIC, ALT, CDN, ESDCL | `pin.must_connect`, `pin.kind` (nc vs dnc) | yes | |
| NC pins connected | KIC | `pin.kind=dnc` (do not connect) vs `pin.kind=nc` (no internal connection, may connect) | yes | |
| Single-pin nets, floating labels, dangling wires | KIC, ALT, CDN, FLX | — | yes | Netlist-level |
| Nets with multiple names / similar names | KIC, ALT | — | yes | |
| Power/ground pins on the right net (incl. hidden pins) | SIE, ALT, KIC | `pin.kind=power/ground`, `pin.domain` | yes | Siemens power/ground plane connection |
| Pin-type conflict matrix | ALT, KIC | `pin.kind` | yes | |
| Differential pairs complete, polarity correct | SIE, ALT | `pin.diff_pair`, `pin.polarity` | yes | Altium: polarity inversed, missing P/N |
| Symbol pinout matches datasheet | SIE, DRCY, ALTCL, ESDCL | `pin.number`, `pin.name`, `pin.func` | yes | Compare symbol pin names/numbers to the part file's pin table |
| Shorted components (both pins on one net) | ESDCL | — | yes | |
| Multi-unit consistency (values, footprints) | KIC | — | yes | |

### 3.10 BOM, lifecycle, and footprint consistency

| Check | Sources | Part parameters needed | Offline | Notes |
| --- | --- | --- | --- | --- |
| Every part has an orderable MPN; passives have values | A365, ALTCL, ESDCL | `mpn`, `manufacturer` | yes | |
| Unknown part number | A365 | `mpn` vs library | yes | Offline: "no part file" |
| Lifecycle (active, NRND, EOL) | A365, ALTCL, ZUK | `lifecycle`, `lifecycle_date` | partly | A dated snapshot is offline; currency needs a live feed |
| Stock / availability | A365, FLX, ALTCL | — | no | Live data |
| Compliance (RoHS, REACH) | A365 | `rohs`, `reach` | partly | Snapshot |
| Footprint matches package / footprint filter | KIC | `package`, `pin_count` (footprint filters are library data, not part parameters) | yes | |
| Symbol vs library copy, generic components, missing models | ALT, KIC | — | yes | |
| Duplicate designators | ALT, KIC, A365 | — | yes | |
| Variant / DNP consistency (pull-ups DNP'd leave pins floating) | none found (derived) | DNP flags (§2); `pin.internal_pull`, `pin.unused` | yes | |

### 3.11 Analog

| Check | Sources | Part parameters needed | Offline | Notes |
| --- | --- | --- | --- | --- |
| Op-amp/comparator polarity and feedback present | ALTCL | `pin.func` (in+, in−, out) | partly | Polarity intent is judgment |
| Input common-mode range and output swing vs rails | none found (derived) | `opamp.vcm_min`, `opamp.vcm_max` (vs rails), `opamp.vout_swing`, `opamp.rail_to_rail` | yes | |
| Op-amp supply range | ECSS | `opamp.vs_min`, `opamp.vs_max` | yes | |
| ADC input within VREF range; filter on ADC pins | ALTCL, ESDCL | `adc.vin_range`, `adc.vref_range`, `adc.r_src_max`, `adc.c_sample` | partly | Filter presence and source impedance offline |
| Reference voltage and VREF decoupling | ST, MCHP | `vref.vout`, `adc.vref_range`, `vref.c_load_range`, `pin.required_ext` | yes | |
| Amplifier stability (cap loads) | ALTCL | `opamp.c_load_max` | partly | Simulation for the full answer |
| Divider ratios recalculated | ALTCL | `res.value`, `res.tol` | yes | |
| Analog supply from switcher without filtering | ALTCL | rail source kind (`reg.kind`) | partly | Judgment |

### 3.12 High-speed, USB, and differential

| Check | Sources | Part parameters needed | Offline | Notes |
| --- | --- | --- | --- | --- |
| Diff pairs P/N matched between parts | SIE, ALT | `pin.diff_pair`, `pin.polarity` | yes | |
| AC-coupling caps where required, absent where forbidden | SIE, MCHP | `pin.ac_coupling` (required, value range) | yes | MCHP: SerDes AC coupling |
| Termination present and value | MCHP, TI | `pin.term` (type, R, to-net) | yes | |
| USB-C CC resistors (Rd 5.1 kΩ sink, Rp source), VBUS rating | FLX | `usbc.role`, `usbc.cc_internal`, `usb.vbus_abs_max` | yes | Flux "USB-C Port" (rules not published) |
| USB series resistors and ESD capacitance | TI | `usb.r_series`, `tvs.c_line` | yes | |
| CAN / RS-485 termination and bus voltage | none found (derived) | `can.vbus_range`, `rs485.vcm_range`, `iface.term_rec` | yes | Not found in audited tools |
| Impedance, length matching, return paths | Sigrity, SIE pre-layout | — | no | Layout |

### 3.13 Thermal

| Check | Sources | Part parameters needed | Offline | Notes |
| --- | --- | --- | --- | --- |
| Parts near or beyond safe temperature | ZUK | `tj_max`, `rth_ja`, power estimate | partly (§2) | Linear parts offline; switchers need efficiency curves |
| LDO dissipation | ZUK | `rth_ja`, `tj_max` | partly (§2) | Needs load current |
| Part temperature range vs product range | JITX | `t_op_min`, `t_op_max` | partly (§2) | |

### 3.14 Documentation and testability

| Check | Sources | Part parameters needed | Offline | Notes |
| --- | --- | --- | --- | --- |
| Test points on rails and critical signals | ALTCL, ESDCL, MEM | `kind=testpoint` | yes | |
| Power LED per rail | ALTCL, ESDCL | — | yes | Style |
| Title block, revision list, annotation | ALTCL, KIC, ALT | — | yes | |
| Fuses labeled with ratings | ESDCL | `fuse.i_rated` | yes | |
| Unresolved text variables, off-grid, symbols out of date | KIC, ALT | — | yes | |

## 4. Part parameter fields

Every field is an object, not a bare number:

```
{ "min": …, "typ": …, "max": …, "unit": "V", "cond": "Ta=25 °C, Io=1 A",
  "page": 12, "verified": true }
```

Keep absolute maximum and recommended operating separate. Derating uses absolute maximum; functional
checks use recommended. Units are SI; temperatures in °C.

### 4.1 Any IC (pins and package)

| Field | Unit | Meaning |
| --- | --- | --- |
| `mpn`, `manufacturer`, `package`, `pin_count` | — | Identity and footprint match |
| `kind` | — | Part kind: mcu, regulator, load_switch, efuse, supervisor, crystal, oscillator, interface, opamp, comparator, adc, dac, vref, tvs, fet, bjt, diode, zener, led, opto, connector, res, cap, ind, fb, fuse, ntc, relay, coil (motor, solenoid), testpoint |
| `lifecycle`, `lifecycle_date`, `rohs`, `reach` | — | BOM health snapshot |
| `t_op_min`, `t_op_max` | °C | Operating range |
| `tj_max`, `rth_ja`, `rth_jc` | °C, °C/W | Thermal limits |
| `pin.number`, `pin.name` | — | Pin table for the symbol check |
| `pin.kind` | — | power_in, power_out, ground, io, input, output, od, oc, tri, passive, nc (may connect), dnc (do not connect), ep |
| `pin.func` | — | Role in an interface: `i2c.sda`, `uart.tx`, `spi.sdo`, `jtag.tdi`, `en`, `pg`, `fb`, `sw`, `boot`, etc. |
| `pin.domain` | — | Which supply pin powers this I/O (e.g. "VDDIO1") |
| `pin.must_connect`, `pin.unused` | — | Mandatory pin; how to terminate when unused (tie_gnd, tie_vdd, float_ok, pull) |
| `pin.internal_pull` | Ω, type | Internal pull type, R min/max, and whether it's on at reset |
| `pin.reset_state` | — | Hi-Z, low, high, or pulled during and after reset |
| `pin.fail_safe`, `pin.tolerant_v` | —, V | Input safe when unpowered; maximum input voltage if tolerant |
| `pin.required_ext[]` | — | External parts the datasheet requires: kind, value min/max, dielectric, ESR, to-net (VCAP 4.7 µF, VDDA 100 nF + 1 µF) |
| `pin.decap_rec[]` | F | Recommended decoupling per supply pin |
| `pin.series_r`, `pin.term` | Ω | Recommended series resistor or termination |
| `pin.ac_coupling` | F | AC-coupling capacitor required (value range) or forbidden |
| `pin.diff_pair`, `pin.polarity` | — | Differential pair membership |
| `pin.bus`, `pin.bit` | — | Bus membership and bit index |
| `pin.ep_net` | — | Net the exposed pad must join |
| `vdd.rec_min`, `vdd.rec_max`, `vdd.abs_max` | V | Supply ranges per supply group |
| `vdd.must_equal`, `vdd.rel` | — | Groups that must share a rail or a relation (VREF = VDDQ/2) |
| `vdd.bulk_rec` | F | Recommended bulk capacitance on the group's rail |
| `vdd.slew_min`, `vdd.slew_max` | V/s | Supply ramp limits |
| `vdd.i_max` | A | Supply current per group (budget) |
| `seq.before[]`, `seq.after[]`, `seq.max_delay` | —, s | Sequencing constraints |
| `io.vih`, `io.vil` | V or fraction of VDD | Input thresholds (absolute or ratio to the domain) |
| `io.voh`, `io.vol` with `io.ioh`, `io.iol` | V, A | Output levels at a test current |
| `io.vin_abs_max`, `io.vin_abs_min` | V or VDD+x | Input absolute limits |
| `io.i_pin_max`, `ic.i_total_max`, `io.i_inject_max` | A | Per-pin, package total, and injection current |
| `io.c_load_max` | F | Maximum load capacitance |

### 4.2 MCU, processor, and FPGA (adds)

| Field | Unit | Meaning |
| --- | --- | --- |
| `osc.f_range`, `osc.gm` or `osc.gm_crit_max`, `osc.c_pin`, `osc.drive` | Hz, A/V, F | Oscillator range, transconductance, pin capacitance, drive setting |
| `rst.active`, `rst.vih`, `rst.vil`, `rst.c_max`, `rst.c_rec`, `rst.r_ext_rec`, `rst.t_hold_min` | —, V, F, F, Ω, s | Reset pin needs |
| `strap.pins[]`, `strap.latch_event`, `strap.table`, `strap.pull_r_max` | —, —, —, Ω | Boot/strap pins, when latched, value → mode map, largest pull that still sets the level |
| `strap.shared` | — | Strap pins that are also outputs after reset (contention at latch) |
| `dbg.type`, `dbg.pins[]` (with required pulls) | — | Debug interface |
| `bank.io_standards`, `bank.must_power` | — | FPGA bank voltage standards; banks that must be powered |
| `ic.has_bor`, `bor.levels` | V | Brownout capability |
| `pin.alt_funcs[]` | — | Alternate functions (mux conflicts) |
| `adc.vin_range`, `adc.vref_range`, `adc.r_src_max`, `adc.c_sample` | V, Ω, F | ADC input needs |

### 4.3 Regulator: LDO, buck, boost, PMIC

| Field | Unit | Meaning |
| --- | --- | --- |
| `reg.kind` | — | ldo, buck, boost, buck_boost, inverting, charge_pump, pmic_channel |
| `reg.vin_min`, `reg.vin_max`, `reg.vin_abs_max` | V | Input range |
| `reg.vout_fixed` or `reg.vref` (min/typ/max) | V | Fixed output, or reference for the divider |
| `reg.vout_formula` | — | e.g. `vref*(1+rtop/rbot)` plus `fb_ibias` term; pins named |
| `reg.fb_ibias`, `reg.fb_r_max` | A, Ω | Feedback input current; divider resistance limit |
| `reg.iout_max`, `reg.ilim` (min/max) | A | Rated current and current limit |
| `reg.cout_min`, `reg.cout_max`, `reg.cout_esr_min`, `reg.cout_esr_max` | F, Ω | Stable output capacitance and ESR window |
| `reg.cin_min` | F | Required input capacitance |
| `ldo.vdo` at `i_out` | V | Dropout |
| `ldo.reverse_i_max`, `reg.reverse_block` | A, — | Back-feed behavior |
| `buck.l_min`, `buck.l_max`, `buck.l_rec`, `buck.fsw` | H, Hz | Inductor range and switching frequency |
| `buck.ilim_peak` | A | Peak switch current limit (inductor Isat) |
| `reg.rt_formula`, `reg.css_formula`, `boot.c` | — | Timing and bootstrap part formulas |
| `reg.t_ss` | s | Soft-start time (fixed, or from `css_formula`) |
| `en.vih`, `en.vil`, `en.abs_max`, `en.internal_pull` | V | Enable pin |
| `uvlo.vth_rise`, `uvlo.vth_fall` | V | UVLO thresholds |
| `pg.od`, `pg.vpullup_max`, `pg.threshold` | —, V | Power-good output |
| `reg.efficiency` (curve) | — | Dissipation for thermal checks |

### 4.4 Load switch and eFuse

| Field | Unit | Meaning |
| --- | --- | --- |
| `sw.vin_range`, `sw.vin_abs_max` | V | Input range |
| `sw.ron` (max, at temperature) | Ω | On resistance for propagation drop |
| `sw.i_max`, `sw.ilim` | A | Continuous current and current limit |
| `sw.c_load_max`, `sw.slew` | F, V/s | Inrush limits |
| `sw.reverse_block`, `sw.qod` | — | Reverse blocking, quick output discharge |
| `efuse.ovp`, `efuse.uvlo`, `efuse.ilim` | V, A | Protection thresholds |
| `en.*`, `pg.*` | — | As for regulators |

### 4.4a Supervisor and reset IC

| Field | Unit | Meaning |
| --- | --- | --- |
| `sup.vth` (min/typ/max), `sup.hyst` | V | Monitored threshold and hysteresis |
| `sup.t_delay` | s | Reset timeout after the supply is valid (fixed or from a capacitor formula) |
| `sup.out_type`, `sup.out_active` | — | Push-pull or open-drain; active low or high |
| `sup.vdd_range`, `sup.vin_abs_max` | V | Supply range; monitored input limit |
| `sup.mr` | — | Manual reset input present and its pull |

### 4.5 Crystal and oscillator

| Field | Unit | Meaning |
| --- | --- | --- |
| `xtal.f` | Hz | Nominal frequency |
| `xtal.cl` | F | Specified load capacitance |
| `xtal.c0` | F | Shunt capacitance |
| `xtal.esr_max` | Ω | Maximum ESR (gain margin) |
| `xtal.dl_max` | W | Maximum drive level |
| `xtal.tol`, `xtal.stab` | ppm | Tolerance at 25 °C; stability over temperature |
| `xtal.pull_ppm_per_pf` | ppm/F | Pullability (tolerance budget) |
| `osc.vdd_range`, `osc.out_type`, `osc.voh`, `osc.vol`, `osc.i_supply` | V, —, A | Active oscillator supply and output |

### 4.6 Interface ICs (I2C, SPI, UART, USB, CAN, RS-485, level translators)

| Field | Unit | Meaning |
| --- | --- | --- |
| `i2c.addr_base`, `i2c.addr_straps[]` (pin → bit, and level meaning) | — | Address and how strap pins set it |
| `i2c.addr_fixed[]` | — | Fixed addresses (multi-function parts) |
| `i2c.modes`, `i2c.c_in` | Hz, F | Supported speeds; pin capacitance |
| `spi.mode`, `spi.f_max` | —, Hz | SPI mode and clock |
| `uart.flow` | — | RTS/CTS presence and direction naming convention |
| `usb.vbus_abs_max`, `usb.r_series`, `usbc.role`, `usbc.cc_internal` | V, Ω, — | USB VBUS rating, series R, Type-C role, internal Rd/Rp |
| `can.vbus_range`, `can.v_abs` (CANH/CANL) | V | CAN bus pin limits |
| `rs485.vcm_range`, `rs485.v_abs`, `rs485.unit_load` | V | RS-485 limits and load |
| `iface.term_rec` | Ω | Recommended termination |
| `iface.c_max` | F | Largest capacitance the interface tolerates per line (TVS choice) |
| `xlat.va_range`, `xlat.vb_range`, `xlat.side[]`, `xlat.dir` | V | Translator side ranges, which pins are A or B, direction |

### 4.7 Op-amp, comparator, ADC, DAC, and reference

| Field | Unit | Meaning |
| --- | --- | --- |
| `opamp.vs_min`, `opamp.vs_max`, `opamp.vs_abs_max` | V | Supply range |
| `opamp.vcm_min`, `opamp.vcm_max` (relative to rails) | V | Input common-mode range |
| `opamp.vout_swing` (to each rail, at load) | V | Output swing |
| `opamp.rail_to_rail` | — | in, out, both, none |
| `opamp.vin_abs_max`, `opamp.vdiff_max` | V | Input and differential input limits |
| `opamp.c_load_max` | F | Stable capacitive load |
| `cmp.out_type` | — | push-pull or open-drain (needs pull-up) |
| `adc.*` | — | As in 4.2 |
| `vref.vout`, `vref.c_load_range`, `vref.i_out_max` | V, F, A | Reference output and stability window |
| `dac.vout_range`, `dac.i_out_max` | V, A | DAC output |

### 4.8 ESD and TVS

| Field | Unit | Meaning |
| --- | --- | --- |
| `tvs.vrwm` | V | Reverse working (standoff) voltage |
| `tvs.vbr` (min) | V | Breakdown voltage |
| `tvs.vclamp` at `tvs.ipp` | V, A | Clamping voltage at peak pulse current |
| `tvs.ppp` | W | Peak pulse power |
| `tvs.c_line` | F | Line capacitance |
| `tvs.dir` | — | Unidirectional or bidirectional |
| `tvs.esd_rating` | V | IEC 61000-4-2 contact/air rating |
| `tvs.channels[]` | — | Which pins protect which line |

### 4.9 MOSFET, BJT, and diode

| Field | Unit | Meaning |
| --- | --- | --- |
| `fet.type` | — | N or P |
| `fet.vds_max`, `fet.vgs_max`, `fet.id_max`, `fet.pd_max` | V, V, A, W | Ratings for derating |
| `fet.vgs_th` (min/max), `fet.rds_on` at `vgs` | V, Ω | Gate drive adequacy; drop |
| `bjt.vceo`, `bjt.vcbo`, `bjt.vebo`, `bjt.ic_max`, `bjt.pd_max`, `bjt.hfe_min`, `bjt.vbe_sat` | V, A, W, — | Ratings and drive |
| `diode.vrrm`, `diode.if_avg`, `diode.ifsm`, `diode.vf` at `if`, `diode.trr` | V, A, A, V, s | Ratings and forward drop |
| `zener.vz` (min/max), `zener.p_max`, `zener.izm` | V, W, A | Zener rating |
| `led.vf`, `led.if_max`, `led.if_rec`, `led.vr_max` | V, A | LED drive and derating |
| `opto.ctr_min`, `opto.if_max`, `opto.ic_max`, `opto.vceo` | —, A, V | Optocoupler drive and ratings |
| `tj_max`, `rth_ja` | °C, °C/W | Thermal (as 4.1) |

### 4.10 Connectors

| Field | Unit | Meaning |
| --- | --- | --- |
| `conn.i_contact` (at temperature rise) | A | Current per contact |
| `conn.v_rated`, `conn.v_dwv` | V | Working voltage; dielectric withstanding voltage |
| `conn.t_max` | °C | Maximum temperature |
| `conn.pinmap` | — | Pin numbering (mating side), for multi-board checks |
| `conn.mates_with` | — | Mating part, for cross-board pin and voltage checks |

### 4.11 Passives: resistors, capacitors, inductors, and ferrite beads

| Field | Unit | Meaning |
| --- | --- | --- |
| `res.value`, `res.tol`, `res.tcr` | Ω, %, ppm/°C | Value and accuracy |
| `res.p_rated`, `res.t_knee`, `res.t_max` | W, °C | Power and its derating curve |
| `res.v_max` | V | Maximum working voltage |
| `cap.value`, `cap.tol`, `cap.dielectric` | F, %, — | Value, accuracy, and dielectric (C0G, X7R, X5R, Y5V; tantalum; polymer; aluminum) |
| `cap.v_rated`, `cap.v_rev_max` | V | Voltage rating; reverse limit for polarized types |
| `cap.dc_bias` | F at V | Capacitance vs DC bias (curve or points) |
| `cap.tc` | %/°C or class | Temperature characteristic |
| `cap.esr`, `cap.i_ripple`, `cap.life_h` at `cap.t_rated` | Ω, A, h, °C | Ripple and life for electrolytics |
| `cap.case` | — | Size code (DC-bias depends on it) |
| `ind.value`, `ind.tol`, `ind.isat`, `ind.irms`, `ind.dcr` | H, %, A, A, Ω | Inductor ratings |
| `ind.v_insul`, `ind.t_max` | V, °C | Insulation and hot spot (derating) |
| `fb.z_at_100mhz`, `fb.r_dc`, `fb.i_rated` | Ω, Ω, A | Ferrite bead (propagation drop and current) |
| `fuse.i_rated`, `fuse.v_rated`, `fuse.i2t` | A, V, A²s | Fuse |
| `ntc.r25`, `ntc.beta`, `ntc.p_max` | Ω, K, W | Thermistor |
| `relay.coil_v_range`, `relay.i_contact` (resistive, inductive, motor) | V, A | Relay |

## 5. What commercial tools do that isn't offline-checkable

- **Simulation.** Regulator loop stability and transient response, amplifier stability, sequencing
  timing (soft start, RC delays, supply ramp), inrush, and crystal drive level all need simulation
  or measurement (ALTCL asks to simulate each switcher; Cadstrom sets up simulations automatically;
  Zuken feeds analog operating points into Circuit Adviser). [S6, S21, S31]
- **Layout-dependent.** Decoupling placement and loop inductance, signal integrity and impedance,
  stray capacitance on crystals, ESD effectiveness, thermal spreading, and IBIS-based SI (MCHP asks
  for pre- and post-layout SI and SSN analysis). [S30]
- **Live data.** Stock, pricing, and current lifecycle (Altium 365, Flux "Parts Availability"). [S8, S12]
- **Reasoning about intent.** Whether a net name matches its voltage ("5V" missing a "V", DRCY);
  whether a block needs isolation, a supervisor, a fuse, or filtering; recommended application
  circuits; FMEA (Circuit Mind); firmware interactions such as bus recovery after reset (Memfault).
  LLM reviewers (DRCY, Circuit Mind AVE, Flux) do these by reading datasheets at review time; an
  offline checker can only do them when the part file encodes the rule (`required_ext`, `strap.table`). [S13, S16, S33]
- **Datasheet reading at review time.** DRCY and Circuit Mind read the datasheet per review. The
  offline equivalent is the part file plus its `page` and `verified` fields.

## 6. Gaps (not found or not read)

- Siemens's full rule list beyond the 12 groups ("…and many more").
- Cadence System Capture's full Design Integrity rule list (blog returned 403).
- Zuken Circuit Adviser rule names (datasheet PDF failed TLS).
- Flux's rule content for its named checks; Altium Develop or Altium 365 AI review.
- JITX's built-in `check-design` property list (docs returned 404; only search snippets).
- Circuit Mind, Cadstrom, Celus, and Traceformer rule lists.
- ECSS Table 6-1 (ceramic capacitor voltage), an image in the PDF.
- EEE-INST-002 tables; IPC-9592B Appendix A (paywalled).
- STM32 AN4488 (timed out) and AN2867 itself (formula via ECS only); NXP, ADI, and Nordic guides.
- The r/PrintedCircuitBoard wiki (mirrors unreachable; link only).
- SLVA689 exact equations and the I2C rise-time and capacitance table (column order unclear in the
  snippet; check NXP UM10204).

## Sources

- S1 Siemens Schematic Analysis product page: https://www.siemens.com/en-us/products/pcb/hyperlynx/schematic-analysis/
- S2 Siemens blog, PCB design best practices, schematic analysis (2023): https://blogs.sw.siemens.com/electronic-systems-design/2023/05/16/pcb-design-best-practices-schematic-analysis/
- S3 Cadence community, "Some basic rules for design verification" (search snippet; page 403): https://community.cadence.com/cadence_blogs_8/b/pcb/posts/some-basic-rules-for-design-verification
- S4 Cadence ERC overview: https://resources.pcb.cadence.com/blog/2023-electrical-rule-check
- S5 Zuken CR-8000 2025 (Digital Engineering 24/7): https://www.digitalengineering247.com/article/zuken-launches-cr-8000-2025-with-ai-enhanced-support
- S6 Zuken Design Gateway datasheet (not read, TLS failure): https://digital.zuken.com/rs/707-ZQM-176/images/DS-CR8000-DesignGateway-EN.pdf
- S7 Altium design validation (ERC violation types): https://www.altium.com/documentation/altium-designer/schematic/design-validation
- S8 Altium 365 BOM Portal error detection: https://www.altium.com/documentation/altium-365/bom-portal/error-detection-correction
- S9 KiCad 9 Schematic Editor, list of ERC checks: https://docs.kicad.org/9.0/en/eeschema/eeschema.html
- S10 Flux AI design reviews docs: https://docs.flux.ai/tutorials/ai-design-reviews
- S11 Flux AI design reviews blog: https://www.flux.ai/docs/tutorials/copilot-use-cases/ai-design-reviews
- S12 Flux, Introducing the AI Design Review Tab: https://www.flux.ai/p/blog/introducing-the-ai-design-review-tab
- S13 AllSpice, How DRCY reviews your schematics: https://www.allspice.io/post/under-the-hood-how-drcy-reviews-your-schematics
- S14 AllSpice, Using AI in schematic design reviews: https://allspice.io/post/using-ai-in-schematic-design-reviews-what-we-learned-and-what-surprised-us
- S15 DRCY paper (arXiv 2603.15672): https://arxiv.org/html/2603.15672
- S16 Circuit Mind AVE launch (iConnect007): https://iconnect007.com/article/152189/circuit-mind-launches-aipowered-pcb-design-verification-platform/152186/design
- S17 Circuit Mind funding (aggregator): https://letsdatascience.com/news/circuit-mind-raises-25m-and-launches-ai-schematic-verificati-66997b17
- S18 JITX Quickstart: Check a Design (snippet; page 404): https://docs.jitx.com/tutorials/quickstart-check-a-design.html
- S19 JITX detailed design checks (crystal): https://jitx.com/product/detailed-design-checks
- S20 JITX component-level checks (BQ2407): https://jitx.com/product/detailed-design-checks-component-level-user-checks
- S21 Innovation Endeavors on Cadstrom: https://www.innovationendeavors.com/insights/our-investment-in-cadstrom-ai-enabled-tooling-for-electrical-engineers
- S22 CELUS interview (Electronic Specifier): https://www.electronicspecifier.com/?p=39512
- S23 Traceformer listing: https://feedbagel.com/post/traceformer-ai-powered-schematic-review-tool-for-kicad-and-altium-designer
- S24 TI SPRAD21 (AM62x/AM64x schematic design guidelines and review checklist): https://ti.com/lit/pdf/sprad21
- S25 TI SLVA689, I2C bus pull-up resistor calculation: https://www.ti.com/document-viewer/lit/html/SLVA689/pullup-resistor-calculation-slva6899380
- S26 ST AN5373 (STM32U5 hardware): https://www.st.com/content/st_com/en/technical-documents/an5373-getting-started-with-stm32u5-mcu-hardware-development-stmicroelectronics_asset/chunk-002-topic-an5611-power-supply-schemes.html
- S27 ST AN5673 (STM32C0 hardware): https://www.st.com/resource/en/application_note/an5673-getting-started-with-stm32c0-mcu-hardware-development-stmicroelectronics.pdf
- S28 ST AN4488 (not read, timed out): https://www.st.com/resource/en/application_note/an4488-getting-started-with-stm32f4xxxx-mcu-hardware-development-stmicroelectronics.pdf
- S29 ECS/Arrow on AN2867 crystal design: https://www.arrow.com/en/research-and-events/articles/considerations-when-designing-crystals-into-stm32-microcontrollers ; ST AN2867: https://www.st.com/resource/en/application_note/an2867-oscillator-design-guide-for-stm32-microcontrollers-stmicroelectronics.pdf
- S30 Microchip SmartFusion2/IGLOO2 design checklist: https://onlinedocs.microchip.com/oxy/GUID-2952C8AA-A592-489E-8058-3FD06065EDDB-en-US-7/GUID-F49DA2CC-7375-4BA1-9639-4B8D4967EFA7.html
- S31 Altium, Schematic Design Review Checklist: https://resources.altium.com/p/schematic-review-checklist
- S32 Embedded Systems Design schematic checklist: https://embedded-systems-design.github.io/schematic-checklist
- S33 Memfault, Schematic review checklist for firmware engineers: https://interrupt.memfault.com/blog/schematic-review-checklist
- S34 ECSS-Q-ST-30-11C Rev.2 (2021): https://ecss.nl/wp-content/uploads/2022/07/ECSS-Q-ST-30-11C-Rev.2(23June2021).pdf
- S35 ECSS reader rendering (secondary): https://ecss-reader.pages.dev/docs/standards/product-assurance/ECSS-Q-ST-30-11C
- S36 NASA GSFC PD-ED-1201, EEE parts derating: https://extapps.ksc.nasa.gov/Reliability/Documents/Preferred_Practices/1201.pdf
- S37 IPC-9592B table of contents: https://www.electronics.org/TOC/IPC-9592B.pdf
- S38 r/PrintedCircuitBoard schematic review tips (link only): https://www.reddit.com/r/PrintedCircuitBoard/wiki/schematic_review_tips
- S39 NXP i.MX 8M Plus hardware developer's guide (title only): https://community.nxp.com/pwmxy87654/attachments/pwmxy87654/other/21907/1/IMX8MPHDG.pdf
