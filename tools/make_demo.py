"""Make Pincheck's demo: the made-up Smart Thermostat's Main PCBA (DT-1042 rev B, the board Fabcheck's and
Signoff EE's demos use) as a KiCad XML netlist, and a small part library.

    python tools/make_demo.py

Writes demo/thermostat-main-pcba.xml and demo/library/*.json (with index.json). Pin numbers and names
follow the real parts' datasheets; the circuit is made up. Library values are datasheet facts, left
unverified except where the demo story says someone checked them.

Planted for the checks (tests/test.js expects them): UART TX to TX (func.uart) and DISP_INT and TOUCH_INT
on EXTI line 4 (func.exti).
"""
import json, pathlib
from xml.sax.saxutils import quoteattr, escape

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "demo"

# ref: (lib part, value, MPN, manufacturer, description, footprint, {pin: (name, kicad type)})
P = lambda *names: {str(i + 1): (n, 'passive') for i, n in enumerate(names)}
STM = {  # STM32G071KBU6, UFQFPN32 (pin 33 the exposed pad)
    '1': ('PB9', 'bidirectional'), '2': ('PC14-OSC32_IN', 'bidirectional'), '3': ('PC15-OSC32_OUT', 'bidirectional'), '4': ('VDD/VDDA', 'power_in'),
    '5': ('VSS/VSSA', 'power_in'), '6': ('PF2-NRST', 'bidirectional'), '7': ('PA0', 'bidirectional'), '8': ('PA1', 'bidirectional'), '9': ('PA2', 'bidirectional'),
    '10': ('PA3', 'bidirectional'), '11': ('PA4', 'bidirectional'), '12': ('PA5', 'bidirectional'), '13': ('PA6', 'bidirectional'), '14': ('PA7', 'bidirectional'),
    '15': ('PB0', 'bidirectional'), '16': ('PB1', 'bidirectional'), '17': ('PB2', 'bidirectional'), '18': ('PA8', 'bidirectional'), '19': ('PA9', 'bidirectional'),
    '20': ('PC6', 'bidirectional'), '21': ('PA10', 'bidirectional'), '22': ('PA11', 'bidirectional'), '23': ('PA12', 'bidirectional'), '24': ('PA13', 'bidirectional'),
    '25': ('PA14-BOOT0', 'bidirectional'), '26': ('PA15', 'bidirectional'), '27': ('PB3', 'bidirectional'), '28': ('PB4', 'bidirectional'), '29': ('PB5', 'bidirectional'),
    '30': ('PB6', 'bidirectional'), '31': ('PB7', 'bidirectional'), '32': ('PB8', 'bidirectional'), '33': ('VSS', 'power_in')}
TPS = {'1': ('GND', 'power_in'), '2': ('SW', 'power_out'), '3': ('VIN', 'power_in'), '4': ('VFB', 'input'), '5': ('EN', 'input'), '6': ('VBST', 'passive')}
ESP = {str(n): ('GND', 'power_in') for n in [1, 2, 11, 14] + list(range(36, 54))}
ESP.update({'3': ('3V3', 'power_in'), '5': ('IO2', 'bidirectional'), '6': ('IO3', 'bidirectional'), '8': ('EN', 'input'), '12': ('IO0', 'bidirectional'),
            '13': ('IO1', 'bidirectional'), '16': ('IO10', 'bidirectional'), '18': ('IO4', 'bidirectional'), '19': ('IO5', 'bidirectional'), '20': ('IO6', 'bidirectional'),
            '21': ('IO7', 'bidirectional'), '22': ('IO8', 'bidirectional'), '23': ('IO9', 'bidirectional'), '26': ('IO18', 'bidirectional'), '27': ('IO19', 'bidirectional'),
            '30': ('RXD0', 'input'), '31': ('TXD0', 'output')})
for n in [4, 7, 9, 10, 15, 17, 24, 25, 28, 29, 32, 33, 34, 35]:
    ESP[str(n)] = ('NC', 'no_connect')
RES = lambda v, code: ('R', v, 'RC0402FR-07' + code + 'L', 'Yageo', 'RES SMD %s 1%% 1/16W 0402' % v, 'Resistor_SMD:R_0402_1005Metric', P('1', '2'))
C100N = ('C', '100nF', 'GRM155R71C104KA88D', 'Murata', 'CAP CER 0.1UF 16V X7R 0402', 'Capacitor_SMD:C_0402_1005Metric', P('1', '2'))
PARTS = {
    'J1': ('TerminalBlock_2', 'MKDS 1,5/2-5,08', '1729128', 'Phoenix Contact', 'TERM BLK 2POS SIDE ENTRY 5.08MM PCB', 'TerminalBlock:PhoenixContact_MKDS-1,5-2-5.08', P('1', '2')),
    'F1': ('Fuse', 'TR5 1A T', '37211000411', 'Littelfuse', 'FUSE BRD MNT 1A 250VAC RADIAL TR5', 'Fuse:Fuse_Littelfuse-TR5', P('1', '2')),
    'RV1': ('Varistor', 'V275LA4P', 'V275LA4P', 'Littelfuse', 'VARISTOR 430V 1.2KA DISC 7MM', 'Varistor:RV_Disc_D7mm', P('1', '2')),
    'PS1': ('RAC02-05SK', 'RAC02-05SK', 'RAC02-05SK', 'RECOM Power', 'AC/DC CONVERTER 5V 2W SIP-4', 'Converter_ACDC:RECOM_RAC02-xxSK', {'1': ('AC/L', 'power_in'), '2': ('AC/N', 'power_in'), '3': ('+VOUT', 'power_out'), '4': ('-VOUT', 'power_out')}),
    'K1': ('Relay_SPST', 'HF46F-G/5-HS1', 'HF46F-G/5-HS1', 'Hongfa', 'RELAY GEN PURPOSE SPST 5A 5V', 'Relay_THT:Relay_SPST_Hongfa_HF46F-G', P('A1', 'A2', 'COM', 'NO')),
    'K2': ('Relay_SPST', 'HF46F-G/5-HS1', 'HF46F-G/5-HS1', 'Hongfa', 'RELAY GEN PURPOSE SPST 5A 5V', 'Relay_THT:Relay_SPST_Hongfa_HF46F-G', P('A1', 'A2', 'COM', 'NO')),
    'J4': ('TerminalBlock_3', 'MKDS 1,5/3-5,08', '1729131', 'Phoenix Contact', 'TERM BLK 3POS SIDE ENTRY 5.08MM PCB', 'TerminalBlock:PhoenixContact_MKDS-1,5-3-5.08', P('1', '2', '3')),
    'Q1': ('Q_NPN_BEC', 'MMBT3904LT1G', 'MMBT3904LT1G', 'onsemi', 'TRANS NPN 40V 0.2A SOT23', 'Package_TO_SOT_SMD:SOT-23', P('B', 'E', 'C')),
    'Q2': ('Q_NPN_BEC', 'MMBT3904LT1G', 'MMBT3904LT1G', 'onsemi', 'TRANS NPN 40V 0.2A SOT23', 'Package_TO_SOT_SMD:SOT-23', P('B', 'E', 'C')),
    'D1': ('D', '1N4148W-7-F', '1N4148W-7-F', 'Diodes Incorporated', 'DIODE GEN PURP 100V 300MA SOD123', 'Diode_SMD:D_SOD-123', P('K', 'A')),
    'D2': ('D', '1N4148W-7-F', '1N4148W-7-F', 'Diodes Incorporated', 'DIODE GEN PURP 100V 300MA SOD123', 'Diode_SMD:D_SOD-123', P('K', 'A')),
    'R1': RES('1k', '1K'), 'R2': RES('1k', '1K'),
    'U7': ('TPS562201', 'TPS562201DDCR', 'TPS562201DDCR', 'Texas Instruments', 'IC REG BUCK ADJ 2A SOT23-6', 'Package_TO_SOT_SMD:SOT-23-6', TPS),
    'L1': ('L', '2.2uH', 'XAL4020-222MEB', 'Coilcraft', 'FIXED IND 2.2UH 5.5A 35 MOHM SMD', 'Inductor_SMD:L_Coilcraft_XAL4020-222', P('1', '2')),
    'C1': ('C', '10uF', 'CL21A106KAYNNNE', 'Samsung', 'CAP CER 10UF 25V X5R 0805', 'Capacitor_SMD:C_0805_2012Metric', P('1', '2')),
    'C2': ('C', '22uF', 'CL21A226MAQNNNE', 'Samsung', 'CAP CER 22UF 25V X5R 0805', 'Capacitor_SMD:C_0805_2012Metric', P('1', '2')),
    'C3': C100N, 'C13': C100N, 'R5': RES('33.2k', '33K2'), 'R6': RES('10k', '10K'),
    'U4': ('STM32G071KBUx', 'STM32G071KBU6', 'STM32G071KBU6', 'STMicroelectronics', 'IC MCU 32BIT 128KB FLASH 32UFQFPN', 'Package_DFN_QFN:QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm', STM),
    'C4': C100N, 'C5': C100N, 'C6': C100N,
    'C41': ('C', '1uF', '', '', 'CAP CER 1UF 10V X5R 0402', 'Capacitor_SMD:C_0402_1005Metric', P('1', '2')),
    'R12': RES('2.2k', '2K2'), 'R13': RES('2.2k', '2K2'),
    'U1': ('ESP32-C3-MINI-1', 'ESP32-C3-MINI-1-N4', 'ESP32-C3-MINI-1-N4', 'Espressif Systems', 'RF TXRX MOD WIFI/BT SMD 4MB', 'RF_Module:ESP32-C3-MINI-1', ESP),
    'C8': ('C', '10uF', 'CL21A106KAYNNNE', 'Samsung', 'CAP CER 10UF 25V X5R 0805', 'Capacitor_SMD:C_0805_2012Metric', P('1', '2')), 'C9': C100N,
    'J3': ('USB_C_Receptacle_PowerOnly', 'USB4105-GF-A', 'USB4105-GF-A', 'GCT', 'CONN RCPT USB2.0 TYPE-C 16POS SMD', 'Connector_USB:USB_C_Receptacle_GCT_USB4105',
           {'A1': ('GND', 'passive'), 'B1': ('GND', 'passive'), 'A4': ('VBUS', 'passive'), 'B4': ('VBUS', 'passive'), 'A5': ('CC1', 'bidirectional'), 'B5': ('CC2', 'bidirectional'), 'S1': ('SHIELD', 'passive')}),
    'R14': RES('5.1k', '5K1'), 'R15': RES('5.1k', '5K1'),
    'J2': ('FFC_24', 'FH12-24S-0.5SH(55)', 'FH12-24S-0.5SH(55)', 'Hirose', 'CONN FFC BOTTOM 24POS 0.50MM R/A', 'Connector_FFC-FPC:Hirose_FH12-24S-0.5SH_1x24-1MP_P0.50mm_Horizontal', P(*[str(i) for i in range(1, 25)])),
    'D3': ('LED', 'Green', '150060GS75000', 'Wurth Elektronik', 'LED GREEN CLEAR 0603 SMD', 'LED_SMD:LED_0603_1608Metric', P('K', 'A')),
    'D4': ('LED', 'Red', '150060RS75000', 'Wurth Elektronik', 'LED RED CLEAR 0603 SMD', 'LED_SMD:LED_0603_1608Metric', P('K', 'A')),
    'R16': RES('1k', '1K'), 'R17': RES('1k', '1K'),
}
NETS = {
    'AC_L': ['J1.1', 'F1.1'], 'AC_LF': ['F1.2', 'RV1.1', 'PS1.1', 'K1.COM', 'K2.COM', 'J4.2'], 'AC_N': ['J1.2', 'RV1.2', 'PS1.2'],
    'OUT1': ['K1.NO', 'J4.3'], 'OUT2': ['K2.NO', 'J4.1'],
    'GND': ['PS1.-VOUT', 'Q1.E', 'Q2.E', 'U7.1', 'C1.2', 'C2.2', 'C3.2', 'R6.2', 'U4.5', 'U4.33', 'C4.2', 'C5.2', 'C6.2', 'C41.2', 'C8.2', 'C9.2',
            'J3.A1', 'J3.B1', 'J3.S1', 'R14.2', 'R15.2', 'J2.1', 'J2.24', 'D3.K', 'D4.K'] + ['U1.%s' % n for n in [1, 2, 11, 14] + list(range(36, 54))],
    '5V': ['PS1.+VOUT', 'K1.A1', 'K2.A1', 'D1.K', 'D2.K', 'U7.3', 'U7.5', 'C1.1', 'C3.1', 'J3.A4', 'J3.B4'],
    '3V3': ['L1.2', 'C2.1', 'R5.1', 'U4.4', 'C4.1', 'C5.1', 'C6.1', 'C41.1', 'U1.3', 'U1.8', 'C8.1', 'C9.1', 'R12.1', 'R13.1', 'J2.2', 'J2.3'],
    'SW': ['U7.2', 'L1.1', 'C13.2'], 'BST': ['U7.6', 'C13.1'], 'FB': ['U7.4', 'R5.2', 'R6.1'],
    'RLY1': ['K1.A2', 'D1.A', 'Q1.C'], 'RLY2': ['K2.A2', 'D2.A', 'Q2.C'], 'RLY1_B': ['Q1.B', 'R1.1'], 'RLY2_B': ['Q2.B', 'R2.1'],
    'RLY1_EN': ['R1.2', 'U4.7'], 'RLY2_EN': ['R2.2', 'U4.8'],
    'I2C_SCL': ['R12.2', 'U4.32', 'J2.5'], 'I2C_SDA': ['R13.2', 'U4.1', 'J2.6'],
    # Planted for the checks: the UART crosses wrong (U4's TX meets the module's TXD0), and two
    # interrupt lines from the display connector share EXTI line 4 (PA4 and PB4).
    'UART_TX': ['U4.30', 'U1.31'], 'UART_RX': ['U4.31', 'U1.30'],
    'DISP_INT': ['J2.7', 'U4.11'], 'TOUCH_INT': ['J2.8', 'U4.28'],
    'CC1': ['J3.A5', 'R14.1'], 'CC2': ['J3.B5', 'R15.1'],
    'LED_G': ['D3.A', 'R16.1'], 'LED_R': ['D4.A', 'R17.1'], 'LED_GA': ['R16.2', 'U4.12'], 'LED_RA': ['R17.2', 'U4.13'],
    'NRST': ['U4.6'], 'SWDIO': ['U4.24'], 'SWCLK': ['U4.25'],
}


def pin_num(ref, key):
    pins = PARTS[ref][6]
    if key in pins:
        return key
    for n, (name, _) in pins.items():
        if name == key:
            return n
    raise SystemExit('no pin %s on %s' % (key, ref))


def netlist():
    q = quoteattr
    out = ['<?xml version="1.0" encoding="utf-8"?>', '<export version="E">', '  <design>', '    <source>thermostat-main-pcba.kicad_sch</source>',
           '    <date>2026-11-12</date>', '    <tool>Eeschema 8.0.6</tool>', '  </design>', '  <components>']
    for ref, (lib, val, mpn, mfr, desc, fp, pins) in PARTS.items():
        out.append('    <comp ref=%s>' % q(ref))
        out.append('      <value>%s</value>' % escape(val))
        out.append('      <footprint>%s</footprint>' % escape(fp))
        if mpn:
            out.append('      <fields>\n        <field name="MPN">%s</field>\n        <field name="Manufacturer">%s</field>\n      </fields>' % (escape(mpn), escape(mfr)))
        out.append('      <libsource lib="thermostat" part=%s description=%s/>' % (q(lib + ('' if lib in ('R', 'C', 'L', 'D', 'LED') else '')), q(desc)))
        out.append('      <sheetpath names="/" tstamps="/"/>')
        out.append('    </comp>')
    out.append('  </components>')
    out.append('  <libparts>')
    seen = set()
    for ref, (lib, val, mpn, mfr, desc, fp, pins) in PARTS.items():
        if lib in seen:
            continue
        seen.add(lib)
        out.append('    <libpart lib="thermostat" part=%s>' % q(lib))
        out.append('      <description>%s</description>' % escape(desc))
        out.append('      <pins>')
        for n, (name, t) in pins.items():
            out.append('        <pin num=%s name=%s type=%s/>' % (q(n), q(name), q(t)))
        out.append('      </pins>')
        out.append('    </libpart>')
    out.append('  </libparts>')
    out.append('  <nets>')
    for code, (name, nodes) in enumerate(NETS.items(), 1):
        out.append('    <net code="%d" name=%s>' % (code, q('/' + name)))
        for node in nodes:
            ref, key = node.split('.', 1)
            n = pin_num(ref, key)
            nm, t = PARTS[ref][6][n]
            out.append('      <node ref=%s pin=%s pinfunction=%s pintype=%s/>' % (q(ref), q(n), q(nm), q(t)))
        out.append('    </net>')
    out.append('  </nets>')
    out.append('</export>')
    return '\n'.join(out) + '\n'


def v(k, unit, on=None, ok=False, src='datasheet', **vals):
    d = {'k': k}
    if on:
        d['on'] = on
    d.update(vals)
    d['unit'] = unit
    d['src'] = src
    if ok:
        d['ok'] = {'by': '@demo-reviewer', 'at': '2026-11-10T15:00:00Z'}
    return d


ROLE = {'PF2-NRST': 'reset', 'PA14-BOOT0': 'boot', 'PC14-OSC32_IN': 'clock-in', 'PC15-OSC32_OUT': 'clock-out'}
AF = {  # a few alternate functions, as the CubeMX import would list them
    'PB8': ['I2C1_SCL AF6', 'USART3_TX AF4', 'EXTI8'], 'PB9': ['I2C1_SDA AF6', 'USART3_RX AF4', 'EXTI9'],
    'PB6': ['USART1_TX AF0', 'I2C1_SCL AF6', 'EXTI6'], 'PB7': ['USART1_RX AF0', 'I2C1_SDA AF6', 'EXTI7'],
    'PA0': ['ADC1_IN0', 'USART2_CTS AF1', 'EXTI0'], 'PA1': ['ADC1_IN1', 'USART2_RTS AF1', 'EXTI1'],
    'PA5': ['ADC1_IN5', 'SPI1_SCK AF0', 'EXTI5'], 'PA6': ['ADC1_IN6', 'SPI1_MISO AF0', 'EXTI6'],
    'PA4': ['ADC1_IN4', 'SPI1_NSS AF0', 'EXTI4'], 'PB4': ['SPI1_MISO AF0', 'TIM3_CH1 AF1', 'EXTI4'],
    'PA13': ['SWDIO AF0', 'EXTI13'], 'PA14-BOOT0': ['SWCLK AF0', 'BOOT0', 'EXTI14']}


def library():
    stm_pins = []
    for n, (name, t) in STM.items():
        p = {'num': n, 'name': name}
        if name == 'VDD/VDDA':
            p.update(role='power-in', domain='VDD')
        elif name.startswith('VSS'):
            p.update(role='pad' if n == '33' else 'ground')
        else:
            p.update(role=ROLE.get(name, 'io'), domain='VDD')
        if name in AF:
            p['functions'] = AF[name]
        stm_pins.append(p)
    stm = {
        'schema': 'pincheck.part/1', 'id': 'stm32g071kbu6', 'mpn': 'STM32G071KBU6', 'match': ['STM32G071K8U6', 'STM32G071K6U6'],
        'manufacturer': 'STMicroelectronics', 'kind': 'mcu', 'description': 'Arm Cortex-M0+ MCU, 128 KB flash, 36 KB RAM, UFQFPN32',
        'package': 'UFQFPN32', 'datasheet': {'title': 'STM32G071x8/xB datasheet', 'rev': 'DS12232', 'url': 'https://www.st.com/resource/en/datasheet/stm32g071kb.pdf', 'sha256': ''},
        'pins': stm_pins, 'domains': ['VDD'],
        'values': [
            v('supply.range', 'V', on='VDD', ok=True, src='import:cubemx', min=1.7, max=3.6),
            v('supply.absmax', 'V', on='VDD', value=4.0),
            v('io.vih', 'V', on='VDD', value='0.7*VDD'),
            v('io.vil', 'V', on='VDD', value='0.3*VDD'),
            v('clk.fmax', 'Hz', ok=True, src='import:cubemx', value=64e6),
            v('temp.range', '°C', src='import:cubemx', min=-40, max=125, cond='The family; suffix 6 is -40 to 85 °C'),
            {'k': 'dec.c', 'on': 'VDD', 'value': 100e-9, 'unit': 'F', 'src': 'datasheet', 'note': 'Plus bulk on the board'},
        ],
        'made': {'by': '@demo-reviewer', 'at': '2026-11-10T14:00:00Z', 'how': 'import:cubemx, then by hand'}, 'updated': '2026-11-10T15:00:00Z'}
    tps = {
        'schema': 'pincheck.part/1', 'id': 'tps562201ddcr', 'mpn': 'TPS562201DDCR', 'match': ['TPS562201DDCT'],
        'manufacturer': 'Texas Instruments', 'kind': 'regulator', 'description': '4.5-V to 17-V input, 2-A synchronous step-down converter, SOT-23-6',
        'package': 'SOT-23-6 (DDC)', 'datasheet': {'title': 'TPS56220x 4.5-V to 17-V Input, 2-A Synchronous Step-Down Voltage Regulator', 'rev': 'SLVSCZ1', 'url': 'https://www.ti.com/lit/ds/symlink/tps562201.pdf', 'sha256': ''},
        'pins': [{'num': '1', 'name': 'GND', 'role': 'ground'}, {'num': '2', 'name': 'SW', 'role': 'switch'}, {'num': '3', 'name': 'VIN', 'role': 'power-in', 'domain': 'VIN'},
                 {'num': '4', 'name': 'VFB', 'role': 'feedback'}, {'num': '5', 'name': 'EN', 'role': 'enable'}, {'num': '6', 'name': 'VBST', 'role': 'bootstrap'}],
        'domains': ['VIN'],
        'values': [
            {'k': 'reg.topology', 'text': 'Synchronous buck', 'unit': '', 'src': 'datasheet'},
            v('reg.vin', 'V', ok=True, min=4.5, max=17),
            v('reg.vref', 'V', ok=True, typ=0.768),
            v('reg.iout', 'A', value=2),
            v('reg.fsw', 'Hz', typ=580e3),
        ],
        'made': {'by': '@demo-reviewer', 'at': '2026-11-10T14:30:00Z', 'how': 'llm (pincheck-part skill), then checked'}, 'updated': '2026-11-10T15:10:00Z'}
    return [stm, tps]


def main():
    (OUT / 'library').mkdir(parents=True, exist_ok=True)
    (OUT / 'thermostat-main-pcba.xml').write_text(netlist(), encoding='utf-8', newline='\n')
    names = []
    for f in library():
        name = f['id'] + '.json'
        (OUT / 'library' / name).write_text(json.dumps(f, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
        names.append(name)
    (OUT / 'library' / 'index.json').write_text(json.dumps(names, indent=2) + '\n', encoding='utf-8', newline='\n')
    print('wrote', OUT / 'thermostat-main-pcba.xml', 'and', len(names), 'library files')


if __name__ == '__main__':
    main()
