"""Make (or fill) a Pincheck part file for an STM32 from STM32CubeMX's database on this computer.

    python tools/import_cubemx.py STM32G071KBU6                       print the part file
    python tools/import_cubemx.py STM32G071KBU6 --out stm32g071kbu6.json
    python tools/import_cubemx.py STM32G071KBU6 --merge exported.json --out stm32g071kbu6.json

What CubeMX gives: the pins in the package (number, name, and type), each pin's signals with their
alternate-function numbers, the EXTI line, the supply range, the temperature range, and the maximum
clock. Everything it writes is marked unverified (src "import:cubemx"). What it doesn't give (absolute
maximums, VIH/VIL, injection current, decoupling, oscillator gm, 5 V tolerance) comes from the
datasheet, by hand or with the pincheck-part skill.

--merge keeps an existing file's values and pin fields (from the schematic or a person) and only adds
what's missing. CubeMX's database is ST's: its data goes only into the private library, never a
public repo.
"""
import argparse, glob, json, os, re, sys, xml.etree.ElementTree as ET
from datetime import datetime, timezone

NS = {'m': 'http://mcd.rou.st.com/modules.php?name=mcu'}
DEFAULT_DIRS = [os.path.expandvars(r'%LOCALAPPDATA%\Programs\STM32CubeMX\db\mcu'), r'C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeMX\db\mcu',
                os.path.expanduser('~/STM32CubeMX/db/mcu'), '/opt/st/stm32cubemx/db/mcu']


def find_db(given):
    for d in ([given] if given else []) + DEFAULT_DIRS:
        if d and os.path.isfile(os.path.join(d, 'families.xml')):
            return d
    sys.exit('STM32CubeMX database not found; pass --cubemx <path to db/mcu>')


def name_regex(name, tail):
    # "STM32G071K(6-8-B)Ux" → STM32G071K(?:6|8|B)U[0-9A-Z]; the x is the temperature range digit.
    r = re.sub(r'\(([^)]*)\)', lambda m: '(?:' + '|'.join(map(re.escape, m.group(1).split('-'))) + ')', name)
    r = r.replace('x', '[0-9A-Z]')
    return re.compile('^' + r + ('[A-Z0-9]*' if tail else '') + '$')


def find_mcu(db, mpn):
    mpn = mpn.upper().replace(' ', '')
    base = re.sub(r'(TR|/TR|#?)$', '', mpn)
    fam = ET.parse(os.path.join(db, 'families.xml')).getroot()
    names = sorted({m.get('Name') for m in fam.iter('Mcu')}, key=len, reverse=True)
    for tail in (False, True):
        for n in names:
            if name_regex(n, tail).match(base):
                return n
    sys.exit('No CubeMX part matches %s' % mpn)


def clean_pin(name):
    name = re.sub(r'\s*\([^)]*\)$', '', name)               # "PC14-OSC32_IN (PC14)", "NRST (NRST)"
    return re.sub(r'\s*-\s*', '-', name).strip()          # "PF2 - NRST"


def role_of(name, typ):
    n = name.upper()
    if typ == 'Power':
        if re.match(r'^(VSS|VREF-|GND)', n):
            return 'ground'
        if re.match(r'^(VCAP|VDD11|VLXSMPS|VDDCORE)', n):
            return 'power-out'
        return 'power-in'
    if typ == 'Reset' or 'NRST' in n:
        return 'reset'
    if typ == 'Boot' or 'BOOT' in n:
        return 'boot'
    if re.search(r'OSC(32)?_IN|OSC_IN', n):
        return 'clock-in'
    if re.search(r'OSC(32)?_OUT|OSC_OUT', n):
        return 'clock-out'
    if typ == 'NC':
        return 'nc'
    return 'io'


def domain_of(name):
    n = name.upper().split('/')[0]
    if n.startswith('VSS'):
        return None
    return re.sub(r'_?\d+$', '', n) if not re.match(r'^VDDIO\d', n) else n


def af_table(db, mcu_root):
    gpio = [ip for ip in mcu_root.findall('m:IP', NS) if ip.get('Name') == 'GPIO']
    if not gpio:
        return {}
    path = os.path.join(db, 'IP', 'GPIO-%s_Modes.xml' % gpio[0].get('Version'))
    if not os.path.isfile(path):
        return {}
    out = {}
    root = ET.parse(path).getroot()
    for gp in root.iter():
        if not gp.tag.endswith('GPIO_Pin'):
            continue
        pin = gp.get('Name')
        for ps in gp:
            if not ps.tag.endswith('PinSignal'):
                continue
            for pv in ps.iter():
                if pv.tag.endswith('PossibleValue') and pv.text and 'GPIO_AF' in pv.text:
                    m = re.match(r'GPIO_AF(\d+)_', pv.text)
                    if m:
                        out[(pin, ps.get('Name'))] = int(m.group(1))
    return out


def build(db, mpn):
    name = find_mcu(db, mpn)
    root = ET.parse(os.path.join(db, name + '.xml')).getroot()
    afs = af_table(db, root)
    pins, domains = [], []
    for p in root.findall('m:Pin', NS):
        if p.get('Variant'):
            continue
        nm = clean_pin(p.get('Name'))
        role = role_of(nm, p.get('Type'))
        pin = {'num': p.get('Position'), 'name': nm, 'role': role}
        port = re.match(r'^(P[A-K]\d{1,2})', nm)
        if role == 'power-in':
            d = domain_of(nm)
            if d:
                pin['domain'] = d
                if d not in domains:
                    domains.append(d)
        elif role in ('io', 'reset', 'boot', 'clock-in', 'clock-out'):
            pin['domain'] = 'VDD'
        funcs = []
        for s in p.findall('m:Signal', NS):
            sig = s.get('Name')
            if sig in ('GPIO',) or not sig:
                continue
            af = afs.get((port.group(1) if port else nm, sig))
            funcs.append(sig + (' AF%d' % af if af is not None else ''))
        if port:
            funcs.append('EXTI' + re.sub(r'^P[A-K]', '', port.group(1)))
        if funcs:
            pin['functions'] = funcs
        pins.append(pin)
    pins.sort(key=lambda x: (len(x['num']), x['num']))
    v = root.find('m:Voltage', NS)
    t = root.find('m:Temperature', NS)
    f = root.find('m:Frequency', NS)
    values = []
    if v is not None:
        values.append({'k': 'supply.range', 'on': 'VDD', 'min': float(v.get('Min')), 'max': float(v.get('Max')), 'unit': 'V', 'src': 'import:cubemx', 'note': 'CubeMX lists one range for the part; check each domain in the datasheet'})
    if t is not None:
        values.append({'k': 'temp.range', 'min': float(t.get('Min')), 'max': float(t.get('Max')), 'unit': '°C', 'src': 'import:cubemx', 'note': 'The widest range in the family; the part number\'s temperature digit sets yours'})
    if f is not None:
        values.append({'k': 'clk.fmax', 'value': float(f.text) * 1e6, 'unit': 'Hz', 'src': 'import:cubemx'})
    if 'VDD' not in domains:
        domains.insert(0, 'VDD')
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return {
        'schema': 'pincheck.part/1', 'id': re.sub(r'[^a-z0-9]+', '-', mpn.lower()).strip('-'), 'mpn': mpn, 'match': [],
        'manufacturer': 'STMicroelectronics', 'kind': 'mcu', 'description': '%s %s, %s' % (root.findtext('m:Core', '', NS), root.get('Line', ''), root.get('Package', '')),
        'package': root.get('Package', ''), 'datasheet': {'title': '', 'rev': '', 'url': '', 'sha256': ''},
        'pins': pins, 'domains': domains, 'values': values,
        'made': {'by': '', 'at': now, 'how': 'import:cubemx (%s)' % name}, 'updated': now}


def merge(old, new):
    out = dict(old)
    by = {str(p['num']): p for p in old.get('pins', [])}
    for p in new['pins']:
        q = by.get(str(p['num']))
        if q is None:
            out.setdefault('pins', []).append(p)
            continue
        for k, val in p.items():
            if k not in q or (k == 'role' and q.get('role') in (None, '', 'other')):
                q[k] = val
    have = {(x.get('k'), x.get('on', '')) for x in old.get('values', [])}
    out['values'] = list(old.get('values', [])) + [x for x in new['values'] if (x['k'], x.get('on', '')) not in have]
    out['domains'] = list(dict.fromkeys(old.get('domains', []) + new['domains']))
    for k in ('manufacturer', 'package', 'description'):
        if not out.get(k):
            out[k] = new[k]
    out['kind'] = 'mcu'
    out['updated'] = new['updated']
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('mpn')
    ap.add_argument('--cubemx', help='path to STM32CubeMX db/mcu')
    ap.add_argument('--merge', help='an existing part file to fill')
    ap.add_argument('--out', help='write here instead of printing')
    a = ap.parse_args()
    db = find_db(a.cubemx)
    part = build(db, a.mpn)
    if a.merge:
        part = merge(json.load(open(a.merge, encoding='utf-8')), part)
    text = json.dumps(part, indent=2, ensure_ascii=False) + '\n'
    if a.out:
        open(a.out, 'w', encoding='utf-8', newline='\n').write(text)
        print('wrote %s: %d pins, %d values' % (a.out, len(part['pins']), len(part['values'])), file=sys.stderr)
    else:
        sys.stdout.write(text)


if __name__ == '__main__':
    main()
