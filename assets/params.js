// The parameter catalog: every value a part file can hold that Pincheck's checks know about, as
// Fabcheck's Fab.rules lists its DFM limits. A part file may hold other keys too (kept, shown as
// "Other"), but only catalog keys are checked.
//
// Each entry: k (the key), label, unit (SI base: V, A, W, Hz, F, H, Ω, °C, s, or '' for text),
// shape ('range' = min/typ/max, 'value' = one number or an expression like "VDD+0.3", 'text', 'list'),
// on ('part', 'domain' = per supply domain, 'pin' = per pin or pin group), kinds (part kinds it's
// offered for; 'any' for every part), group (the heading it sits under), and hint.
// Expressions may name a domain: "0.7*VDD", "VDD+0.3", "VDDA-0.2".
(function (PK) {
  'use strict';

  const KINDS = {
    ic: 'IC', mcu: 'Microcontroller', regulator: 'Regulator (LDO, buck, boost, or buck-boost)', switch: 'Load switch, eFuse, or hot swap',
    interface: 'Interface (I2C, SPI, UART, USB, CAN, RS-485, Ethernet)', analog: 'Op-amp, comparator, or current sense', converter: 'ADC, DAC, or reference',
    logic: 'Logic or level shifter', driver: 'Gate or motor driver', memory: 'Memory', sensor: 'Sensor', power: 'Charger, gauge, or PMIC',
    module: 'Module (radio, power, or other)', supervisor: 'Supervisor or reset IC', crystal: 'Crystal or oscillator', protection: 'ESD, TVS, or fuse', transistor: 'MOSFET or BJT',
    diode: 'Diode or LED', connector: 'Connector', resistor: 'Resistor', capacitor: 'Capacitor', inductor: 'Inductor or ferrite bead', other: 'Other'
  };
  const ICS = ['ic', 'mcu', 'regulator', 'switch', 'interface', 'analog', 'converter', 'logic', 'driver', 'memory', 'sensor', 'power', 'module', 'supervisor'];

  // Per-pin fields beside role and domain (the Pins tab). Values are short words so checks can read them.
  const RESET_STATES = { '': '', hiz: 'High-Z', analog: 'Analog (high-Z)', low: 'Driven low', high: 'Driven high', 'pull-up': 'Pulled up', 'pull-down': 'Pulled down' };
  const UNUSED = { '': '', float: 'May float', gnd: 'Tie to ground', supply: 'Tie to its supply', pull: 'Pull up or down', must: 'Must be connected' };

  // Pin roles: what a pin is for, which the checks read before its name.
  const ROLES = {
    'power-in': 'Power in', 'power-out': 'Power out', ground: 'Ground', io: 'Digital I/O', input: 'Digital input', output: 'Digital output',
    'open-drain': 'Open drain', analog: 'Analog', 'clock-in': 'Clock or crystal in', 'clock-out': 'Clock or crystal out', reset: 'Reset',
    boot: 'Boot or strap', enable: 'Enable', feedback: 'Feedback', switch: 'Switch node', bootstrap: 'Bootstrap', 'power-good': 'Power good',
    bus: 'Bus line (CAN, RS-485, RS-232, USB data)', nc: 'No connect (may be tied)', dnc: 'Do not connect', pad: 'Exposed pad', other: 'Other'
  };

  const C = [];
  const add = (group, kinds, list) => list.forEach(e => C.push(Object.assign({ group, kinds }, e)));

  add('Supply', ['any'], [
    { k: 'supply.range', label: 'Recommended supply range', unit: 'V', shape: 'range', on: 'domain', hint: 'Recommended operating conditions, per supply pin group (VDD, VDDA, VCC, VIN…)' },
    { k: 'supply.absmax', label: 'Absolute maximum supply', unit: 'V', shape: 'value', on: 'domain' },
    { k: 'supply.absmin', label: 'Absolute minimum supply', unit: 'V', shape: 'value', on: 'domain', hint: 'Usually −0.3 V' },
    { k: 'supply.iq', label: 'Supply current (quiescent or typical)', unit: 'A', shape: 'range', on: 'domain', hint: 'Several modes: the lowest here, the others in Conditions or a note' },
    { k: 'supply.isd', label: 'Shutdown current', unit: 'A', shape: 'range', on: 'domain' },
    { k: 'supply.imax', label: 'Supply current, maximum', unit: 'A', shape: 'value', on: 'domain', hint: 'For budgeting a rail' },
    { k: 'supply.seq', label: 'Supply sequencing rule', unit: '', shape: 'text', on: 'part', hint: 'e.g. "VDDA must not exceed VDD + 0.3 V", "VDDIO before VCORE"' },
    { k: 'supply.slew', label: 'Supply ramp rate limits', unit: 'V/s', shape: 'range', on: 'domain' },
    { k: 'supply.por', label: 'Power-on reset or UVLO, rising', unit: 'V', shape: 'range', on: 'domain' },
    { k: 'supply.por.fall', label: 'Power-on reset or UVLO, falling', unit: 'V', shape: 'range', on: 'domain' },
    { k: 'supply.tied', label: 'Domains that must be tied together', unit: '', shape: 'list', on: 'part', hint: 'e.g. VDD, VDDA when there is no separate analog supply' },
    { k: 'dec.c', label: 'Required decoupling, per pin', unit: 'F', shape: 'value', on: 'domain', hint: 'e.g. 100 nF at each VDD pin' },
    { k: 'dec.bulk', label: 'Required bulk capacitance on the domain', unit: 'F', shape: 'value', on: 'domain' },
    { k: 'dec.note', label: 'Decoupling note', unit: '', shape: 'text', on: 'domain' }
  ]);
  add('Digital I/O', ICS, [
    { k: 'io.vih', label: 'Input high level, guaranteed (VIH)', unit: 'V', shape: 'value', on: 'domain', hint: 'The lowest voltage always read high: a threshold\'s max' },
    { k: 'io.vil', label: 'Input low level, guaranteed (VIL)', unit: 'V', shape: 'value', on: 'domain', hint: 'The highest voltage always read low: a threshold\'s min' },
    { k: 'io.voh', label: 'Output high, minimum (VOH)', unit: 'V', shape: 'value', on: 'domain' },
    { k: 'io.vol', label: 'Output low, maximum (VOL)', unit: 'V', shape: 'value', on: 'domain' },
    { k: 'io.absmax', label: 'Absolute maximum on an I/O pin', unit: 'V', shape: 'value', on: 'domain', hint: 'Often VDD+0.3 V; 5 V tolerant pins are marked in the pin table' },
    { k: 'io.ft.absmax', label: 'Absolute maximum on a 5 V tolerant pin', unit: 'V', shape: 'value', on: 'part' },
    { k: 'io.iout', label: 'Output current per pin, maximum', unit: 'A', shape: 'value', on: 'domain' },
    { k: 'io.itotal', label: 'Total I/O current, maximum', unit: 'A', shape: 'value', on: 'part' },
    { k: 'io.iinj', label: 'Injection current per pin, maximum', unit: 'A', shape: 'value', on: 'part' },
    { k: 'io.pull', label: 'Internal pull-up or pull-down', unit: 'Ω', shape: 'range', on: 'part' },
    { k: 'io.cin', label: 'Input capacitance', unit: 'F', shape: 'value', on: 'part' },
    { k: 'io.default', label: 'Pin state at reset', unit: '', shape: 'text', on: 'part', hint: 'e.g. "all GPIO analog (high-Z) after reset"' }
  ]);
  add('Clocks and timing', ['mcu', 'interface', 'converter', 'module', 'ic', 'crystal'], [
    { k: 'clk.fmax', label: 'Maximum core or system clock', unit: 'Hz', shape: 'value', on: 'part' },
    { k: 'clk.hse', label: 'High-speed crystal or clock input range', unit: 'Hz', shape: 'range', on: 'part' },
    { k: 'clk.lse', label: 'Low-speed crystal frequency', unit: 'Hz', shape: 'value', on: 'part' },
    { k: 'clk.gm', label: 'Oscillator gm critical maximum, per drive setting', unit: 'A/V', shape: 'list', on: 'part', hint: 'e.g. "LSEDRV low 0.5 µA/V; medium-low 0.75 µA/V; …"' },
    { k: 'clk.cpin', label: 'Oscillator pin capacitance (stray)', unit: 'F', shape: 'value', on: 'part' },
    { k: 'clk.ext.vih', label: 'External clock input high level', unit: 'V', shape: 'value', on: 'part' }
  ]);
  add('Reset, boot, and straps', ICS, [
    { k: 'reset.active', label: 'Reset is active', unit: '', shape: 'text', on: 'part', hint: '"low" or "high"' },
    { k: 'reset.pulse', label: 'Minimum reset pulse', unit: 's', shape: 'value', on: 'part' },
    { k: 'reset.pull', label: 'Internal reset pull-up', unit: 'Ω', shape: 'range', on: 'part' },
    { k: 'boot.modes', label: 'Boot or strap pins and what each level selects', unit: '', shape: 'list', on: 'part', hint: 'e.g. "BOOT0 low = flash; high = system bootloader"' },
    { k: 'i2c.addr', label: 'I2C addresses by strap', unit: '', shape: 'list', on: 'part', hint: '7-bit, e.g. "ADDR=GND 0x5F; ADDR=SCL 0x5C"' },
    { k: 'en.vih', label: 'Enable input high threshold', unit: 'V', shape: 'range', on: 'part' },
    { k: 'en.absmax', label: 'Enable pin absolute maximum', unit: 'V', shape: 'value', on: 'part' },
    { k: 'en.default', label: 'Enable state when floating', unit: '', shape: 'text', on: 'part', hint: '"internal pull-down", "must not float"' }
  ]);
  add('Interfaces', ['mcu', 'interface', 'converter', 'memory', 'sensor', 'module', 'ic'], [
    { k: 'i2c.fmax', label: 'I2C clock, maximum', unit: 'Hz', shape: 'value', on: 'part' },
    { k: 'spi.fmax', label: 'SPI clock, maximum', unit: 'Hz', shape: 'value', on: 'part' },
    { k: 'spi.mode', label: 'SPI modes supported', unit: '', shape: 'text', on: 'part' },
    { k: 'uart.baud', label: 'UART baud, maximum', unit: 'Bd', shape: 'value', on: 'part' },
    { k: 'usb.speed', label: 'USB speed', unit: '', shape: 'text', on: 'part' },
    { k: 'usb.rpu', label: 'USB pull-up or CC terminations inside', unit: '', shape: 'text', on: 'part' },
    { k: 'can.vcm', label: 'CAN or RS-485 bus common mode range', unit: 'V', shape: 'range', on: 'part' },
    { k: 'bus.absmax', label: 'Bus pin absolute maximum', unit: 'V', shape: 'range', on: 'part' },
    { k: 'bus.term', label: 'Termination required', unit: '', shape: 'text', on: 'part' },
    { k: 'iso.v', label: 'Isolation rating', unit: 'V', shape: 'value', on: 'part' }
  ]);
  add('Regulator', ['regulator', 'power', 'module'], [
    { k: 'reg.topology', label: 'Topology', unit: '', shape: 'text', on: 'part', hint: 'LDO, buck, boost, buck-boost, charge pump, or isolated' },
    { k: 'reg.vin', label: 'Input range', unit: 'V', shape: 'range', on: 'part' },
    { k: 'reg.vin.absmax', label: 'Input absolute maximum', unit: 'V', shape: 'value', on: 'part' },
    { k: 'reg.vout', label: 'Output voltage (fixed parts)', unit: 'V', shape: 'range', on: 'part' },
    { k: 'reg.vref', label: 'Feedback reference', unit: 'V', shape: 'range', on: 'part', hint: 'Adjustable parts: Vout = Vref × (1 + Rtop/Rbottom) from the divider on the FB pin. Fill it for fixed parts too when stated' },
    { k: 'reg.vout.range', label: 'Adjustable output range', unit: 'V', shape: 'range', on: 'part' },
    { k: 'reg.vout.strap', label: 'Output set by strap resistors', unit: '', shape: 'list', on: 'part', hint: 'One line per setting, the pins\' resistors to GND then the output: "CFG1 = 36.5 kΩ, CFG2 = 0 Ω: 3.3 V". A pin may be high, low, or open: "SEL = high". Pincheck picks the line the board matches (within 3%)' },
    { k: 'reg.iout', label: 'Output current, rated', unit: 'A', shape: 'value', on: 'part' },
    { k: 'reg.ilim', label: 'Current limit (switch or output)', unit: 'A', shape: 'range', on: 'part' },
    { k: 'reg.dropout', label: 'Dropout at rated current', unit: 'V', shape: 'value', on: 'part' },
    { k: 'reg.rdson', label: 'Switch or pass device on resistance', unit: 'Ω', shape: 'range', on: 'part', hint: 'High side in the value, low side in Conditions' },
    { k: 'reg.ton.min', label: 'Minimum on-time', unit: 's', shape: 'value', on: 'part' },
    { k: 'reg.cout.dielectric', label: 'Output capacitor dielectric required', unit: '', shape: 'text', on: 'part' },
    { k: 'reg.fsw', label: 'Switching frequency', unit: 'Hz', shape: 'range', on: 'part' },
    { k: 'reg.uvlo', label: 'Input UVLO, rising', unit: 'V', shape: 'range', on: 'part' },
    { k: 'reg.uvlo.fall', label: 'Input UVLO, falling', unit: 'V', shape: 'range', on: 'part' },
    { k: 'reg.cin', label: 'Input capacitance, minimum (effective)', unit: 'F', shape: 'value', on: 'part' },
    { k: 'reg.cout', label: 'Output capacitance, allowed (effective)', unit: 'F', shape: 'range', on: 'part', hint: 'After DC-bias derating' },
    { k: 'reg.esr', label: 'Output capacitor ESR range', unit: 'Ω', shape: 'range', on: 'part', hint: 'Older LDOs need some ESR to be stable' },
    { k: 'reg.l', label: 'Inductor value, allowed', unit: 'H', shape: 'range', on: 'part' },
    { k: 'reg.l.isat', label: 'Inductor saturation current, minimum', unit: 'A', shape: 'value', on: 'part' },
    { k: 'reg.cboot', label: 'Bootstrap capacitor', unit: 'F', shape: 'value', on: 'part' },
    { k: 'reg.css', label: 'Soft-start capacitor or time', unit: '', shape: 'text', on: 'part' },
    { k: 'reg.pg', label: 'Power good output type', unit: '', shape: 'text', on: 'part', hint: 'Open drain needs a pull-up' },
    { k: 'reg.vfb.absmax', label: 'FB pin absolute maximum', unit: 'V', shape: 'value', on: 'part' }
  ]);
  add('Current sense', ['power', 'analog', 'sensor', 'switch', 'regulator'], [
    { k: 'sense.vfs', label: 'Current-sense full scale', unit: 'V', shape: 'value', on: 'part', hint: 'The sense voltage at full scale (or the protection threshold) across the resistor on CSP and CSN; Pincheck divides it by the resistor' }
  ]);
  add('Switch or protection', ['switch', 'power', 'driver', 'logic', 'analog'], [
    { k: 'sw.vin', label: 'Input range', unit: 'V', shape: 'range', on: 'part' },
    { k: 'sw.ron', label: 'On resistance', unit: 'Ω', shape: 'range', on: 'part' },
    { k: 'sw.iout', label: 'Continuous current, maximum', unit: 'A', shape: 'value', on: 'part' },
    { k: 'sw.ilim', label: 'Current limit (set or fixed)', unit: 'A', shape: 'range', on: 'part', hint: 'With the formula for its setting resistor in the note' },
    { k: 'sw.ilim.k', label: 'Current limit setting constant', unit: 'V', shape: 'value', on: 'part', hint: 'k in ILIM (A) = k / RILM (Ω), for a limit set by a resistor on ILM, ILIM, or ISET to ground (one eFuse family uses 3334)' },
    { k: 'sw.default', label: 'Switch state at power-up', unit: '', shape: 'text', on: 'part', hint: 'For signal switches and muxes: open or closed after power-on, and what closes it ("open; closed by writing register 00h over I2C")' },
    { k: 'sw.ovlo', label: 'Over- and undervoltage thresholds', unit: 'V', shape: 'range', on: 'part' },
    { k: 'sw.rise', label: 'Output rise time', unit: 's', shape: 'range', on: 'part' }
  ]);
  add('Analog', ['analog', 'converter', 'sensor', 'mcu'], [
    { k: 'an.vcm', label: 'Input common mode range', unit: 'V', shape: 'range', on: 'part', hint: 'May be an expression: "VSS-0.1".."VDD-1.2"' },
    { k: 'an.vout', label: 'Output swing', unit: 'V', shape: 'range', on: 'part' },
    { k: 'an.gbw', label: 'Gain bandwidth', unit: 'Hz', shape: 'value', on: 'part' },
    { k: 'an.cload', label: 'Capacitive load, stable up to', unit: 'F', shape: 'value', on: 'part' },
    { k: 'an.gain', label: 'Gain (fixed)', unit: 'V/V', shape: 'value', on: 'part' },
    { k: 'an.vref', label: 'Reference voltage', unit: 'V', shape: 'range', on: 'part' },
    { k: 'adc.vin', label: 'ADC input range', unit: 'V', shape: 'range', on: 'part' },
    { k: 'adc.rsrc', label: 'ADC source impedance, maximum', unit: 'Ω', shape: 'value', on: 'part' },
    { k: 'adc.bits', label: 'ADC resolution', unit: 'bit', shape: 'value', on: 'part' }
  ]);
  add('Crystal or oscillator', ['crystal'], [
    { k: 'xtal.f', label: 'Frequency', unit: 'Hz', shape: 'value', on: 'part' },
    { k: 'xtal.cl', label: 'Load capacitance (CL)', unit: 'F', shape: 'value', on: 'part' },
    { k: 'xtal.esr', label: 'ESR, maximum', unit: 'Ω', shape: 'value', on: 'part' },
    { k: 'xtal.c0', label: 'Shunt capacitance (C0)', unit: 'F', shape: 'value', on: 'part' },
    { k: 'xtal.drive', label: 'Drive level, maximum', unit: 'W', shape: 'value', on: 'part' },
    { k: 'xtal.tol', label: 'Frequency tolerance and stability', unit: 'ppm', shape: 'range', on: 'part' },
    { k: 'osc.vdd', label: 'Oscillator supply range', unit: 'V', shape: 'range', on: 'part' }
  ]);
  add('Discrete ratings', ['transistor', 'diode', 'protection'], [
    { k: 'q.vds', label: 'Drain-source or collector-emitter voltage, maximum', unit: 'V', shape: 'value', on: 'part' },
    { k: 'q.vgs', label: 'Gate-source voltage, maximum (±)', unit: 'V', shape: 'value', on: 'part' },
    { k: 'q.vth', label: 'Gate threshold', unit: 'V', shape: 'range', on: 'part' },
    { k: 'q.rds', label: 'On resistance at the drive used', unit: 'Ω', shape: 'range', on: 'part' },
    { k: 'q.id', label: 'Continuous current, maximum', unit: 'A', shape: 'value', on: 'part' },
    { k: 'q.pd', label: 'Power dissipation, maximum', unit: 'W', shape: 'value', on: 'part' },
    { k: 'd.vr', label: 'Reverse voltage, maximum', unit: 'V', shape: 'value', on: 'part' },
    { k: 'd.if', label: 'Forward current, maximum', unit: 'A', shape: 'value', on: 'part' },
    { k: 'd.vf', label: 'Forward voltage', unit: 'V', shape: 'range', on: 'part' },
    { k: 'tvs.vrwm', label: 'Working voltage (VRWM)', unit: 'V', shape: 'value', on: 'part' },
    { k: 'tvs.vbr', label: 'Breakdown voltage', unit: 'V', shape: 'range', on: 'part' },
    { k: 'tvs.vc', label: 'Clamping voltage', unit: 'V', shape: 'value', on: 'part' },
    { k: 'tvs.cj', label: 'Capacitance per line', unit: 'F', shape: 'value', on: 'part' }
  ]);
  add('Ratings', ['connector', 'resistor', 'capacitor', 'inductor', 'other'], [
    { k: 'rate.v', label: 'Voltage rating', unit: 'V', shape: 'value', on: 'part' },
    { k: 'rate.i', label: 'Current rating (per contact for connectors)', unit: 'A', shape: 'value', on: 'part' },
    { k: 'rate.p', label: 'Power rating', unit: 'W', shape: 'value', on: 'part' },
    { k: 'l.isat', label: 'Saturation current', unit: 'A', shape: 'value', on: 'part' },
    { k: 'l.dcr', label: 'DC resistance, maximum', unit: 'Ω', shape: 'value', on: 'part' }
  ]);
  add('Environment', ['any'], [
    { k: 'temp.range', label: 'Operating temperature', unit: '°C', shape: 'range', on: 'part' },
    { k: 'temp.tj', label: 'Junction temperature, maximum', unit: '°C', shape: 'value', on: 'part' },
    { k: 'theta.ja', label: 'Thermal resistance, junction to ambient', unit: '°C/W', shape: 'value', on: 'part' },
    { k: 'esd.hbm', label: 'ESD, human body model', unit: 'V', shape: 'value', on: 'part' },
    { k: 'esd.cdm', label: 'ESD, charged device model', unit: 'V', shape: 'value', on: 'part' },
    { k: 'msl', label: 'Moisture sensitivity level', unit: '', shape: 'text', on: 'part' },
    { k: 'grade', label: 'Grade or qualification', unit: '', shape: 'text', on: 'part', hint: 'e.g. AEC-Q100 grade 1' }
  ]);

  // From the audit of commercial checkers and review checklists (docs/research/checks-audit.md, 2026-11-12).
  add('Supply', ['any'], [
    { k: 'supply.rel', label: 'Relation between domains', unit: '', shape: 'list', on: 'part', hint: 'e.g. "VDDA ≤ VDD + 0.3 V", "VREF = VDDQ/2"' },
    { k: 'supply.bor', label: 'Brownout reset levels', unit: 'V', shape: 'list', on: 'part' }
  ]);
  add('Digital I/O', ICS, [
    { k: 'io.absmin', label: 'Absolute minimum on an I/O pin', unit: 'V', shape: 'value', on: 'domain', hint: 'Usually −0.3 V' },
    { k: 'io.absmax.off', label: 'Absolute maximum on an I/O pin while the part is unpowered', unit: 'V', shape: 'value', on: 'domain', hint: 'Only when the datasheet states it apart from the usual maximum; otherwise the checks evaluate io.absmax or io.ft.absmax with the supplies at 0 V' },
    { k: 'io.cload', label: 'Load capacitance, maximum', unit: 'F', shape: 'value', on: 'part' },
    { k: 'io.failsafe', label: 'Inputs safe when unpowered (fail-safe)', unit: '', shape: 'text', on: 'part', hint: 'Which pins tolerate a voltage with the part unpowered' }
  ]);
  add('Reset, boot, and straps', ICS, [
    { k: 'reset.c', label: 'Reset pin capacitor (recommended or maximum)', unit: 'F', shape: 'range', on: 'part' },
    { k: 'reset.r', label: 'External reset pull-up', unit: 'Ω', shape: 'range', on: 'part' },
    { k: 'strap.latch', label: 'When straps are read', unit: '', shape: 'text', on: 'part', hint: 'e.g. "rising edge of NRST", "at power-on only"' },
    { k: 'strap.rmax', label: 'Strap pull, largest that still sets the level', unit: 'Ω', shape: 'value', on: 'part' },
    { k: 'strap.shared', label: 'Strap pins that are outputs after reset', unit: '', shape: 'list', on: 'part' },
    { k: 'dbg.pins', label: 'Debug interface and its required pulls', unit: '', shape: 'list', on: 'part', hint: 'e.g. "SWD: SWDIO pull-up inside, SWCLK pull-down inside"' },
    { k: 'en.vil', label: 'Enable input low threshold', unit: 'V', shape: 'range', on: 'part' },
    { k: 'pg.vmax', label: 'Power good pull-up voltage, maximum', unit: 'V', shape: 'value', on: 'part' },
    { k: 'pg.th', label: 'Power good threshold', unit: 'V', shape: 'range', on: 'part', hint: 'Often a percentage of Vout: write it in Conditions' }
  ]);
  add('Interfaces', ['mcu', 'interface', 'converter', 'memory', 'sensor', 'module', 'ic', 'logic'], [
    { k: 'i2c.cin', label: 'I2C pin capacitance', unit: 'F', shape: 'value', on: 'part' },
    { k: 'uart.flow', label: 'UART flow control and naming', unit: '', shape: 'text', on: 'part', hint: 'Is TX the part’s output? RTS/CTS direction' },
    { k: 'usb.vbus.absmax', label: 'VBUS pin absolute maximum', unit: 'V', shape: 'value', on: 'part' },
    { k: 'usbc.role', label: 'USB Type-C role and CC terminations', unit: '', shape: 'text', on: 'part', hint: 'Source, sink, or dual; internal Rp/Rd' },
    { k: 'rs485.ul', label: 'RS-485 unit load', unit: '', shape: 'text', on: 'part' },
    { k: 'bus.cmax', label: 'Line capacitance the interface tolerates', unit: 'F', shape: 'value', on: 'part', hint: 'For choosing the ESD part' },
    { k: 'xlat.va', label: 'Translator A-side supply range', unit: 'V', shape: 'range', on: 'part' },
    { k: 'xlat.vb', label: 'Translator B-side supply range', unit: 'V', shape: 'range', on: 'part' }
  ]);
  add('Regulator', ['regulator', 'power', 'module'], [
    { k: 'reg.fb.ibias', label: 'Feedback input current', unit: 'A', shape: 'value', on: 'part' },
    { k: 'reg.fb.rmax', label: 'Divider resistance, maximum', unit: 'Ω', shape: 'value', on: 'part' },
    { k: 'reg.reverse', label: 'Reverse current or back-feed behavior', unit: '', shape: 'text', on: 'part' },
    { k: 'reg.tss', label: 'Soft-start time', unit: 's', shape: 'range', on: 'part' },
    { k: 'reg.rt', label: 'Timing or frequency resistor formula', unit: '', shape: 'text', on: 'part' },
    { k: 'reg.eff', label: 'Efficiency at the operating point', unit: '%', shape: 'value', on: 'part' }
  ]);
  add('Switch or protection', ['switch', 'power', 'driver', 'logic', 'analog'], [
    { k: 'sw.vin.absmax', label: 'Input absolute maximum', unit: 'V', shape: 'value', on: 'part' },
    { k: 'sw.cload', label: 'Load capacitance, maximum (inrush)', unit: 'F', shape: 'value', on: 'part' },
    { k: 'sw.reverse', label: 'Reverse blocking', unit: '', shape: 'text', on: 'part' },
    { k: 'sw.qod', label: 'Quick output discharge', unit: '', shape: 'text', on: 'part' }
  ]);
  add('Supervisor', ['supervisor'], [
    { k: 'sup.vth', label: 'Monitored threshold', unit: 'V', shape: 'range', on: 'part' },
    { k: 'sup.hyst', label: 'Hysteresis', unit: 'V', shape: 'value', on: 'part' },
    { k: 'sup.tdelay', label: 'Reset timeout', unit: 's', shape: 'range', on: 'part' },
    { k: 'sup.out', label: 'Output type and polarity', unit: '', shape: 'text', on: 'part', hint: 'Push-pull or open drain; active low or high' },
    { k: 'sup.mr', label: 'Manual reset input', unit: '', shape: 'text', on: 'part' }
  ]);
  add('Analog', ['analog', 'converter', 'sensor', 'mcu'], [
    { k: 'an.rr', label: 'Rail-to-rail', unit: '', shape: 'text', on: 'part', hint: 'in, out, both, or none' },
    { k: 'an.vin.absmax', label: 'Input absolute limits', unit: 'V', shape: 'range', on: 'part' },
    { k: 'an.vdiff', label: 'Differential input, maximum', unit: 'V', shape: 'value', on: 'part' },
    { k: 'an.cmp.out', label: 'Comparator output type', unit: '', shape: 'text', on: 'part' },
    { k: 'adc.vref', label: 'ADC reference range', unit: 'V', shape: 'range', on: 'part' },
    { k: 'adc.csample', label: 'ADC sampling capacitance', unit: 'F', shape: 'value', on: 'part' },
    { k: 'vref.cload', label: 'Reference output capacitor, stable range', unit: 'F', shape: 'range', on: 'part' },
    { k: 'vref.iout', label: 'Reference output current, maximum', unit: 'A', shape: 'value', on: 'part' },
    { k: 'dac.vout', label: 'DAC output range', unit: 'V', shape: 'range', on: 'part' }
  ]);
  add('Crystal or oscillator', ['crystal'], [
    { k: 'xtal.stab', label: 'Stability over temperature', unit: 'ppm', shape: 'range', on: 'part' },
    { k: 'xtal.pull', label: 'Pullability', unit: 'ppm/F', shape: 'value', on: 'part' },
    { k: 'osc.out', label: 'Oscillator output type and levels', unit: '', shape: 'text', on: 'part' },
    { k: 'osc.idd', label: 'Oscillator supply current', unit: 'A', shape: 'value', on: 'part' }
  ]);
  add('Discrete ratings', ['transistor', 'diode', 'protection'], [
    { k: 'q.type', label: 'Type', unit: '', shape: 'text', on: 'part', hint: 'N-MOSFET, P-MOSFET, NPN, or PNP' },
    { k: 'q.hfe', label: 'Current gain, minimum', unit: '', shape: 'value', on: 'part' },
    { k: 'q.vbesat', label: 'Base-emitter saturation voltage', unit: 'V', shape: 'value', on: 'part' },
    { k: 'd.ifsm', label: 'Surge forward current', unit: 'A', shape: 'value', on: 'part' },
    { k: 'd.trr', label: 'Reverse recovery time', unit: 's', shape: 'value', on: 'part' },
    { k: 'd.vz', label: 'Zener voltage', unit: 'V', shape: 'range', on: 'part' },
    { k: 'led.if', label: 'LED forward current, recommended and maximum', unit: 'A', shape: 'range', on: 'part' },
    { k: 'opto.ctr', label: 'Optocoupler current transfer ratio, minimum', unit: '%', shape: 'value', on: 'part' },
    { k: 'tvs.ipp', label: 'Peak pulse current', unit: 'A', shape: 'value', on: 'part' },
    { k: 'tvs.ppp', label: 'Peak pulse power', unit: 'W', shape: 'value', on: 'part' },
    { k: 'tvs.dir', label: 'Unidirectional or bidirectional', unit: '', shape: 'text', on: 'part' },
    { k: 'tvs.iec', label: 'IEC 61000-4-2 rating (contact)', unit: 'V', shape: 'value', on: 'part' },
    { k: 'tvs.lines', label: 'Which pins protect which line', unit: '', shape: 'list', on: 'part' }
  ]);
  add('Ratings', ['connector', 'resistor', 'capacitor', 'inductor', 'other', 'protection'], [
    { k: 'conn.dwv', label: 'Dielectric withstanding voltage', unit: 'V', shape: 'value', on: 'part' },
    { k: 'conn.mates', label: 'Mates with', unit: '', shape: 'text', on: 'part', hint: 'The mating part number, for cross-board pin checks' },
    { k: 'tol', label: 'Tolerance', unit: '%', shape: 'value', on: 'part' },
    { k: 'tcr', label: 'Temperature coefficient', unit: 'ppm/°C', shape: 'value', on: 'part' },
    { k: 'cap.dielectric', label: 'Dielectric', unit: '', shape: 'text', on: 'part', hint: 'C0G, X7R, X5R, tantalum, polymer, aluminum' },
    { k: 'cap.dcbias', label: 'Capacitance under DC bias', unit: '', shape: 'list', on: 'part', hint: 'Points like "3.3 V: 6.1 µF"' },
    { k: 'cap.esr', label: 'ESR', unit: 'Ω', shape: 'value', on: 'part' },
    { k: 'cap.ripple', label: 'Ripple current', unit: 'A', shape: 'value', on: 'part' },
    { k: 'cap.life', label: 'Life at rated temperature', unit: 'h', shape: 'value', on: 'part' },
    { k: 'l.irms', label: 'Rated (heating) current', unit: 'A', shape: 'value', on: 'part' },
    { k: 'fb.z', label: 'Ferrite impedance at 100 MHz', unit: 'Ω', shape: 'value', on: 'part' },
    { k: 'fuse.i2t', label: 'Fuse melting I²t', unit: 'A²s', shape: 'value', on: 'part' },
    { k: 'ntc.r25', label: 'Thermistor resistance at 25 °C', unit: 'Ω', shape: 'value', on: 'part' },
    { k: 'ntc.beta', label: 'Thermistor B value', unit: 'K', shape: 'value', on: 'part' },
    { k: 'relay.coil', label: 'Relay coil voltage range', unit: 'V', shape: 'range', on: 'part' }
  ]);
  add('Environment', ['any'], [
    { k: 'theta.jc', label: 'Thermal resistance, junction to case', unit: '°C/W', shape: 'value', on: 'part' },
    { k: 'lifecycle', label: 'Lifecycle status', unit: '', shape: 'text', on: 'part', hint: 'Active, NRND, last time buy, or obsolete, with the date seen' }
  ]);

  const byKey = new Map(C.map(e => [e.k, e]));
  const forKind = kind => C.filter(e => e.kinds.includes('any') || e.kinds.includes(kind) || (kind === 'mcu' && e.kinds.includes('ic')));

  // SI prefixes for showing and typing values: "4.7u", "4.7 µF", "100n", "3V3", "1k5".
  const PRE = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
  // `unit`, if given, is stripped from the end first ("500 nA/V" with unit "A/V" is 500e-9).
  function parseNum(s, unit) {
    if (s == null) return null;
    if (typeof s === 'number') return s;
    let t = String(s).trim().replace(/\s+/g, '');
    if (unit && t.endsWith(unit) && t.length > unit.length) t = t.slice(0, -unit.length);
    t = t.replace(/[ΩVAWFHz°C%]+$/i, '').replace(/ohms?$/i, '');
    if (t === '') return null;
    const rk = /^(\d+)([pnuµmkKMGRVr])(\d+)$/.exec(t); // 4k7, 3V3, 1R5
    if (rk) return +(parseFloat(rk[1] + '.' + rk[3]) * (/[RVr]/.test(rk[2]) ? 1 : PRE[rk[2]])).toPrecision(12);
    const m = /^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)([pnuµmkKMG]?)$/i.exec(t);
    if (!m) return null;
    return +(parseFloat(m[1]) * (m[2] ? PRE[m[2]] : 1)).toPrecision(12);
  }
  function fmt(v, unit) {
    if (v == null || v === '') return '';
    if (typeof v !== 'number') return String(v);
    if (v === 0) return '0' + (unit ? ' ' + unit : '');
    if (!unit || /^(°C|ppm|bit|V\/V|°C\/W|Bd|%|ppm\/°C|K|h|A²s)$/.test(unit)) return +v.toPrecision(4) + (unit ? ' ' + unit : '');
    const a = Math.abs(v);
    const steps = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
    const [f, p] = steps.find(([f]) => a >= f * 0.9999) || steps[steps.length - 1];
    return +(v / f).toPrecision(4) + ' ' + p + unit;
  }

  PK.params = { CATALOG: C, byKey, forKind, KINDS, ICS, ROLES, RESET_STATES, UNUSED, parseNum, fmt };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
