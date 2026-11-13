// A small reader for Microsoft compound files (CFB, "OLE"), the container Altium's SchDoc uses.
// Read-only: PK.cfb.read(bytes) → { streams: Map(path → Uint8Array) }. Paths join storage names with '/'.
(function (PK) {
  'use strict';
  const FREE = 0xFFFFFFFF, END = 0xFFFFFFFE;

  function read(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const u32 = o => dv.getUint32(o, true), u16 = o => dv.getUint16(o, true);
    if (u32(0) !== 0xE011CFD0 || u32(4) !== 0xE11AB1A1) throw new Error('Not a compound file (no CFB signature)');
    const ss = 1 << u16(30), mss = 1 << u16(32);
    const nFat = u32(44), dirStart = u32(48), cutoff = u32(56), miniFatStart = u32(60), difStart = u32(68);
    const sector = n => 512 + n * ss; // byte offset of sector n (the header fills sector -1)

    // The FAT's own sectors: 109 in the header, the rest chained through DIFAT sectors.
    const fatSecs = [];
    for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const s = u32(76 + i * 4); if (s !== FREE) fatSecs.push(s); }
    for (let d = difStart, guard = 0; d !== END && d !== FREE && fatSecs.length < nFat && guard < 1e5; guard++) {
      const o = sector(d), per = ss / 4 - 1;
      for (let i = 0; i < per && fatSecs.length < nFat; i++) { const s = u32(o + i * 4); if (s !== FREE) fatSecs.push(s); }
      d = u32(o + per * 4);
    }
    const fat = new Uint32Array(fatSecs.length * ss / 4);
    fatSecs.forEach((s, k) => { const o = sector(s); for (let i = 0; i < ss / 4; i++) fat[k * ss / 4 + i] = u32(o + i * 4); });

    const chain = (start, table) => { const out = []; for (let s = start, g = 0; s !== END && s !== FREE && s < table.length && g < table.length + 1; g++) { out.push(s); s = table[s]; } return out; };
    const readChain = (start, size) => {
      const secs = chain(start, fat), out = new Uint8Array(size == null ? secs.length * ss : size);
      let p = 0;
      for (const s of secs) { const o = sector(s), n = Math.min(ss, out.length - p); if (n <= 0) break; out.set(b.subarray(o, o + n), p); p += n; }
      return out;
    };

    const dir = readChain(dirStart);
    const ddv = new DataView(dir.buffer);
    const entries = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const nl = ddv.getUint16(o + 64, true);
      let name = '';
      for (let i = 0; i + 1 < nl - 1 && i < 64; i += 2) name += String.fromCharCode(ddv.getUint16(o + i, true));
      entries.push({ name, type: dir[o + 66], left: ddv.getUint32(o + 68, true), right: ddv.getUint32(o + 72, true), child: ddv.getUint32(o + 76, true), start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true) });
    }
    const root = entries[0];
    const miniStream = root && root.start !== END ? readChain(root.start, root.size) : new Uint8Array(0);
    const miniFatBytes = miniFatStart !== END ? readChain(miniFatStart) : new Uint8Array(0);
    const miniFat = new Uint32Array(miniFatBytes.buffer, 0, miniFatBytes.length >> 2);
    const readMini = (start, size) => {
      const out = new Uint8Array(size); let p = 0;
      for (const s of chain(start, miniFat)) { const n = Math.min(mss, size - p); if (n <= 0) break; out.set(miniStream.subarray(s * mss, s * mss + n), p); p += n; }
      return out;
    };

    const streams = new Map();
    const seen = new Set();
    const walk = (id, prefix) => { // the siblings of a storage form a red-black tree: visit it in order
      if (id === FREE || id >= entries.length || seen.has(id)) return;
      seen.add(id);
      const e = entries[id];
      walk(e.left, prefix);
      const path = prefix ? prefix + '/' + e.name : e.name;
      if (e.type === 2) streams.set(path, e.size < cutoff ? readMini(e.start, e.size) : readChain(e.start, e.size));
      else if (e.type === 1) walk(e.child, path);
      walk(e.right, prefix);
    };
    if (root) walk(root.child, '');
    return { streams };
  }

  PK.cfb = { read };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
