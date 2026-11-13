"""The Altium version of Pincheck's demo: the made-up Smart Thermostat Main PCBA drawn on three SchDoc
sheets, with the Protel2 netlist Altium would export for it. Called by tools/make_demo.py, which owns the
parts and nets (PARTS, NETS), so the KiCad and Altium demos are the same circuit.

Writes demo/altium/Power.SchDoc, MCU.SchDoc, IO.SchDoc, and Main PCBA.NET. Symbols are drawn here; every
pin gets a short wire to a net label or power port, the 3V3 divider is wired directly (a wire, a T, and a
junction), and power pins along a body's bottom edge share one wire to their ground port.
"""
import pathlib
import schdoc_write as W

# KiCad pin types → Altium ELECTRICAL (0 input, 1 I/O, 2 output, 3 open collector, 4 passive, 5 Hi-Z,
# 6 open emitter, 7 power) and the Protel2 netlist's words.
ELEC = {'input': 0, 'bidirectional': 1, 'output': 2, 'passive': 4, 'no_connect': 4, 'power_in': 7, 'power_out': 7}
ELEC_WORD = ['Input', 'IO', 'Output', 'OpenCollector', 'Passive', 'HiZ', 'OpenEmitter', 'Power']
POWER_NETS = {'GND': ('GND', 4, 3), '3V3': ('3V3', 2, 1), '5V': ('5V', 2, 1)}   # text, style, orientation (pointing)
DIR = [(1, 0), (0, 1), (-1, 0), (0, -1)]

# Which sheet each part is on, where (its origin), and how turned (quarter turns: 3 stands a two-pin part up, pin 1 on top).
SHEETS = {
    'Power': {'title': 'Power: AC input, 5 V, and 3V3', 'parts': {
        'J1': (120, 560, 0), 'F1': (240, 610, 0), 'RV1': (330, 520, 3), 'PS1': (480, 560, 0),
        'C1': (670, 500, 3), 'C3': (730, 500, 3), 'U7': (860, 560, 0), 'C13': (1010, 640, 0), 'L1': (1040, 580, 0),
        'C2': (1110, 500, 3), 'R5': (960, 380, 3), 'R6': (960, 290, 3),
        'J3': (160, 260, 0), 'R14': (380, 280, 3), 'R15': (450, 280, 3)}},
    'MCU': {'title': 'MCU, status LEDs, and I2C', 'parts': {
        'U4': (520, 420, 0), 'C4': (180, 600, 3), 'C5': (240, 600, 3), 'C6': (300, 600, 3), 'C41': (360, 600, 3),
        'R12': (880, 640, 3), 'R13': (950, 640, 3), 'R16': (860, 220, 0), 'D3': (1030, 220, 0), 'R17': (860, 150, 0), 'D4': (1030, 150, 0)}},
    'IO': {'title': 'Wi-Fi module, relays, and display', 'parts': {
        'U1': (300, 360, 0), 'C8': (140, 640, 3), 'C9': (200, 640, 3),
        'R1': (640, 560, 0), 'Q1': (810, 560, 0), 'D1': (880, 640, 3), 'K1': (980, 620, 0),
        'R2': (640, 380, 0), 'Q2': (810, 380, 0), 'D2': (880, 460, 3), 'K2': (980, 440, 0),
        'J4': (1150, 520, 0), 'J2': (1000, 230, 0)}},
}
# Pins wired by hand on a sheet instead of a stub: the feedback divider.
HAND = {'Power': {'R5.2', 'R6.1', 'R5.1', 'R6.2'}}


def rot(x, y, r):
    for _ in range(r % 4):
        x, y = -y, x
    return x, y


class Sym:
    """A symbol in its own coordinates: shapes, and pins as (base x, base y, orientation, length)."""
    def __init__(self):
        self.shapes, self.pins, self.ref_at, self.val_at = [], [], (0, 30), (0, -40)


def two_pin(kind, n1, n2):
    s = Sym()
    L = 10
    s.pins = [(-20, 0, 2, L, n1), (20, 0, 0, L, n2)]
    if kind == 'R':
        s.shapes = [('rect', -20, -5, 20, 5, False)]
    elif kind == 'C':
        s.shapes = [('line', [-20, 0, -4, 0]), ('line', [-4, -10, -4, 10]), ('line', [4, -10, 4, 10]), ('line', [4, 0, 20, 0])]
    elif kind == 'L':
        s.shapes = [('arc', -15 + 7.5 * i + 3.75, 0, 3.75, 0, 180) for i in range(4)] + [('line', [-20, 0, -15, 0]), ('line', [15, 0, 20, 0])]
    elif kind == 'D':  # anode on the left
        s.shapes = [('line', [-20, 0, -6, 0]), ('poly', [-6, -7, -6, 7, 6, 0], True), ('line', [6, -7, 6, 7]), ('line', [6, 0, 20, 0])]
    elif kind == 'LED':
        s.shapes = [('line', [-20, 0, -6, 0]), ('poly', [-6, -7, -6, 7, 6, 0], False), ('line', [6, -7, 6, 7]), ('line', [6, 0, 20, 0]),
                    ('line', [0, 9, 6, 15]), ('line', [5, 8, 11, 14])]
    elif kind == 'F':
        s.shapes = [('rect', -14, -5, 14, 5, False), ('line', [-20, 0, 20, 0])]
    elif kind == 'RV':
        s.shapes = [('rect', -14, -5, 14, 5, False), ('line', [-12, -9, 12, 9])]
    s.ref_at, s.val_at = (-18, 9), (-18, -18)
    return s


def box(left, right, top=(), bottom=(), min_w=60):
    """An IC or connector: pins on each side, 10 apart, 20 long. Lists of (num, name) or None for a gap."""
    s = Sym()
    rows = max(len(left), len(right), 1)
    longest = max([len(n) for _, n in [p for p in list(left) + list(right) if p]] + [0])
    w = max(min_w, len(top) * 10 + 20, len(bottom) * 10 + 20, (longest * 6 + 12) * (2 if left and right else 1) + 10)
    w = -(-w // 10) * 10
    h = (rows + 1) * 10
    s.shapes = [('rect', 0, -h, w, 0, True)]
    for i, p in enumerate(left):
        if p:
            s.pins.append((0, -10 - 10 * i, 2, 20, p[0]))
    for i, p in enumerate(right):
        if p:
            s.pins.append((w, -10 - 10 * i, 0, 20, p[0]))
    # Top and bottom pins sit in the middle of their edge, clear of the side pins' names.
    for edge, y, o in ((top, 0, 1), (bottom, -h, 3)):
        x0 = max(10, ((w - (len(edge) - 1) * 10) // 20) * 10)
        for i, p in enumerate(edge):
            if p:
                s.pins.append((x0 + 10 * i, y, o, 20, p[0]))
    s.ref_at, s.val_at = (0, 24), (0, -h - 34)
    s.w, s.h = w, h
    return s


def symbol(ref, part):
    lib, val, mpn, mfr, desc, fp, pins = part
    names = {n: nm for n, (nm, _) in pins.items()}
    nk = lambda key: key if key in pins else next(n for n, (nm, _) in pins.items() if nm == key)   # a pin by number or name
    order = lambda keys: [(nk(k), names[nk(k)]) for k in keys]
    pre = ''.join(c for c in ref if c.isalpha())
    if pre in ('R',):
        return two_pin('R', '1', '2')
    if pre == 'C':
        return two_pin('C', '1', '2')
    if pre == 'L':
        return two_pin('L', '1', '2')
    if pre == 'F':
        return two_pin('F', '1', '2')
    if pre == 'RV':
        return two_pin('RV', '1', '2')
    if pre == 'D' and lib == 'LED':
        return two_pin('LED', nk('A'), nk('K'))
    if pre == 'D':
        return two_pin('D', nk('A'), nk('K'))
    if pre == 'Q':  # NPN: base left, collector up, emitter down
        s = Sym()
        s.pins = [(-10, 0, 2, 20, nk('B')), (10, 10, 1, 10, nk('C')), (10, -10, 3, 10, nk('E'))]
        s.shapes = [('ellipse', 3, 0, 14, 14, False), ('line', [-10, 0, 0, 0]), ('line', [0, -8, 0, 8]), ('line', [0, 3, 10, 10]), ('line', [0, -3, 10, -10]),
                    ('poly', [10, -10, 4, -9, 7, -5], True)]
        s.ref_at, s.val_at = (20, 6), (20, -6)
        return s
    if ref == 'U4':
        io = [k for k in pins if k not in ('4', '5', '33')]
        half = (len(io) + 1) // 2
        return box(order(io[:half]), order(io[half:]), top=order(['4']), bottom=order(['5', '33']))
    if ref == 'U1':
        gnd = [k for k, (nm, _) in pins.items() if nm == 'GND']
        rest = [k for k in pins if k not in gnd and k != '3']
        half = (len(rest) + 1) // 2
        return box(order(rest[:half]), order(rest[half:]), top=order(['3']), bottom=order(gnd))
    if ref == 'U7':
        return box(order(['3', '5', '6']), order(['2', '4']), bottom=order(['1']))
    if ref == 'PS1':
        return box(order(['1', '2']), order(['3', '4']))
    if ref in ('K1', 'K2'):
        return box(order(['A1', 'A2']), order(['COM', 'NO']), min_w=40)
    if ref == 'J3':
        return box([], order(['A4', 'B4', 'A5', 'B5', 'A1', 'B1', 'S1']), min_w=50)
    return box([], order(list(pins)), min_w=40)   # connectors


def make(PARTS, NETS, out, pin_num):
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    node_net = {}
    for net, nodes in NETS.items():
        for node in nodes:
            ref, key = node.split('.', 1)
            node_net[(ref, pin_num(ref, key))] = net
    files = []
    for sheet, spec in SHEETS.items():
        recs = [{'RECORD': 31, 'FONTIDCOUNT': 3, 'SIZE1': 10, 'FONTNAME1': 'Arial', 'SIZE2': 8, 'FONTNAME2': 'Arial', 'SIZE3': 12, 'FONTNAME3': 'Arial', 'BOLD3': True,
                 'SHEETSTYLE': 1, 'BORDERON': True, 'TITLEBLOCKON': True, 'SNAPGRIDON': True, 'SNAPGRIDSIZE': 10, 'VISIBLEGRIDON': True, 'VISIBLEGRIDSIZE': 10}]
        W_, H_ = 1550, 1110
        # Border and title block, as a template would draw them.
        recs.append({'RECORD': 14, 'OWNERPARTID': -1, 'LINEWIDTH': 1, 'LOCATION.X': 20, 'LOCATION.Y': 20, 'CORNER.X': W_ - 20, 'CORNER.Y': H_ - 20})
        recs.append({'RECORD': 14, 'OWNERPARTID': -1, 'LINEWIDTH': 1, 'LOCATION.X': W_ - 420, 'LOCATION.Y': 20, 'CORNER.X': W_ - 20, 'CORNER.Y': 110})
        recs.append({'RECORD': 13, 'OWNERPARTID': -1, 'LINEWIDTH': 1, 'LOCATION.X': W_ - 420, 'LOCATION.Y': 60, 'CORNER.X': W_ - 20, 'CORNER.Y': 60})
        recs.append({'RECORD': 4, 'OWNERPARTID': -1, 'LOCATION.X': W_ - 410, 'LOCATION.Y': 80, 'FONTID': 3, 'TEXT': '=Title'})
        recs.append({'RECORD': 4, 'OWNERPARTID': -1, 'LOCATION.X': W_ - 410, 'LOCATION.Y': 35, 'FONTID': 2, 'TEXT': 'Acme Climate · Smart Thermostat Main PCBA · DT-1042 rev B'})
        recs.append({'RECORD': 4, 'OWNERPARTID': -1, 'LOCATION.X': W_ - 120, 'LOCATION.Y': 35, 'FONTID': 2, 'TEXT': '=SheetNumber'})
        recs.append({'RECORD': 41, 'OWNERPARTID': -1, 'NAME': 'Title', 'TEXT': spec['title'], 'ISHIDDEN': True})
        recs.append({'RECORD': 41, 'OWNERPARTID': -1, 'NAME': 'SheetNumber', 'TEXT': 'Sheet %d of 3' % (list(SHEETS).index(sheet) + 1), 'ISHIDDEN': True})
        wires, labels, powers, junctions, noerc = [], [], [], [], []
        hot = {}
        for ref, (ox, oy, turn) in spec['parts'].items():
            lib, val, mpn, mfr, desc, fp, pins = PARTS[ref]
            s = symbol(ref, PARTS[ref])
            ci = len(recs)
            recs.append({'RECORD': 1, 'LIBREFERENCE': lib, 'COMPONENTDESCRIPTION': desc, 'PARTCOUNT': 2, 'DISPLAYMODECOUNT': 1, 'OWNERPARTID': -1,
                         'LOCATION.X': ox, 'LOCATION.Y': oy, 'ORIENTATION': turn, 'CURRENTPARTID': 1, 'SOURCELIBRARYNAME': 'Thermostat.SchLib', 'DESIGNITEMID': lib})
            P = lambda x, y: (ox + rot(x, y, turn)[0], oy + rot(x, y, turn)[1])
            for sh in s.shapes:
                if sh[0] == 'rect':
                    (x0, y0), (x1, y1) = P(sh[1], sh[2]), P(sh[3], sh[4])
                    r = {'RECORD': 14, 'OWNERINDEX': ci, 'OWNERPARTID': 1, 'LINEWIDTH': 1, 'ISSOLID': sh[5]}
                    W.coord(r, 'LOCATION.X', min(x0, x1)); W.coord(r, 'LOCATION.Y', min(y0, y1)); W.coord(r, 'CORNER.X', max(x0, x1)); W.coord(r, 'CORNER.Y', max(y0, y1))
                    recs.append(r)
                elif sh[0] in ('line', 'poly'):
                    r = {'RECORD': 6 if sh[0] == 'line' else 7, 'OWNERINDEX': ci, 'OWNERPARTID': 1, 'LINEWIDTH': 1, 'LOCATIONCOUNT': len(sh[1]) // 2}
                    if sh[0] == 'poly':
                        r['ISSOLID'] = sh[2]
                    for i in range(0, len(sh[1]), 2):
                        x, y = P(sh[1][i], sh[1][i + 1])
                        W.coord(r, 'X%d' % (i // 2 + 1), x); W.coord(r, 'Y%d' % (i // 2 + 1), y)
                    recs.append(r)
                elif sh[0] == 'ellipse':
                    x, y = P(sh[1], sh[2])
                    r = {'RECORD': 8, 'OWNERINDEX': ci, 'OWNERPARTID': 1, 'LINEWIDTH': 1, 'RADIUS': sh[3], 'SECONDARYRADIUS': sh[4]}
                    W.coord(r, 'LOCATION.X', x); W.coord(r, 'LOCATION.Y', y)
                    recs.append(r)
                elif sh[0] == 'arc':
                    x, y = P(sh[1], sh[2])
                    r = {'RECORD': 12, 'OWNERINDEX': ci, 'OWNERPARTID': 1, 'LINEWIDTH': 1, 'STARTANGLE': float(sh[4] + 90 * turn), 'ENDANGLE': float(sh[5] + 90 * turn)}
                    W.coord(r, 'RADIUS', sh[3]); W.coord(r, 'LOCATION.X', x); W.coord(r, 'LOCATION.Y', y)
                    recs.append(r)
            many = len(pins) > 3
            for bx, by, o, ln, num in s.pins:
                name, kt = pins[num]
                x, y = P(bx, by)
                o2 = (o + turn) % 4
                pc = o2 | (0x08 if many and name != num else 0) | (0x10 if many or ref[0] in 'QK' else 0)
                recs.append({'RECORD': 2, 'OWNERINDEX': ci, 'OWNERPARTID': 1, 'ELECTRICAL': ELEC[kt], 'PINCONGLOMERATE': pc, 'PINLENGTH': ln,
                             'LOCATION.X': x, 'LOCATION.Y': y, 'NAME': name, 'DESIGNATOR': num})
                dx, dy = DIR[o2]
                hot[ref + '.' + num] = (x + dx * ln, y + dy * ln, o2, side_of(o, s))
            rx, ry = P(*s.ref_at) if turn == 0 else (ox + 14, oy + 6)
            vx, vy = P(*s.val_at) if turn == 0 else (ox + 14, oy - 8)
            recs.append({'RECORD': 34, 'OWNERINDEX': ci, 'OWNERPARTID': -1, 'LOCATION.X': rx, 'LOCATION.Y': ry, 'FONTID': 1, 'TEXT': ref, 'NAME': 'Designator'})
            recs.append({'RECORD': 41, 'OWNERINDEX': ci, 'OWNERPARTID': -1, 'LOCATION.X': vx, 'LOCATION.Y': vy, 'FONTID': 1, 'TEXT': val, 'NAME': 'Comment'})
            if mpn:
                recs.append({'RECORD': 41, 'OWNERINDEX': ci, 'OWNERPARTID': -1, 'NAME': 'Manufacturer Part Number', 'TEXT': mpn, 'ISHIDDEN': True})
                recs.append({'RECORD': 41, 'OWNERINDEX': ci, 'OWNERPARTID': -1, 'NAME': 'Manufacturer', 'TEXT': mfr, 'ISHIDDEN': True})
        # Connections. Power pins along a body's bottom (or top) edge on one net share a wire.
        done = set()
        for ref in spec['parts']:
            groups = {}
            for key, (x, y, o, side) in hot.items():
                if key.split('.')[0] != ref or side not in ('top', 'bottom'):
                    continue
                net = node_net.get((ref, key.split('.', 1)[1]))
                if net in POWER_NETS:
                    groups.setdefault((side, net), []).append(key)
            for (side, net), keys in groups.items():
                if len(keys) < 2:
                    continue
                xs = sorted(hot[k][0] for k in keys)
                y = hot[keys[0]][1]
                wires.append([xs[0], y, xs[-1], y])
                mx = xs[0] + ((xs[-1] - xs[0]) // 20) * 10
                sy = y - 20 if side == 'bottom' else y + 20
                wires.append([mx, y, mx, sy])
                if mx not in (xs[0], xs[-1]):
                    junctions.append((mx, y))
                powers.append((mx, sy, net, 3 if side == 'bottom' else 1))
                done.update(keys)
        for key, (x, y, o, side) in hot.items():
            if key in done or key in HAND.get(sheet, ()):
                continue
            ref, num = key.split('.', 1)
            net = node_net.get((ref, num))
            if net is None:
                noerc.append((x, y))
                continue
            dx, dy = DIR[o]
            if net in POWER_NETS:
                ex, ey = x + dx * 10, y + dy * 10
                wires.append([x, y, ex, ey])
                powers.append((ex, ey, net, o))
            else:
                ln = 40 if o in (0, 2) else 30
                ex, ey = x + dx * ln, y + dy * ln
                wires.append([x, y, ex, ey])
                labels.append((x + dx * 4 if o == 0 else x - 4 if o == 2 else x, y + dy * 4 if o in (1, 3) else y, net, o))
        if sheet == 'Power':
            # The feedback divider, wired by hand: R5 over R6, a T to the FB label, and its junction.
            (ax, ay, _, _), (bx, by, _, _) = hot['R5.2'], hot['R6.1']
            wires.append([ax, ay, bx, by])
            my = (ay + by) // 2
            wires.append([ax, my, ax + 40, my])
            junctions.append((ax, my))
            labels.append((ax + 8, my, 'FB', 0))
            x, y, o, _ = hot['R5.1']
            wires.append([x, y, x, y + 10]); powers.append((x, y + 10, '3V3', 1))
            x, y, o, _ = hot['R6.2']
            wires.append([x, y, x, y - 10]); powers.append((x, y - 10, 'GND', 3))
        for wv in wires:
            r = {'RECORD': 27, 'OWNERPARTID': -1, 'LINEWIDTH': 1, 'LOCATIONCOUNT': len(wv) // 2}
            for i in range(0, len(wv), 2):
                W.coord(r, 'X%d' % (i // 2 + 1), wv[i]); W.coord(r, 'Y%d' % (i // 2 + 1), wv[i + 1])
            recs.append(r)
        for x, y in junctions:
            recs.append({'RECORD': 29, 'OWNERPARTID': -1, 'LOCATION.X': x, 'LOCATION.Y': y})
        for x, y, text, o in labels:
            vertical = o in (1, 3)
            just = 2 if o == 2 else 0
            recs.append({'RECORD': 25, 'OWNERPARTID': -1, 'LOCATION.X': x, 'LOCATION.Y': y, 'TEXT': text, 'FONTID': 1, 'ORIENTATION': 1 if vertical else 0,
                         'JUSTIFICATION': (2 if o == 3 else 0) if vertical else just})
        for x, y, net, o in powers:
            text, style, _ = POWER_NETS[net]
            recs.append({'RECORD': 17, 'OWNERPARTID': -1, 'STYLE': style if net != 'GND' else 4, 'SHOWNETNAME': True, 'LOCATION.X': x, 'LOCATION.Y': y,
                         'ORIENTATION': o, 'FONTID': 1, 'TEXT': text})
        for x, y in noerc:
            recs.append({'RECORD': 22, 'OWNERPARTID': -1, 'LOCATION.X': x, 'LOCATION.Y': y, 'SYMBOL': 'Thin Cross', 'ISACTIVE': True})
        if sheet == 'IO':
            recs.append({'RECORD': 209, 'OWNERPARTID': -1, 'LOCATION.X': 600, 'LOCATION.Y': 730, 'CORNER.X': 900, 'CORNER.Y': 800, 'FONTID': 2, 'ISSOLID': True,
                         'SHOWBORDER': True, 'WORDWRAP': True, 'TEXT': 'Relay coils run from 5 V; the MCU drives each through an NPN, with a flyback diode.', 'AUTHOR': 'Demo reviewer'})
        name = sheet + '.SchDoc'
        (out / name).write_bytes(W.schdoc(recs))
        files.append(name)
    (out / 'Main PCBA.NET').write_bytes(protel2(PARTS, NETS, pin_num).encode('cp1252'))
    return files


def side_of(o, s):
    return {1: 'top', 3: 'bottom'}.get(o, 'side')


def protel2(PARTS, NETS, pin_num):
    out = ['PROTEL NETLIST 2.0']
    for ref, (lib, val, mpn, mfr, desc, fp, pins) in PARTS.items():
        out += ['[', 'DESIGNATOR', ref, 'FOOTPRINT', fp.split(':')[-1], 'PARTTYPE', val, 'DESCRIPTION', desc]
        if mpn:
            out += ['Manufacturer Part Number', mpn, 'Manufacturer', mfr]
        out += [']']
    for net, nodes in NETS.items():
        out += ['(', net]
        for node in nodes:
            ref, key = node.split('.', 1)
            n = pin_num(ref, key)
            name, kt = PARTS[ref][6][n]
            out.append('%s-%s %s-%s %s' % (ref, n, PARTS[ref][1], name, ELEC_WORD[ELEC[kt]]))
        out += [')']
    return '\r\n'.join(out) + '\r\n'
