/* sav.js — Gen-3 GBA save parser (FireRed/Emerald base, incl. Radical Red), browser-side.
 * Exposes window.RRSav.parse(arrayBuffer) -> { ok, error, diag, party:[mon], boxes:[{name,mons:[mon]}] }
 *
 * Notes / known limits for romhacks:
 *  - Species numbers are the game's INTERNAL ids; we map them straight to species.json ids.
 *  - Box Pokémon store EXP not level; level is computed from EXP via the species' growth rate when the
 *    app passes a growth map (else a Medium-Fast cube-root estimate). Party levels are read exact.
 *  - Boxes use Radical Red / CFRU's compressed 58-byte record (sectionIDs 5-13), reverse-engineered
 *    from the YARRE save editor (decodeBoxMon). Boxes 0-18 are read; later boxes use a more
 *    intricate cross-section layout that isn't decoded yet.
 *  - PID yields nature/gender/ability/shiny; ability maps to species.json [hidden, ability1, ability2].
 */
(function () {
  'use strict';
  const SECTION = 4096, SLOT = SECTION * 14, SIG = 0x08012025;
  const DATA_SIZE = [3884, 3968, 3968, 3968, 3968, 3968, 3968, 3968, 3968, 3968, 3968, 3968, 3968, 2000]; // per section id
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
  // Exact level from EXP using the species' growth rate (0=Medium Fast, 1=Erratic, 2=Fluctuating,
  // 3=Medium Slow, 4=Fast, 5=Slow). cumExp(n) = total EXP to REACH level n (standard Gen formulas).
  function cumExp(n, rate) {
    if (n <= 1) return 0;
    const c = n * n * n;
    switch (rate) {
      case 4: return Math.floor(4 * c / 5);                                            // Fast
      case 5: return Math.floor(5 * c / 4);                                            // Slow
      case 3: return Math.max(0, Math.floor(6 * c / 5 - 15 * n * n + 100 * n - 140));  // Medium Slow
      case 1:                                                                          // Erratic
        if (n < 50) return Math.floor(c * (100 - n) / 50);
        if (n < 68) return Math.floor(c * (150 - n) / 100);
        if (n < 98) return Math.floor(c * Math.floor((1911 - 10 * n) / 3) / 500);
        return Math.floor(c * (160 - n) / 100);
      case 2:                                                                          // Fluctuating
        if (n < 15) return Math.floor(c * (Math.floor((n + 1) / 3) + 24) / 50);
        if (n < 36) return Math.floor(c * (n + 14) / 50);
        return Math.floor(c * (Math.floor(n / 2) + 32) / 50);
      default: return c;                                                               // Medium Fast
    }
  }
  // Matches YARRE's xV: smallest level L (1..100) whose "exp to reach L+1" exceeds the stored EXP.
  function levelFromExpRate(exp, rate) {
    for (let L = 1; L < 100; L++) if (exp < cumExp(L + 1, rate)) return L;
    return 100;
  }
  let growthMap = null; // optional { speciesId: rateIndex } supplied by the app -> exact box levels

  function checksumOk(dv, off, id) {
    const n = DATA_SIZE[id] || 3968;
    let sum = 0;
    for (let i = 0; i < n; i += 4) sum = (sum + (dv.getUint32(off + i, true) >>> 0)) >>> 0;
    return (((sum & 0xFFFF) + (sum >>> 16)) & 0xFFFF) === dv.getUint16(off + 0x0FF6, true);
  }
  function readSlot(dv, base) {
    const sections = {}; let saveIndex = -1, found = 0, valid = 0;
    for (let i = 0; i < 14; i++) {
      const off = base + i * SECTION;
      if (dv.getUint32(off + 0x0FF8, true) !== SIG) continue;
      const id = dv.getUint16(off + 0x0FF4, true);
      if (id > 13) continue;
      sections[id] = off; found++;
      if (checksumOk(dv, off, id)) valid++;
      const idx = dv.getUint32(off + 0x0FFC, true) >>> 0;
      if (idx > saveIndex) saveIndex = idx;
    }
    return { sections, saveIndex, found, valid };
  }
  // Prefer a slot with section 0, then the most checksum-valid sections, then the newest counter.
  function pickSlot(a, b) {
    const cand = [a, b].filter((s) => s.found && s.sections[0] !== undefined);
    if (!cand.length) return a.found >= b.found ? a : b;
    cand.sort((x, y) => (y.valid - x.valid) || (y.saveIndex - x.saveIndex));
    return cand[0];
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

  const MAX_SPECIES = 1525; // sanity bound (RR goes up to ~1375)
  let isValidSpecies = null; // optional predicate(id)->bool supplied by the app (real species set)
  // Pull the 4 substructures (Growth/Attacks/EVs/Misc) from a 48-byte block given their byte offsets.
  function fields(b, G, A, E, M) {
    const species = b.getUint16(G, true);
    const ok = isValidSpecies ? isValidSpecies(species) : (species >= 1 && species <= MAX_SPECIES);
    if (!ok) return null;
    const ivWord = b.getUint32(M + 4, true) >>> 0;
    return {
      species,
      heldItem: b.getUint16(G + 2, true),
      exp: b.getUint32(G + 4, true) >>> 0,
      moves: [0, 2, 4, 6].map((o) => b.getUint16(A + o, true)).filter(Boolean),
      evs: [0, 1, 2, 3, 4, 5].map((o) => b.getUint8(E + o)),         // HP,Atk,Def,Spe,SpA,SpD
      ivs: [0, 5, 10, 15, 20, 25].map((sh) => (ivWord >>> sh) & 31), // HP,Atk,Def,Spe,SpA,SpD
      isEgg: !!((ivWord >>> 30) & 1),
      // Radical Red / CFRU repurposes the vanilla "abilityNum" bit (IV-word bit 31)
      // as a HIDDEN-ability flag. The regular ability1/2 choice is PID-parity (classic
      // Gen-3), resolved in decodeMon once we have the personality value.
      hiddenAbility: (ivWord >>> 31) & 1,
    };
  }

  function decodeMon(dv, off, isParty) {
    const pv = dv.getUint32(off, true) >>> 0;
    const otid = dv.getUint32(off + 4, true) >>> 0;
    if (pv === 0 && otid === 0) return null; // empty slot
    // copy the 48-byte substructure block
    const blk = new DataView(new ArrayBuffer(48));
    for (let i = 0; i < 48; i++) blk.setUint8(i, dv.getUint8(off + 0x20 + i));

    // Radical Red stores substructures PLAINTEXT in fixed G,A,E,M order. Try that first.
    let f = fields(blk, 0, 12, 24, 36);
    // Fallback: vanilla Gen-3 — decrypt with PV^OTID and unshuffle by PV%24.
    if (!f) {
      const key = (pv ^ otid) >>> 0;
      const dec = new DataView(new ArrayBuffer(48));
      for (let i = 0; i < 12; i++) dec.setUint32(i * 4, (blk.getUint32(i * 4, true) ^ key) >>> 0, true);
      const pos = {}; ORDER[pv % 24].split('').forEach((c, i) => { pos[c] = i * 12; });
      f = fields(dec, pos.G, pos.A, pos.E, pos.M);
    }
    if (!f) return null;

    const tid = otid & 0xFFFF, sid = (otid >>> 16) & 0xFFFF;
    f.shiny = ((tid ^ sid ^ (pv & 0xFFFF) ^ (pv >>> 16)) & 0xFFFF) < 8;
    f.nature = pv % 25;
    f.pid = pv;
    // ability slot into species.abilities = [hidden, ability1, ability2]:
    //   hidden flag set -> 0, else ability1/ability2 by PID parity (Gen-3 mechanic).
    f.ability = f.hiddenAbility ? 0 : 1 + (pv & 1);
    f.genderByte = pv & 0xFF;  // app resolves to M/F/N with the species gender ratio
    f.nickname = decodeStr(dv, off + 0x08, 10);
    f.otName = decodeStr(dv, off + 0x14, 7);
    f.level = isParty ? dv.getUint8(off + 0x54) : levelFromExp(f.exp);
    f.levelExact = !!isParty;
    return f;
  }

  // Radical Red / CFRU compressed BOX record (58 bytes). Layout reverse-engineered from the YARRE
  // save editor: PID@0, TID@4, SID@6, nickname@8 (10), OT name@20 (7), species@28, item@30,
  // exp@32, PP-ups@36, friendship@37, moves@39 (4 x 10-bit packed), EVs@44-49, IV word@54.
  function decodeBoxMon(dv, off) {
    const species = dv.getUint16(off + 28, true);
    if (!species) return null;
    const ok = isValidSpecies ? isValidSpecies(species) : (species >= 1 && species <= MAX_SPECIES);
    if (!ok) return null;
    const pv = dv.getUint32(off, true) >>> 0;
    const tid = dv.getUint16(off + 4, true), sid = dv.getUint16(off + 6, true);
    const u16 = (o) => dv.getUint16(off + o, true);
    const ivWord = dv.getUint32(off + 54, true) >>> 0;
    const exp = dv.getUint32(off + 32, true) >>> 0;
    return {
      species,
      heldItem: u16(30),
      exp,
      // moves: four 10-bit values bit-packed starting at byte 39
      moves: [(u16(39) >>> 0) & 0x3FF, (u16(40) >>> 2) & 0x3FF, (u16(41) >>> 4) & 0x3FF, (u16(42) >>> 6) & 0x3FF].filter(Boolean),
      evs: [44, 45, 46, 47, 48, 49].map((o) => dv.getUint8(off + o)),   // HP,Atk,Def,Spe,SpA,SpD
      ivs: [0, 5, 10, 15, 20, 25].map((sh) => (ivWord >>> sh) & 31),     // HP,Atk,Def,Spe,SpA,SpD
      isEgg: !!((ivWord >>> 30) & 1),
      hiddenAbility: (ivWord >>> 31) & 1,
      shiny: ((tid ^ sid ^ (pv & 0xFFFF) ^ (pv >>> 16)) & 0xFFFF) < 8,
      nature: pv % 25,
      pid: pv,
      ability: ((ivWord >>> 31) & 1) ? 0 : 1 + (pv & 1),  // species.json [hidden, ability1, ability2]
      genderByte: pv & 0xFF,
      nickname: decodeStr(dv, off + 8, 10),
      otName: decodeStr(dv, off + 20, 7),
      level: (growthMap && growthMap[species] != null) ? levelFromExpRate(exp, growthMap[species]) : levelFromExp(exp),
      levelExact: !!(growthMap && growthMap[species] != null),
    };
  }

  // YARRE box storage: sectionIDs 5-13 concatenated in 4080-byte chunks (the last contributes 424),
  // a 33064-byte buffer holding boxes 0-18; box b at offset 4 + b*1740, 30 slots of 58 bytes each.
  function assembleBoxes(dv, sections) {
    const CHUNK = 4080, LAST = 424, IDS = [5, 6, 7, 8, 9, 10, 11, 12, 13];
    const out = new Uint8Array(CHUNK * (IDS.length - 1) + LAST);
    for (let t = 0; t < IDS.length; t++) {
      const off = sections[IDS[t]];
      if (off === undefined) return null;
      const size = (t < IDS.length - 1) ? CHUNK : LAST;
      if (off + size > dv.buffer.byteLength) return null;
      out.set(new Uint8Array(dv.buffer, off, size), t * CHUNK);
    }
    return new DataView(out.buffer);
  }

  function parse(buffer, validSpecies, growth) {
    isValidSpecies = (typeof validSpecies === 'function') ? validSpecies : null;
    growthMap = (growth && typeof growth === 'object') ? growth : null;
    const diag = {};
    try {
      const dv = new DataView(buffer);
      if (buffer.byteLength < SLOT) return { ok: false, error: 'File too small to be a GBA save (' + buffer.byteLength + ' bytes).', diag };
      const a = readSlot(dv, 0), b = buffer.byteLength >= SLOT * 2 ? readSlot(dv, SLOT) : { sections: {}, saveIndex: -1, found: 0, valid: 0 };
      const slot = pickSlot(a, b);
      diag.slot = slot === a ? 'A' : 'B';
      diag.sectionsFound = slot.found;
      diag.sectionsValid = slot.valid;
      if (!slot.found) return { ok: false, error: 'No valid save sections found (signature mismatch).', diag };

      // Boxes: Radical Red / CFRU store box mons in a compressed 58-byte record (NOT vanilla 80B)
      // across sectionIDs 5-13. assembleBoxes builds the PC buffer; 19 boxes x 30 slots are read.
      const boxBuf = assembleBoxes(dv, slot.sections);
      const boxes = [];
      if (boxBuf) {
        const NUM_BOXES = 19, PER = 30, SIZE = 58, BOX = PER * SIZE, base = 4;
        for (let bx = 0; bx < NUM_BOXES; bx++) {
          const mons = [];
          for (let i = 0; i < PER; i++) {
            const off = base + bx * BOX + i * SIZE;
            if (off + SIZE > boxBuf.buffer.byteLength) break;
            const mon = decodeBoxMon(boxBuf, off);
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
