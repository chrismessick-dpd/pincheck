"""Write Altium SchDoc files: a compound file (CFB) whose FileHeader stream holds the records.

Used by tools/make_demo.py for the made-up Altium demo and test sheets. Only what Pincheck reads is
written (the FileHeader stream, no Storage or Additional streams), so Altium itself may not open them.

A record is a 3-byte little-endian length, a type byte (0 = text), and "|KEY=VALUE|...|" text ending
in a NUL. Keys whose value is 0, false, or empty are left out, as Altium leaves them out.
"""
import struct

FREE, END, FATSECT = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD
SS = 512            # sector size (version 3)
CUTOFF = 4096       # streams smaller than this go in the mini stream
MSS = 64            # mini sector size


def fmt(v):
    if v is True:
        return 'T'
    if isinstance(v, float):
        return ('%.3f' % v)
    return str(v)


def coord(rec, key, v):
    """Set an Altium coordinate: whole units in key, the rest in key_FRAC (1/100000 of a unit)."""
    whole = int(v // 1)
    frac = int(round((v - whole) * 100000))
    if frac == 100000:
        whole, frac = whole + 1, 0
    if whole:
        rec[key] = whole
    if frac:
        rec[key + '_FRAC'] = frac


def record(fields):
    parts = []
    for k, v in fields.items():
        if v is None or v is False or v == '' or (v == 0 and k not in ('RECORD',)):
            continue
        parts.append('%s=%s' % (k, fmt(v)))
    text = ('|' + '|'.join(parts) + '|').encode('utf-8', 'replace') + b'\0'
    return struct.pack('<I', len(text))[:3] + b'\0' + text


def file_header(records):
    """The FileHeader stream: the header record, then each record (dicts with a RECORD key)."""
    out = [record({'HEADER': 'Protel for Windows - Schematic Capture Binary File Version 5.0', 'WEIGHT': len(records)})]
    out += [record(r) for r in records]
    return b''.join(out)


def _dir_entry(name, kind, start, size, child=FREE, left=FREE, right=FREE):
    n = name.encode('utf-16-le') + b'\0\0'
    e = n.ljust(64, b'\0')
    e += struct.pack('<HBB', len(n), kind, 1)          # name length, type, color (black)
    e += struct.pack('<III', left, right, child)
    e += b'\0' * 16 + b'\0' * 4 + b'\0' * 16          # CLSID, state bits, times
    e += struct.pack('<IQ', start, size)
    return e.ljust(128, b'\0')


def compound(streams):
    """A version-3 compound file with the given {name: bytes} streams in the root storage.

    Streams under the 4096-byte cutoff go in the mini stream, as the format requires."""
    names = sorted(streams, key=lambda n: (len(n), n.upper()))
    big = [n for n in names if len(streams[n]) >= CUTOFF]
    small = [n for n in names if len(streams[n]) < CUTOFF]

    # The mini stream and its FAT.
    mini, minifat, mstart = b'', [], {}
    for n in small:
        data = streams[n]
        k = max(1, -(-len(data) // MSS))
        mstart[n] = len(minifat) if data else END
        minifat += [len(minifat) + i + 1 for i in range(k - 1)] + [END]
        mini += data.ljust(k * MSS, b'\0')

    # Lay out regular sectors: big streams, the mini stream, the mini FAT, the directory, then the FAT.
    sectors, fat, start = [], [], {}

    def put(data):
        if not data:
            return END
        k = -(-len(data) // SS)
        first = len(sectors)
        for i in range(k):
            sectors.append(data[i * SS:(i + 1) * SS].ljust(SS, b'\0'))
            fat.append(first + i + 1 if i < k - 1 else END)
        return first

    for n in big:
        start[n] = put(streams[n])
    mini_start = put(mini) if mini else END
    minifat_bytes = b''.join(struct.pack('<I', x) for x in minifat)
    minifat_start = put(minifat_bytes.ljust(-(-len(minifat_bytes) // SS) * SS, b'\xff')) if minifat else END
    n_minifat = -(-len(minifat_bytes) // SS) if minifat else 0

    # The directory: root, then the streams as a degenerate tree (each the right sibling of the one before;
    # every node black, which readers accept).
    entries = [_dir_entry('Root Entry', 5, mini_start, len(mini), child=1 if names else FREE)]
    for i, n in enumerate(names):
        right = i + 2 if i + 1 < len(names) else FREE
        s = start[n] if n in start else mstart[n]
        entries.append(_dir_entry(n, 2, s, len(streams[n]), right=right))
    d = b''.join(entries)
    dir_start = put(d.ljust(-(-len(d) // SS) * SS, b'\0'))

    # The FAT covers itself: grow until it fits.
    n_fat = 1
    while (len(sectors) + n_fat) > n_fat * (SS // 4):
        n_fat += 1
    if n_fat > 109:
        raise ValueError('too big for a header-only DIFAT')
    fat_first = len(sectors)
    fat += [FATSECT] * n_fat
    fat += [FREE] * (n_fat * (SS // 4) - len(fat))
    fat_bytes = b''.join(struct.pack('<I', x) for x in fat)
    for i in range(n_fat):
        sectors.append(fat_bytes[i * SS:(i + 1) * SS])

    head = struct.pack('<8s16sHHHHH6sIIIIIIIII',
                       bytes.fromhex('D0CF11E0A1B11AE1'), b'\0' * 16, 0x3E, 3, 0xFFFE, 9, 6, b'\0' * 6,
                       0, n_fat, dir_start, 0, CUTOFF, minifat_start, n_minifat, END, 0)
    difat = [fat_first + i for i in range(n_fat)] + [FREE] * (109 - n_fat)
    head += b''.join(struct.pack('<I', x) for x in difat)
    assert len(head) == 512
    return head + b''.join(sectors)


def schdoc(records, extra=None):
    """A SchDoc's bytes from its records (the sheet's records, header record excluded)."""
    streams = {'FileHeader': file_header(records)}
    streams.update(extra or {'Storage': record({'HEADER': 'Icon storage'})})
    return compound(streams)
