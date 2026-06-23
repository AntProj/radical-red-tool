/* sav.js — Gen-3 GBA save parser (FireRed/Emerald base, incl. Radical Red), browser-side.
 * Exposes window.RRSav.parse(arrayBuffer) -> { ok, error, diag, party:[mon], boxes:[{name,mons:[mon]}] }
 *
 * Notes / known limits for romhacks:
 *  - Species numbers are the game's INTERNAL ids; we map them straight to species.json ids.
 *  - Box Pokémon store EXP not level; level is ESTIMATED via the Medium-Fast curve (party levels are exact).
 *  - Gender needs per-species gender ratios we don't have, so it's omitted.
 *  - Hidden abilities can't be told apart from the 2nd ability slot in the Gen-3 struct.
 */
(function () {
  'use strict';
  const SECTION = 4096, SLOT = SECTION * 14, SIG = 0x08012025;
  // 24 substructure orderings, indexed by personality % 24.
  const ORDER = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG',
    'AMGE', 'AMEG', 'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'];

  // Gen-3 western character map (enough for nicknames/OT names).
  const CHARMAP = (() => {
    const m = {};
    m[0x00] = ' '; m[0xFF] = '';
    '0123456789'.split('').forEach((c, i) => { m[0xA1 + i] = c; });
    for (let i = 0; i < 26; i++) m[0xBB + i] = String.fromCharCode(65 + i); // A-Z
    for (let i = 0; i < 26; i++) m[0xD5 + i] = String.fromCharCode(97 + i); // a-z
    Object.assign(m, { 0xAB: '!', 0xAC: '?', 0xAD: '.', 0xAE: '-', 0xB0: '…', 0xB1: '“', 0xB2: '”',
      0xB3: '‘', 0xB4: '’', 0xB5: '♂', 0xB6: '♀', 0xB8: ',', 0xBA: '/', 0x2D: '&' });
    return m;
  })();
  function decodeStr(dv, off, len) {
    let s = '';
    for (let i = 0; i < len; i++) {
      const b = dv.getUint8(off + i);
      if (b === 0xFF) break;
      s += (CHARMAP[b] !== undefined ? CHARMAP[b] : '');
    }
    return s.trim();
  }

  const levelFromExp = (exp) => Math.max(1, Math.min(100, Math.round(Math.cbrt(exp || 1)))); // Medium-Fast estimate

  function readSlot(dv, base) {
    const sections = {}; let saveIndex = -1, found = 0;
    for (let i = 0; i < 14; i++) {
      const off = base + i * SECTION;
      if (dv.getUint32(off + 0x0FF8, true) !== SIG) continue;
      const id = dv.getUint16(off + 0x0FF4, true);
      const idx = dv.getUint32(off + 0x0FFC, true);
      sections[id] = off; found++;
      if (idx > saveIndex) saveIndex = idx;
    }
    return { sections, saveIndex, found };
  }

  // Concatenate the data area of the given section ids (3968 B each, except section 13 = 2000 B).
  function assemble(dv, sections, ids) {
    const parts = [];
    for (const id of ids) {
      const off = sections[id];
      if (off === undefined) return null;
      const size = id === 13 ? 2000 : 3968;
      parts.push(new Uint8Array(dv.buffer, off, size));
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const part of parts) { out.set(part, p); p += part.length; }
    return new DataView(out.buffer);
  }

  function decodeMon(dv, off, isParty) {
    const pv = dv.getUint32(off, true);
    const otid = dv.getUint32(off + 4, true);
    if (pv === 0 && otid === 0) return null; // empty slot
    const key = pv ^ otid;
    const order = ORDER[pv % 24];
    const dec = new DataView(new ArrayBuffer(48));
    for (let i = 0; i < 12; i++) dec.setUint32(i * 4, (dv.getUint32(off + 0x20 + i * 4, true) ^ key) >>> 0, true);
    const pos = {}; order.split('').forEach((c, i) => { pos[c] = i * 12; });
    const G = pos.G, A = pos.A, E = pos.E, M = pos.M;

    const species = dec.getUint16(G + 0, true);
    if (!species) return null;
    const heldItem = dec.getUint16(G + 2, true);
    const exp = dec.getUint32(G + 4, true);
    const moves = [0, 2, 4, 6].map((o) => dec.getUint16(A + o, true)).filter(Boolean);
    const evs = [0, 1, 2, 3, 4, 5].map((o) => dec.getUint8(E + o)); // HP,Atk,Def,Spe,SpA,SpD
    const ivWord = dec.getUint32(M + 4, true) >>> 0;
    const ivs = [0, 5, 10, 15, 20, 25].map((sh) => (ivWord >>> sh) & 31); // HP,Atk,Def,Spe,SpA,SpD
    const isEgg = (ivWord >>> 30) & 1;
    const abilityNum = (ivWord >>> 31) & 1;
    const tid = otid & 0xFFFF, sid = (otid >>> 16) & 0xFFFF;
    const shiny = ((tid ^ sid ^ (pv & 0xFFFF) ^ (pv >>> 16)) & 0xFFFF) < 8;

    return {
      species, heldItem, exp, moves, evs, ivs, isEgg: !!isEgg, abilityNum, shiny,
      nature: pv % 25,
      nickname: decodeStr(dv, off + 0x08, 10),
      otName: decodeStr(dv, off + 0x14, 7),
      level: isParty ? dv.getUint8(off + 0x54) : levelFromExp(exp),
      levelExact: !!isParty,
    };
  }

  function parse(buffer) {
    const diag = {};
    try {
      const dv = new DataView(buffer);
      if (buffer.byteLength < SLOT) return { ok: false, error: 'File too small to be a GBA save (' + buffer.byteLength + ' bytes).', diag };
      const a = readSlot(dv, 0), b = buffer.byteLength >= SLOT * 2 ? readSlot(dv, SLOT) : { sections: {}, saveIndex: -1, found: 0 };
      const slot = (a.found && (!b.found || a.saveIndex >= b.saveIndex)) ? a : b;
      diag.slot = slot === a ? 'A' : 'B';
      diag.sectionsFound = slot.found;
      if (!slot.found) return { ok: false, error: 'No valid save sections found (signature mismatch).', diag };

      // Boxes: PokemonStorage across sections 5-13, boxes start at offset 4, 14 boxes x 30 x 80B.
      const pc = assemble(dv, slot.sections, [5, 6, 7, 8, 9, 10, 11, 12, 13]);
      const boxes = [];
      if (pc) {
        const NUM_BOXES = 14, PER = 30, SIZE = 80, base = 4;
        for (let bx = 0; bx < NUM_BOXES; bx++) {
          const mons = [];
          for (let i = 0; i < PER; i++) {
            const off = base + (bx * PER + i) * SIZE;
            if (off + SIZE > pc.buffer.byteLength) break;
            const mon = decodeMon(pc, off, false);
            if (mon) { mon.box = bx; mon.slot = i; mons.push(mon); }
          }
          boxes.push({ name: 'Box ' + (bx + 1), mons });
        }
      }

      // Party: SaveBlock1 (sections 1-4). Offset differs FRLG (0x38) vs Emerald-base (0x238) — try both.
      const sb1 = assemble(dv, slot.sections, [1, 2, 3, 4]);
      let party = [];
      if (sb1) {
        for (const [cntOff, partyOff] of [[0x34, 0x38], [0x234, 0x238]]) {
          const cnt = sb1.getUint32(cntOff, true);
          if (cnt >= 1 && cnt <= 6) {
            const test = [];
            for (let i = 0; i < cnt; i++) {
              const mon = decodeMon(sb1, partyOff + i * 100, true);
              if (mon) test.push(mon);
            }
            if (test.length) { party = test; diag.partyOffset = '0x' + partyOff.toString(16); break; }
          }
        }
      }

      const totalBox = boxes.reduce((n, b2) => n + b2.mons.length, 0);
      diag.party = party.length; diag.boxMons = totalBox;
      if (!party.length && !totalBox) return { ok: false, error: 'Parsed the save but found no Pokémon — the Radical Red save layout may differ. Send me the file and I\'ll adjust.', diag };
      return { ok: true, party, boxes, diag };
    } catch (e) {
      return { ok: false, error: 'Parse failed: ' + (e && e.message), diag };
    }
  }

  window.RRSav = { parse };
})();
