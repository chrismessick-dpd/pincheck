// Zips and folders for Pincheck: an Altium project as a .zip or a folder dropped whole (Chris, 2026-11-13).
// Only the files Pincheck reads come out (SchDoc sheets, the Protel2 or KiCad netlist, the .PrjPcb for the
// design's name, and part files); the rest (PcbDoc, drawings, libraries) is never inflated. Zips are read with
// the browser's own DecompressionStream, so there is no library to load (the page allows only its own scripts).
//
// PK.archive.captureDrop(dataTransfer) must run inside the drop event; PK.archive.fromDrop(captured) and
// PK.archive.expand(files) give back plain File objects, each with `path` (its place in the folder or zip).
(function (PK) {
  'use strict';
  const WANT = /\.(schdoc|net|xml|prjpcb|json)$/i;
  const SKIP = /(^|\/)(__MACOSX|\.git|History|Project Logs for [^/]*|Project Outputs for [^/]*)\//i;
  const wanted = path => WANT.test(path) && !SKIP.test(path);
  const isZip = f => /\.zip$/i.test(f.name);
  const named = (blob, path) => { const f = new File([blob], path.split('/').pop(), { type: blob.type || '' }); f.path = path; return f; };

  // ── Zip ──
  async function bytes(blob, start, end) { return new Uint8Array(await blob.slice(start, end).arrayBuffer()); }
  const u16 = (b, i) => b[i] | b[i + 1] << 8;
  const u32 = (b, i) => (b[i] | b[i + 1] << 8 | b[i + 2] << 16 | b[i + 3] << 24) >>> 0;
  const u64 = (b, i) => u32(b, i) + u32(b, i + 4) * 0x100000000;

  // The central directory: every entry's name, method, sizes, and where its local header is.
  async function entries(blob) {
    const size = blob.size, tailLen = Math.min(size, 65557);
    const tail = await bytes(blob, size - tailLen, size);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('not a zip file (no end of central directory)');
    let count = u16(tail, e + 10), cdSize = u32(tail, e + 12), cdOff = u32(tail, e + 16);
    // ZIP64: the locator sits just before the end record.
    if ((count === 0xFFFF || cdOff === 0xFFFFFFFF) && e >= 20 && u32(tail, e - 20) === 0x07064b50) {
      const z = await bytes(blob, u64(tail, e - 12), u64(tail, e - 12) + 56);
      if (u32(z, 0) === 0x06064b50) { count = u64(z, 32); cdSize = u64(z, 40); cdOff = u64(z, 48); }
    }
    const cd = await bytes(blob, cdOff, cdOff + cdSize), dec = new TextDecoder('utf-8'), out = [];
    for (let i = 0, k = 0; k < count && i + 46 <= cd.length; k++) {
      if (u32(cd, i) !== 0x02014b50) throw new Error('the zip\'s directory is damaged');
      const method = u16(cd, i + 10), n = u16(cd, i + 28), m = u16(cd, i + 30), c = u16(cd, i + 32);
      let csize = u32(cd, i + 20), usize = u32(cd, i + 24), off = u32(cd, i + 42);
      const name = dec.decode(cd.subarray(i + 46, i + 46 + n)).replace(/\\/g, '/');
      // ZIP64 sizes and offset, in that order, for whichever field is full.
      for (let x = i + 46 + n, end = x + m; x + 4 <= end;) {
        const id = u16(cd, x), len = u16(cd, x + 2);
        if (id === 1) { let p = x + 4; if (usize === 0xFFFFFFFF) { usize = u64(cd, p); p += 8; } if (csize === 0xFFFFFFFF) { csize = u64(cd, p); p += 8; } if (off === 0xFFFFFFFF) off = u64(cd, p); }
        x += 4 + len;
      }
      out.push({ name, method, csize, usize, off, dir: name.endsWith('/'), encrypted: !!(u16(cd, i + 8) & 1) });
      i += 46 + n + m + c;
    }
    return out;
  }

  async function inflate(blob, en) {
    const head = await bytes(blob, en.off, en.off + 30);
    if (u32(head, 0) !== 0x04034b50) throw new Error(en.name + ': damaged entry');
    const start = en.off + 30 + u16(head, 26) + u16(head, 28), raw = blob.slice(start, start + en.csize);
    if (en.method === 0) return raw;
    if (en.method !== 8) throw new Error(en.name + ': compressed with method ' + en.method + ', which Pincheck can\'t read');
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser can\'t unzip; unzip the project and drop the folder instead');
    return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
  }

  // The files Pincheck reads from a zip (zips inside it too), each with its path inside the zip.
  async function unzip(blob, prefix) {
    const out = [];
    for (const en of await entries(blob)) {
      if (en.dir) continue;
      const path = (prefix || '') + en.name;
      if (/\.zip$/i.test(en.name) && !SKIP.test(path)) { out.push(...await unzip(await inflate(blob, en), path + '/')); continue; }
      if (!wanted(path)) continue;
      if (en.encrypted) throw new Error(en.name + ' is encrypted');
      out.push(named(await inflate(blob, en), path));
    }
    return out;
  }

  // ── Folders and drops ──
  // A drop's DataTransfer empties after the event: capture it synchronously, read it afterwards. Dropped
  // files come from dt.files (Chrome's entry.file() can fail on some Windows paths); entries are walked only
  // for folders, which have no other API (as Fabcheck's loader).
  function captureDrop(dt) {
    const list = [];
    if (dt.items) for (const it of dt.items) { const e = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (e) list.push(e); }
    return { entries: list, files: Array.from(dt.files || []) };
  }
  async function fromDrop(drop) {
    if (!drop.entries.some(e => e.isDirectory)) return drop.files;
    const byName = new Map(drop.files.map(f => [f.name, f])), out = [];
    let failed = 0;
    const walk = async (entry, path) => {
      if (entry.isFile) {
        const p = path + entry.name;
        if (!wanted(p) && !/\.zip$/i.test(p)) return;
        try { out.push(named(!path && byName.get(entry.name) || await new Promise((res, rej) => entry.file(res, rej)), p)); } catch (e) { failed++; }
      } else if (entry.isDirectory) {
        if (SKIP.test(path + entry.name + '/')) return;
        const reader = entry.createReader();
        let batch;
        do { batch = await new Promise((res, rej) => reader.readEntries(res, rej)); for (const e of batch) await walk(e, path + entry.name + '/'); } while (batch.length);
      }
    };
    for (const e of drop.entries) await walk(e, '');
    if (failed && !out.length) throw new Error('The browser couldn\'t read the dropped folder. Use Choose folder… instead.');
    return out;
  }

  // Files from a drop or a picker, zips opened, and only what Pincheck reads kept.
  async function expand(files) {
    const out = [];
    for (const f of files) {
      const path = f.path || f.webkitRelativePath || f.name;
      if (isZip(f)) out.push(...await unzip(f, path.replace(/[^/]+$/, '')));
      // From a picked folder, only what Pincheck reads; a file dropped on its own goes on (design.build notes what it skips).
      else if (!f.webkitRelativePath || wanted(path)) { if (!f.path) f.path = path; out.push(f); }
    }
    return out;
  }

  PK.archive = { captureDrop, fromDrop, expand, unzip, entries, wanted };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
