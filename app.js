/* Radical Red Pokédex — vanilla JS, no build step, GitHub Pages friendly.
 * Three top tabs: Pokémon (two-pane dex), Areas (full-width), Hardcore (full-width).
 * All data fetched from ./data/*.json with RELATIVE paths (Pages subpath safe). */
'use strict';

const DATA = {};
const STAT_LABELS = ['HP', 'Atk', 'Def', 'Spe', 'SpA', 'SpD'];
const MAX_STAT = 255;
const EFF = { 0: 1, 5: 0.5, 20: 2, 1: 0 };

const WILD_METHODS = {
  'wild-day': { label: 'Grass', group: 'grass', time: 'Day' },
  'wild-night': { label: 'Grass', group: 'grass', time: 'Night' },
  'wild-surf': { label: 'Surf', group: 'surf', time: null },
  'wild-oldRod': { label: 'Old Rod', group: 'fish', time: null },
  'wild-goodRod': { label: 'Good Rod', group: 'fish', time: null },
  'wild-superRod': { label: 'Super Rod', group: 'fish', time: null },
  'wild-smash': { label: 'Rock Smash', group: 'smash', time: null },
};
const WILD_ORDER = ['wild-day', 'wild-night', 'wild-surf', 'wild-oldRod', 'wild-goodRod', 'wild-superRod', 'wild-smash'];
const FIXED_METHODS = { 'fixed-gift': 'Gift', 'fixed-overworld': 'Static', 'fixed-trade': 'Trade', 'fixed-roaming': 'Roaming' };
const FIXED_ORDER = ['fixed-gift', 'fixed-overworld', 'fixed-trade', 'fixed-roaming'];
const ITEM_CATS = { 'item-standard': 'Ground', 'item-hidden': 'Hidden', 'item-shop': 'Shop', 'item-cheat': 'Cheat' };
const ITEM_ORDER = ['item-standard', 'item-hidden', 'item-shop', 'item-cheat'];
const METHOD_GROUPS = [{ key: 'grass', label: 'Grass' }, { key: 'surf', label: 'Surf' }, { key: 'fish', label: 'Fishing' }, { key: 'smash', label: 'Rock Smash' }];
const AREA_CATS = [{ key: 'wild', label: 'Wild' }, { key: 'items', label: 'Items' }, { key: 'trainers', label: 'Trainers' }, { key: 'raids', label: 'Raids' }, { key: 'fixed', label: 'Special' }];

let ENTRIES = [], TYPE_IDS = [], evolvesFromMap = {};
let AREAVIEW = [], monWild = {}, monFixed = {}, monRaid = {}, areaRank = {};
let mode = 'pokemon';
let splitMode = false, rightMode = null;   // second side-by-side pane
// pokemon
let activeId = null, pkSearch = '', activeMoveTab = 'level';
const pkFilters = { methods: new Set(), time: null };
// areas
let activeAreaIdx = null, areaView = 'index', areaSearch = '';
const areaFilters = { methods: new Set(), time: null, cats: new Set() };
// hardcore
let hcSub = 'order', activeBoss = null, bossSearch = '', bossBackTo = 'bosses';
const bossCat = new Set();
let playerHighest = 100;   // resolves scaled boss levels (codes 101–104) relative to your top mon
let bossSprite = {};       // trainerId -> trainer sprite URL (from the Hardcore sheet's =IMAGE cells)

/* ---------------- Loading ---------------- */
const FILES = ['species', 'sprites', 'types', 'abilities', 'moves', 'items', 'evolutions',
  'eggGroups', 'tmMoves', 'tutorMoves', 'splits', 'natures', 'scaledLevels', 'areas', 'trainers', 'hardcore', 'area-order'];

async function loadAll() {
  const results = await Promise.all(FILES.map(async (name) => {
    const res = await fetch('data/' + name + '.json');
    if (!res.ok) throw new Error(name + '.json → HTTP ' + res.status);
    return [name, await res.json()];
  }));
  for (const [name, json] of results) DATA[name] = json;
}
function fail(err) {
  const el = document.getElementById('loading');
  el.classList.add('error');
  document.getElementById('loading-text').innerHTML =
    '<b>Could not load the data.</b><br><br>Serve over <code>http://</code> (GitHub Pages does this). ' +
    'Locally: <code>python -m http.server 8000</code> then open ' +
    '<a href="http://localhost:8000/">localhost:8000</a>.<br><br><small>' + String(err) + '</small>';
}

/* ---------------- Helpers ---------------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const spriteFor = (s) => DATA.sprites[s.ID] || DATA.sprites[0] || '';
const pad = (n) => '#' + String(n).padStart(4, '0');
const lv = (min, max) => 'Lv ' + (min === max ? min : min + '–' + max);
const teamMax = (t) => { const a = (t.hardcore || []).map((m) => m.level); return a.length ? Math.max(...a) : 0; };
const teamMin = (t) => { const a = (t.hardcore || []).map((m) => m.level); return a.length ? Math.min(...a) : 0; };

function formName(s) {
  if (!s.key || s.key === s.name) return '';
  if (s.key.startsWith(s.name + '-')) return s.key.slice(s.name.length + 1).replace(/-/g, ' ');
  return s.key.replace(/-/g, ' ');
}
function typeChip(typeId, small) {
  const t = DATA.types[typeId];
  return t ? '<span class="type-chip' + (small ? ' sm' : '') + '" style="background:' + t.color + '">' + esc(t.name) + '</span>' : '';
}
function abilityList(s) {
  if (!s.abilities) return [];
  const seen = new Set(), out = [];
  s.abilities.forEach((pair, i) => {
    const id = pair[0];
    if (!id || seen.has(id) || !DATA.abilities[id]) return;
    seen.add(id);
    out.push({ name: DATA.abilities[id].names[0], desc: DATA.abilities[id].description, hidden: i === 2 });
  });
  return out;
}
const evoCache = {};
function evoCondition(evo) {
  const tmpl = DATA.evolutions[evo[0]];
  if (!tmpl) return '';
  const key = evo.join(',');
  if (key in evoCache) return evoCache[key];
  let txt = '';
  try { txt = new Function('evo', 'items', 'types', 'moves', 'species', 'return ' + tmpl)(evo, DATA.items, DATA.types, DATA.moves, DATA.species); } catch (_) { }
  return (evoCache[key] = txt);
}
function computeDefenses(s) {
  const g = { weak: [], resist: [], immune: [] };
  for (const atk of TYPE_IDS) {
    const t = DATA.types[atk];
    if (!t) continue;
    let m = 1;
    for (const d of s.type) m *= (EFF[t.matchup[d]] ?? 1);
    if (m > 1) g.weak.push([atk, m]); else if (m === 0) g.immune.push([atk, m]); else if (m < 1) g.resist.push([atk, m]);
  }
  g.weak.sort((a, b) => b[1] - a[1]); g.resist.sort((a, b) => a[1] - b[1]);
  return g;
}
const MULT_LABEL = { 4: '4×', 2: '2×', 0.5: '½', 0.25: '¼', 0: '0' };
function statColor(v) { return v < 50 ? '#e0533d' : v < 75 ? '#e08a3d' : v < 95 ? '#e0c23d' : v < 120 ? '#82c43d' : '#3dc0a8'; }
// Boss levels 101–104 are scaled codes (relative to your highest mon); resolve them.
function resolveLevel(code) {
  const sc = DATA.scaledLevels || {};
  if (code in sc) return Math.max(1, playerHighest + sc[code]);
  if (code > 100) return playerHighest;
  return code;
}
function typeTag(typeId) { return typeChip(typeId, true); }   // colored label (replaces the old dot)

/* ---------------- Modal ---------------- */
function openModal(html, cls) {
  const m = document.getElementById('modal');
  document.getElementById('modal-content').innerHTML = html;
  m.querySelector('.modal-box').className = 'modal-box' + (cls ? ' ' + cls : '');
  m.hidden = false;
}
function closeModal() { document.getElementById('modal').hidden = true; document.getElementById('modal-content').innerHTML = ''; }

/* ---------------- Index building ---------------- */
function buildEntries() {
  TYPE_IDS = Object.keys(DATA.types).map(Number);
  ENTRIES = Object.values(DATA.species).slice().sort((a, b) => (a.dexID - b.dexID) || (a.ID - b.ID));
  evolvesFromMap = {};
  for (const s of Object.values(DATA.species)) {
    if (!s.evolutions) continue;
    for (const evo of s.evolutions) (evolvesFromMap[evo[2]] = evolvesFromMap[evo[2]] || []).push({ from: s.ID, evo });
  }
}
function buildAreaIndex() {
  monWild = {}; monFixed = {}; monRaid = {};
  AREAVIEW = DATA.areas.map((area, idx) => {
    const v = { idx, name: area.name || ('Area ' + idx), wild: {}, items: {}, trainers: [], raids: {}, fixed: {}, tutors: [] };
    for (const key of WILD_ORDER) {
      if (!area[key]) continue;
      const map = new Map();
      for (const sub of Object.values(area[key])) for (const [id, min, max] of sub) {
        const cur = map.get(id);
        if (cur) { cur.min = Math.min(cur.min, min); cur.max = Math.max(cur.max, max); } else map.set(id, { id, min, max });
      }
      v.wild[key] = [...map.values()];
      for (const e of v.wild[key]) (monWild[e.id] = monWild[e.id] || []).push({ areaIdx: idx, key, min: e.min, max: e.max });
    }
    for (const key of ITEM_ORDER) if (area[key]) v.items[key] = [...new Set(Object.values(area[key]).flat())];
    if (area.trainers) v.trainers = [...new Set(Object.values(area.trainers).flat())];
    for (let star = 1; star <= 6; star++) {
      const k = 'raid' + star;
      if (!area[k]) continue;
      const ids = [...new Set(Object.values(area[k]).flat().map((e) => Array.isArray(e) ? e[0] : e))];
      v.raids[star] = ids;
      for (const id of ids) (monRaid[id] = monRaid[id] || []).push({ areaIdx: idx, star });
    }
    for (const key of FIXED_ORDER) {
      if (!area[key]) continue;
      const ids = [...new Set(Object.values(area[key]).flat())];
      v.fixed[key] = ids;
      for (const id of ids) (monFixed[id] = monFixed[id] || []).push({ areaIdx: idx, key });
    }
    if (area.tutors) v.tutors = [...new Set(Object.values(area.tutors).flat())];
    return v;
  });
  // Wild-area display order from the Locations file's "Grass & Caves" tab.
  areaRank = {};
  ((DATA['area-order'] && DATA['area-order'].wild) || []).forEach((idx, i) => { areaRank[idx] = i; });
}

/* ---------------- Encounter filter logic ---------------- */
function encMatch(meta, f) {
  if (f.methods.size && !f.methods.has(meta.group)) return false;
  if (f.time && meta.time && meta.time !== f.time) return false;
  return true;
}
const encActive = (f) => f.methods.size > 0 || f.time !== null;
function chipRow(items, prefix, activeSet, single) {
  return items.map((it) => {
    const on = single ? activeSet === it.key : activeSet.has(it.key);
    return '<button class="fchip' + (on ? ' on' : '') + '" data-f="' + prefix + ':' + it.key + '">' + esc(it.label) + '</button>';
  }).join('');
}

/* ================= POKÉMON ================= */
function renderPkFilters() {
  document.getElementById('pk-filters').innerHTML =
    '<div class="fchips">' + chipRow(METHOD_GROUPS, 'm', pkFilters.methods) + '</div>' +
    '<div class="fchips">' + chipRow([{ key: 'Day', label: '☀ Day' }, { key: 'Night', label: '☾ Night' }], 't', pkFilters.time, true) + '</div>';
}
function pkMatchesText(s, q) {
  if (!q) return true;
  if (s.name.toLowerCase().includes(q) || (s.key && s.key.toLowerCase().includes(q))) return true;
  if (pad(s.dexID).includes(q) || String(s.dexID) === q) return true;
  return s.type.some((t) => DATA.types[t] && DATA.types[t].name.toLowerCase() === q);
}
function pkPassesFilter(s) {
  if (!encActive(pkFilters)) return true;
  return (monWild[s.ID] || []).some((w) => encMatch(WILD_METHODS[w.key], pkFilters));
}
let pkImgObs;
function renderPkList() {
  const list = document.getElementById('pk-list');
  list.innerHTML = '';
  const q = pkSearch.trim().toLowerCase();
  const frag = document.createDocumentFragment();
  let shown = 0;
  for (const s of ENTRIES) {
    if (!pkMatchesText(s, q) || !pkPassesFilter(s)) continue;
    shown++;
    const li = document.createElement('li');
    li.className = 'row' + (s.ID === activeId ? ' active' : '');
    li.dataset.id = s.ID;
    const form = formName(s);
    li.innerHTML = '<img class="row-img" alt="" data-sprite="' + s.ID + '">' +
      '<div class="row-main"><div class="row-name">' + esc(s.name) +
      (form ? ' <span class="row-form">' + esc(form) + '</span>' : '') + '</div>' +
      '<div class="row-sub"><span class="row-num">' + pad(s.dexID) + '</span>' +
      s.type.map((t) => typeTag(t)).join('') +
      '</div></div>';
    frag.appendChild(li);
  }
  list.appendChild(frag);
  document.getElementById('pk-count').textContent = shown + (q || encActive(pkFilters) ? ' of ' + ENTRIES.length : '') + ' Pokémon';
  if (pkImgObs) pkImgObs.disconnect();
  pkImgObs = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { e.target.src = DATA.sprites[e.target.dataset.sprite] || DATA.sprites[0] || ''; pkImgObs.unobserve(e.target); }
  }, { root: list, rootMargin: '200px' });
  list.querySelectorAll('.row-img').forEach((i) => pkImgObs.observe(i));
}
function selectSpecies(id, fromHash) {
  if (!DATA.species[id]) return;
  activeId = Number(id); activeMoveTab = 'level';
  renderDetail(DATA.species[id]);
  document.querySelectorAll('#pk-list .row').forEach((r) => r.classList.toggle('active', Number(r.dataset.id) === activeId));
  const a = document.querySelector('#pk-list .row.active');
  if (a) a.scrollIntoView({ block: 'nearest' });
  document.getElementById('pk-detail').scrollTop = 0;
  if (!fromHash) setHash(String(id));
}
function renderDetail(s) {
  const total = s.stats.reduce((a, b) => a + b, 0), form = formName(s);
  const abilities = abilityList(s), def = computeDefenses(s);
  const heldItems = (s.items || []).filter((i) => i && DATA.items[i]).map((i) => esc(DATA.items[i].name));
  const eggGroups = [...new Set((s.eggGroup || []).map((e) => DATA.eggGroups[e]).filter(Boolean).filter((n) => n !== 'None'))];
  let html = '<div class="d-head"><img class="d-art" src="' + spriteFor(s) + '" alt="' + esc(s.name) + '">' +
    '<div class="d-titles"><div class="d-num">' + pad(s.dexID) + '</div><div class="d-name">' + esc(s.name) + '</div>' +
    (form ? '<div class="d-form">' + esc(form) + '</div>' : '') +
    '<div class="d-types">' + s.type.map((t) => typeChip(t)).join('') + '</div></div></div>';
  html += '<div class="grid-2"><section class="card"><h2>Base Stats</h2>';
  s.stats.forEach((v, i) => {
    html += '<div class="stat"><span class="stat-label">' + STAT_LABELS[i] + '</span><span class="stat-val">' + v +
      '</span><span class="stat-bar"><i style="width:' + Math.min(100, v / MAX_STAT * 100) + '%;background:' + statColor(v) + '"></i></span></div>';
  });
  html += '<div class="stat total"><span class="stat-label">BST</span><span class="stat-val">' + total + '</span><span></span></div></section>';
  html += '<section class="card"><h2>Type Defenses</h2>' + defenseGroup('Weak to', def.weak) + defenseGroup('Resists', def.resist) + defenseGroup('Immune to', def.immune);
  if (!def.weak.length && !def.resist.length && !def.immune.length) html += '<div class="ability-desc">No notable matchups.</div>';
  html += '</section></div>';
  html += '<section class="card"><h2>Abilities</h2>';
  for (const a of abilities) html += '<div class="kv"><div class="v"><span class="ability-name">' + esc(a.name) + '</span>' +
    (a.hidden ? '<span class="tag">Hidden</span>' : '') + '<div class="ability-desc">' + esc(a.desc || '') + '</div></div></div>';
  if (!abilities.length) html += '<div class="ability-desc">—</div>';
  html += '<div class="kv" style="margin-top:10px"><div class="k">Egg Groups</div><div class="v">' + (eggGroups.length ? eggGroups.map(esc).join(', ') : '—') + '</div></div>';
  if (heldItems.length) html += '<div class="kv"><div class="k">Wild Held Items</div><div class="v">' + heldItems.join(', ') + '</div></div>';
  html += '</section>';
  const evo = evolutionSection(s);
  if (evo) html += evo;
  html += locationsSection(s) + movesSection(s);
  document.getElementById('pk-detail-content').innerHTML = html;
  wireMoveTabs(s);
}
function defenseGroup(label, arr) {
  if (!arr.length) return '';
  return '<div class="def-group"><div class="lbl">' + label + '</div><div class="def-list">' +
    arr.map(([t, m]) => '<span class="def-chip">' + typeChip(t, true) + '<span class="mult">' + (MULT_LABEL[m] || (m + '×')) + '</span></span>').join('') + '</div></div>';
}
function evolutionSection(s) {
  const froms = evolvesFromMap[s.ID] || [], intos = s.evolutions || [];
  if (!froms.length && !intos.length) return '';
  let html = '<section class="card"><h2>Evolution</h2><div class="evo-row">';
  for (const f of froms) { const p = DATA.species[f.from]; if (p) html += evoCard(p, '← ' + (evoCondition(f.evo) || 'evolves into this')); }
  if (froms.length && intos.length) html += '<div class="evo-sep">·</div>';
  for (const evo of intos) { const t = DATA.species[evo[2]]; if (t) html += evoCard(t, '→ ' + (evoCondition(evo) || '')); }
  return html + '</div></section>';
}
function evoCard(s, cond) {
  const form = formName(s);
  return '<div class="evo-card" data-go-mon="' + s.ID + '"><img src="' + spriteFor(s) + '" alt="' + esc(s.name) + '">' +
    '<div class="en">' + esc(s.name) + (form ? ' <span class="row-form">' + esc(form) + '</span>' : '') + '</div><div class="ec">' + esc(cond) + '</div></div>';
}
function locationsSection(s) {
  const link = (idx, meta) => '<div class="loc-row"><span class="loc-area" data-go-area="' + idx + '">' + esc(AREAVIEW[idx].name) + '</span><span class="loc-meta">' + esc(meta) + '</span></div>';
  let rows = '';
  for (const w of (monWild[s.ID] || []).slice().sort((a, b) => a.areaIdx - b.areaIdx)) {
    const m = WILD_METHODS[w.key];
    rows += link(w.areaIdx, (m.time ? m.label + ' (' + m.time + ')' : m.label) + ' · ' + lv(w.min, w.max));
  }
  for (const f of (monFixed[s.ID] || [])) rows += link(f.areaIdx, FIXED_METHODS[f.key]);
  for (const r of (monRaid[s.ID] || [])) rows += link(r.areaIdx, 'Raid ' + r.star + '★');
  if (!rows) rows = '<div class="ability-desc">Not found in the wild — obtain via evolution, trade, or special event.</div>';
  return '<section class="card"><h2>Locations</h2>' + rows + '</section>';
}
function movesFor(s, tab) {
  if (tab === 'level') return (s.levelupMoves || []).slice().sort((a, b) => a[1] - b[1]).map(([id, l]) => ({ id, lv: l }));
  if (tab === 'tm') return (s.tmMoves || []).map((n) => ({ id: DATA.tmMoves[n], tm: n })).filter((m) => m.id);
  if (tab === 'tutor') return (s.tutorMoves || []).map((n) => ({ id: DATA.tutorMoves[n] })).filter((m) => m.id);
  if (tab === 'egg') return (s.eggMoves || []).map((id) => ({ id })).filter((m) => DATA.moves[m.id]);
  return [];
}
function movesSection(s) {
  const counts = { level: (s.levelupMoves || []).length, tm: (s.tmMoves || []).length, tutor: (s.tutorMoves || []).length, egg: (s.eggMoves || []).length };
  let html = '<section class="card"><h2>Moves</h2><div class="tabs">';
  for (const [k, l] of [['level', 'Level-Up'], ['tm', 'TM'], ['tutor', 'Tutor'], ['egg', 'Egg']])
    html += '<span class="tab' + (k === activeMoveTab ? ' active' : '') + '" data-tab="' + k + '">' + l + '<span class="c">' + counts[k] + '</span></span>';
  return html + '</div><div id="moves-body">' + movesTable(s, activeMoveTab) + '</div></section>';
}
function movesTable(s, tab) {
  const rows = movesFor(s, tab);
  if (!rows.length) return '<div class="mv-empty">No ' + ({ level: 'level-up', tm: 'TM', tutor: 'tutor', egg: 'egg' }[tab]) + ' moves.</div>';
  const first = tab === 'level' ? '<th class="num">Lv</th>' : (tab === 'tm' ? '<th class="num">TM</th>' : '');
  let html = '<table class="mtable"><thead><tr>' + first + '<th>Move</th><th>Type</th><th>Cat</th><th class="num">Pwr</th><th class="num">Acc</th><th class="num">PP</th></tr></thead><tbody>';
  for (const r of rows) {
    const m = DATA.moves[r.id]; if (!m) continue;
    const cat = DATA.splits[m.split];
    const fc = tab === 'level' ? '<td class="num">' + (r.lv || '—') + '</td>' : (tab === 'tm' ? '<td class="num">' + r.tm + '</td>' : '');
    html += '<tr>' + fc + '<td class="mv-name" title="' + esc(m.description || '') + '">' + esc(m.name) + '</td><td>' + typeChip(m.type, true) + '</td><td>' +
      (DATA.sprites[cat] ? '<img class="cat-icon" src="' + DATA.sprites[cat] + '" alt="' + esc(cat) + '" title="' + esc(cat) + '">' : esc(cat || '')) +
      '</td><td class="num">' + (m.power || '—') + '</td><td class="num">' + (m.accuracy || '—') + '</td><td class="num">' + (m.pp || '—') + '</td></tr>';
  }
  return html + '</tbody></table>';
}
function wireMoveTabs(s) {
  document.querySelectorAll('#pk-detail .tab').forEach((tab) => tab.addEventListener('click', () => {
    activeMoveTab = tab.dataset.tab;
    document.querySelectorAll('#pk-detail .tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.getElementById('moves-body').innerHTML = movesTable(s, activeMoveTab);
  }));
}

/* ================= AREAS (full width) ================= */
function areaSummary(a) {
  const wc = new Set(WILD_ORDER.flatMap((k) => (a.wild[k] || []).map((e) => e.id))).size;
  const ic = ITEM_ORDER.reduce((n, k) => n + (a.items[k] ? a.items[k].length : 0), 0);
  const bits = [];
  if (wc) bits.push(wc + ' wild'); if (ic) bits.push(ic + ' item' + (ic > 1 ? 's' : ''));
  if (a.trainers.length) bits.push(a.trainers.length + ' trainer' + (a.trainers.length > 1 ? 's' : ''));
  if (Object.keys(a.raids).length) bits.push('raids');
  return bits.join(' · ') || 'no data';
}
function catPresent(a) {
  return {
    wild: WILD_ORDER.some((k) => a.wild[k] && a.wild[k].length), items: ITEM_ORDER.some((k) => a.items[k] && a.items[k].length),
    trainers: a.trainers.length > 0, raids: Object.keys(a.raids).length > 0, fixed: FIXED_ORDER.some((k) => a.fixed[k] && a.fixed[k].length),
  };
}
function passesAreaFilter(a) {
  if (encActive(areaFilters) && !WILD_ORDER.some((k) => a.wild[k] && a.wild[k].length && encMatch(WILD_METHODS[k], areaFilters))) return false;
  if (areaFilters.cats.size) { const h = catPresent(a); if (![...areaFilters.cats].some((c) => h[c])) return false; }
  return true;
}
function showAreaIndex() {
  areaView = 'index';
  document.getElementById('ar-body').innerHTML =
    '<div class="page"><div class="page-head"><h1>Areas</h1></div>' +
    '<input id="ar-search" class="page-search" type="search" placeholder="Search areas…" autocomplete="off" value="' + esc(areaSearch) + '">' +
    '<div id="ar-filters"></div><div id="ar-count" class="count"></div><div id="ar-grid" class="card-grid"></div></div>';
  renderAreaFilters(); renderAreaGrid();
}
function renderAreaFilters() {
  document.getElementById('ar-filters').innerHTML =
    '<div class="fchips">' + chipRow(METHOD_GROUPS, 'm', areaFilters.methods) + '</div>' +
    '<div class="fchips">' + chipRow([{ key: 'Day', label: '☀ Day' }, { key: 'Night', label: '☾ Night' }], 't', areaFilters.time, true) + '</div>' +
    '<div class="fchips">' + chipRow(AREA_CATS, 'c', areaFilters.cats) + '</div>';
}
function renderAreaGrid() {
  const q = areaSearch.trim().toLowerCase();
  let list = AREAVIEW.filter((a) => (!q || a.name.toLowerCase().includes(q)) && passesAreaFilter(a));
  // When browsing wild areas, list them in the Locations file's order (Grass & Caves).
  const wildContext = areaFilters.cats.has('wild') || encActive(areaFilters);
  if (wildContext) list = list.slice().sort((a, b) => ((areaRank[a.idx] ?? (1e6 + a.idx)) - (areaRank[b.idx] ?? (1e6 + b.idx))));
  const html = list.map((a) => '<div class="acard" data-go-area="' + a.idx + '"><div class="acard-name">' +
    esc(a.name) + '</div><div class="acard-sub">' + esc(areaSummary(a)) + '</div></div>').join('');
  document.getElementById('ar-grid').innerHTML = html || '<div class="ability-desc">No areas match the filters.</div>';
  document.getElementById('ar-count').textContent = list.length + ' of ' + AREAVIEW.length + ' areas' + (wildContext ? ' · locations-file order' : '');
}
function showArea(idx) {
  const a = AREAVIEW[idx];
  if (!a) return;
  activeAreaIdx = idx; areaView = 'detail';
  document.getElementById('ar-body').innerHTML =
    '<div class="page"><button class="back" data-back="areas">← All areas</button>' + areaDetailHtml(a) + '</div>';
  document.getElementById('view-areas').scrollTop = 0;
  setHash('a' + idx);
}
function monChip(id, extra) {
  const s = DATA.species[id];
  if (!s) return '';
  const form = formName(s);
  return '<span class="mon-chip" data-go-mon="' + id + '"><img src="' + spriteFor(s) + '" alt="" loading="lazy">' +
    '<span class="mc-name">' + esc(s.name) + (form ? ' <span class="row-form">' + esc(form) + '</span>' : '') + '</span>' +
    (extra ? '<span class="mc-lv">' + esc(extra) + '</span>' : '') + '</span>';
}
function areaDetailHtml(a) {
  let html = '<div class="page-head"><h1>' + esc(a.name) + '</h1></div>';
  let wild = '';
  for (const key of WILD_ORDER) {
    const list = a.wild[key]; if (!list || !list.length) continue;
    const m = WILD_METHODS[key];
    wild += '<div class="enc-block"><div class="enc-head">' + esc(m.time ? m.label + ' (' + m.time + ')' : m.label) + '</div><div class="mon-grid">' +
      list.slice().sort((x, y) => x.min - y.min).map((e) => monChip(e.id, lv(e.min, e.max))).join('') + '</div></div>';
  }
  if (wild) html += '<section class="card"><h2>Wild Encounters</h2>' + wild + '</section>';
  let items = '';
  for (const key of ITEM_ORDER) {
    const ids = a.items[key]; if (!ids || !ids.length) continue;
    items += '<div class="kv"><div class="k">' + ITEM_CATS[key] + '</div><div class="v">' + ids.map((i) => DATA.items[i] ? esc(DATA.items[i].name) : '#' + i).join(', ') + '</div></div>';
  }
  if (items) html += '<section class="card"><h2>Items</h2>' + items + '<div class="ability-desc" style="margin-top:8px">Hidden items need the Dowsing Machine.</div></section>';
  let fx = '';
  for (const key of FIXED_ORDER) { const ids = a.fixed[key]; if (!ids || !ids.length) continue; fx += '<div class="enc-block"><div class="enc-head">' + FIXED_METHODS[key] + '</div><div class="mon-grid">' + ids.map((id) => monChip(id)).join('') + '</div></div>'; }
  if (fx) html += '<section class="card"><h2>Special Encounters</h2>' + fx + '</section>';
  if (Object.keys(a.raids).length) {
    let r = '';
    for (let star = 6; star >= 1; star--) { if (!a.raids[star] || !a.raids[star].length) continue; r += '<div class="enc-block"><div class="enc-head">' + star + '★ Raid</div><div class="mon-grid">' + a.raids[star].map((id) => monChip(id)).join('') + '</div></div>'; }
    html += '<section class="card"><h2>Raid Dens</h2>' + r + '</section>';
  }
  if (a.trainers.length) {
    const names = a.trainers.map((id) => DATA.trainers[id] ? esc(DATA.trainers[id].name) : '#' + id);
    html += '<section class="card"><h2>Trainers <span class="h2c">' + names.length + '</span></h2><div class="trainer-list">' + names.join(' · ') + '</div></section>';
  }
  if (a.tutors.length) {
    const moves = a.tutors.map((n) => DATA.tutorMoves[n]).filter(Boolean).map((mid) => DATA.moves[mid] ? esc(DATA.moves[mid].name) : '#' + mid);
    if (moves.length) html += '<section class="card"><h2>Move Tutors</h2><div class="trainer-list">' + moves.join(' · ') + '</div></section>';
  }
  return html;
}

/* ================= HARDCORE (full width) ================= */
function renderHardcore() {
  const tabs = [['order', 'Trainer Order'], ['bosses', 'Bosses'], ['info', 'Info']].map(([k, l]) =>
    '<button class="subtab' + (hcSub === k ? ' active' : '') + '" data-sub="' + k + '">' + l + '</button>').join('');
  const controls = '<div class="hc-controls">' +
    '<label class="hl-input" title="Your highest Pokémon\'s level — scales boss levels (codes 101–104)">Highest Lv ' +
    '<input id="hl" type="number" min="1" max="255" value="' + playerHighest + '"></label>' +
    '<button class="dex-btn" data-dex>📘 Pokédex</button></div>';
  const nav = '<div class="subbar"><div class="subtabs">' + tabs + '</div>' + controls + '</div>';
  let body = hcSub === 'order' ? trainerOrderHtml() : hcSub === 'bosses' ? bossesHtml() : infoHtml();
  document.getElementById('hc-body').innerHTML = '<div class="page">' + nav + body + '</div>';
  document.getElementById('view-hardcore').scrollTop = 0;
}
function trainerOrderHtml() {
  const order = DATA.hardcore.trainerOrder || [];
  let rows = '';
  let lastCap = null;
  for (const e of order) {
    if (e.cap !== lastCap) { rows += '<div class="to-cap">Level Cap ' + esc(e.cap) + '</div>'; lastCap = e.cap; }
    const link = e.trainerId ? ' data-go-boss="' + e.trainerId + '"' : '';
    rows += '<div class="to-row' + (e.trainerId ? ' linkable' : '') + '"' + link + '>' +
      '<span class="to-name">' + esc(e.name) + (e.optional ? '<span class="to-opt">optional</span>' : '') + '</span>' +
      '<span class="to-loc">' + esc(e.location || '') + '</span></div>';
  }
  return '<div class="page-head"><h1>Trainer Order</h1><p class="page-sub">Story-order fights with their level caps. Click a linked trainer to see the Hardcore team.</p></div>' +
    '<div class="to-list">' + rows + '</div>';
}
function bossCatList() { return (DATA.hardcore.categories || []).map((c) => ({ key: c.name, label: c.name })); }
function bossesHtml() {
  return '<div class="page-head"><h1>Hardcore Bosses</h1></div>' +
    '<input id="hc-search" class="page-search" type="search" placeholder="Search bosses…" autocomplete="off" value="' + esc(bossSearch) + '">' +
    '<div id="hc-filters" class="fchips">' + chipRow(bossCatList(), 'b', bossCat) + '</div>' +
    '<div id="hc-grid" class="card-grid wide"></div>';
}
function renderBossGrid() {
  const q = bossSearch.trim().toLowerCase();
  let html = '', shown = 0;
  for (const cat of (DATA.hardcore.categories || [])) {
    if (bossCat.size && !bossCat.has(cat.name)) continue;
    for (const b of cat.bosses) {
      if (q && !b.name.toLowerCase().includes(q) && !b.trainerName.toLowerCase().includes(q)) continue;
      shown++;
      const t = DATA.trainers[b.trainerId];
      const sprites = (t && t.hardcore || []).slice(0, 6).map((m) => { const sp = DATA.species[m.species]; return sp ? '<img src="' + spriteFor(sp) + '" alt="">' : ''; }).join('');
      const lo = Math.min(resolveLevel(b.minLevel), resolveLevel(b.maxLevel));
      const hi = Math.max(resolveLevel(b.minLevel), resolveLevel(b.maxLevel));
      html += '<div class="bcard" data-go-boss="' + b.trainerId + '"><div class="bcard-top"><span class="bcard-cat">' + esc(cat.name) + '</span>' +
        '<span class="bcard-lv">Lv ' + (lo === hi ? lo : lo + '–' + hi) + '</span></div>' +
        '<div class="bcard-name">' + esc(b.trainerName) + '</div><div class="bcard-where">' + esc(b.name) + '</div>' +
        '<div class="bcard-team">' + sprites + '</div></div>';
    }
  }
  document.getElementById('hc-grid').innerHTML = html || '<div class="ability-desc">No bosses match.</div>';
}
function infoHtml() {
  const info = DATA.hardcore.info || [];
  let body = '';
  for (const s of info) {
    if (typeof s === 'string') { body += '<section class="card"><div class="hc-line">' + esc(s) + '</div></section>'; continue; }
    body += '<section class="card"><h2>' + esc(s.title) + '</h2>';
    if (s.type === 'caps') {
      body += '<div class="cap-grid">' + s.items.map((c) =>
        '<div class="cap-item"><span class="cap-label">' + esc(c.label) + '</span><span class="cap-val">' +
        (c.cap != null ? c.cap : '') + '</span></div>').join('') + '</div>';
    } else if (s.type === 'abilities') {
      body += '<div class="ab-grid">' + s.items.map((it) => {
        const p = it.split('→');
        return '<div class="ab-item">' + (p.length === 2
          ? '<span class="ab-from">' + esc(p[0].trim()) + '</span><span class="ab-arrow">→</span><span class="ab-to">' + esc(p[1].trim()) + '</span>'
          : esc(it)) + '</div>';
      }).join('') + '</div>';
    } else {
      body += '<ul class="info-list">' + s.items.map((it) => '<li>' + esc(it) + '</li>').join('') + '</ul>';
    }
    body += '</section>';
  }
  return '<div class="page-head"><h1>Hardcore Mode — Info &amp; Restrictions</h1></div>' + body;
}
function trainerSprite(t) {
  const url = bossSprite[t.ID];
  return url
    ? '<img class="tr-img" src="' + esc(url) + '" alt="' + esc(t.name) + '" referrerpolicy="no-referrer" ' +
      'onerror="this.outerHTML=\'<div class=&quot;tr-ph&quot;>🧑‍🎤</div>\'">'
    : '<div class="tr-ph" title="' + esc(t.name) + '">🧑‍🎤</div>';
}
function showBoss(id) {
  const t = DATA.trainers[id];
  if (!t) return;
  activeBoss = Number(id);
  const team = t.hardcore || [];
  const lvls = team.map((m) => resolveLevel(m.level));
  const range = lvls.length ? (Math.min(...lvls) === Math.max(...lvls) ? Math.min(...lvls) : Math.min(...lvls) + '–' + Math.max(...lvls)) : '';
  const minis = team.map((m) => { const sp = DATA.species[m.species]; return sp ? '<img class="tr-mini" src="' + spriteFor(sp) + '" alt="" title="' + esc(sp.name) + '">' : ''; }).join('');
  const html = '<div class="boss-head">' + trainerSprite(t) +
    '<div class="boss-meta"><div class="d-num">Hardcore Boss</div><h1>' + esc(t.name) + '</h1>' +
    (team.length ? '<p class="page-sub">Level ' + range + ' · ' + team.length + ' Pokémon</p>' : '') +
    '<div class="tr-minis">' + minis + '</div></div></div>' +
    '<div class="team-grid">' + team.map(bossMonCard).join('') + '</div>';
  openModal(html, 'boss-modal');
}
function evIvLine(arr, label) {
  if (!arr) return '';
  const parts = [];
  arr.forEach((v, i) => { if (label === 'EVs' ? v > 0 : v < 31) parts.push(v + ' ' + STAT_LABELS[i]); });
  return parts.length ? '<span class="evk">' + label + '</span> ' + parts.join(' / ') : '';
}

/* ---------------- Mini Pokédex modal ---------------- */
let dexQuery = '', dexSel = null;
function openDexModal() {
  openModal('<div class="dex-modal"><div class="dex-head"><h2>Pokédex</h2>' +
    '<input id="dex-q" type="search" placeholder="Search name, #number, or type…" autocomplete="off"></div>' +
    '<div class="dex-body"><ul id="dex-list" class="dex-list"></ul><div id="dex-detail" class="dex-detail"></div></div></div>', 'dex-modal-box');
  dexQuery = '';
  renderDexList();
  selectDexMon(dexSel || activeId || ENTRIES[0].ID);
}
function renderDexList() {
  const q = dexQuery.trim().toLowerCase();
  let html = '', n = 0;
  for (const s of ENTRIES) {
    if (!pkMatchesText(s, q)) continue;
    if (++n > 400) break;
    html += '<li class="dex-row' + (s.ID === dexSel ? ' active' : '') + '" data-dexid="' + s.ID + '">' +
      '<img src="' + spriteFor(s) + '" alt=""><span class="dex-rn">' + esc(s.name) + '</span><span class="dex-rnum">' + pad(s.dexID) + '</span></li>';
  }
  const el = document.getElementById('dex-list');
  if (el) el.innerHTML = html || '<li class="dex-empty">No matches</li>';
}
function selectDexMon(id) {
  const s = DATA.species[id];
  if (!s) return;
  dexSel = Number(id);
  const total = s.stats.reduce((a, b) => a + b, 0), form = formName(s);
  let html = '<div class="dex-d-top"><div class="dex-d-head"><img src="' + spriteFor(s) + '" alt="' + esc(s.name) + '">' +
    '<div><div class="d-num">' + pad(s.dexID) + '</div><div class="dex-d-name">' + esc(s.name) +
    (form ? ' <span class="row-form">' + esc(form) + '</span>' : '') + '</div>' +
    '<div class="d-types">' + s.type.map((t) => typeChip(t)).join('') + '</div></div></div>';
  html += '<h3 class="dex-h">Base Stats</h3>';
  s.stats.forEach((v, i) => {
    html += '<div class="stat"><span class="stat-label">' + STAT_LABELS[i] + '</span><span class="stat-val">' + v +
      '</span><span class="stat-bar"><i style="width:' + Math.min(100, v / MAX_STAT * 100) + '%;background:' + statColor(v) + '"></i></span></div>';
  });
  html += '<div class="stat total"><span class="stat-label">BST</span><span class="stat-val">' + total + '</span><span></span></div></div>';
  html += '<div class="dex-moves"><h3 class="dex-h">Level-Up Moves</h3><div class="dex-moves-scroll">' + movesTable(s, 'level') + '</div></div>';
  const el = document.getElementById('dex-detail');
  if (el) { el.innerHTML = html; el.scrollTop = 0; }
  document.querySelectorAll('#dex-list .dex-row').forEach((r) => r.classList.toggle('active', Number(r.dataset.dexid) === dexSel));
}
function bossMonCard(m) {
  const sp = DATA.species[m.species];
  if (!sp) return '';
  const slot = sp.abilities && sp.abilities[m.ability] && sp.abilities[m.ability][0];
  const ab = slot && DATA.abilities[slot] ? DATA.abilities[slot].names[0] : '—';
  const item = m.item && DATA.items[m.item] ? DATA.items[m.item].name : null;
  const nature = DATA.natures[m.nature] || '';
  const moves = (m.moves || []).filter(Boolean).map((id) => { const mv = DATA.moves[id]; return mv ? '<span class="bm-move">' + typeChip(mv.type, true) + '<span class="bm-mname">' + esc(mv.name) + '</span></span>' : ''; }).join('');
  const meta = [item, nature ? nature + ' nature' : ''].filter(Boolean).map(esc).join(' · ');
  const ev = evIvLine(m.EVs, 'EVs'), iv = evIvLine(m.IVs, 'IVs');
  return '<div class="team-card"><div class="tc-head" data-go-mon="' + m.species + '"><img src="' + spriteFor(sp) + '" alt="">' +
    '<div class="tc-id"><div class="tc-name">' + esc(sp.name) + ' <span class="tc-lv">Lv ' + resolveLevel(m.level) + '</span></div><div class="tc-types">' + sp.type.map((t) => typeChip(t, true)).join('') + '</div></div></div>' +
    '<div class="tc-info"><div class="tc-ab"><b>' + esc(ab) + '</b>' + (meta ? ' · ' + meta : '') + '</div><div class="tc-moves">' + moves + '</div>' +
    (ev ? '<div class="tc-ev">' + ev + '</div>' : '') + (iv ? '<div class="tc-ev">' + iv + '</div>' : '') + '</div></div>';
}

/* ================= Navigation ================= */
const SECTIONS = ['pokemon', 'areas', 'hardcore', 'calc'];
function ensureCalc() {
  const f = document.getElementById('calc-frame');
  if (f && !f.src && f.dataset.src) f.src = f.dataset.src;  // lazy-load the ~8 MB calc on first open
}
function renderSection(sec) {
  if (sec === 'areas') { if (areaView === 'detail' && activeAreaIdx != null) showArea(activeAreaIdx); else showAreaIndex(); }
  else if (sec === 'hardcore') { renderHardcore(); if (hcSub === 'bosses') renderBossGrid(); }
  else if (sec === 'calc') ensureCalc();
  // pokemon view persists (list + detail already rendered)
}
function updateViews() {
  SECTIONS.forEach((sec) => {
    const v = document.getElementById('view-' + sec);
    v.hidden = !(sec === mode || (splitMode && sec === rightMode));
    v.style.order = sec === mode ? 0 : 1;   // primary (mode) on the left, right pane after
  });
  document.getElementById('app').classList.toggle('split', splitMode);
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('#tabs-right button').forEach((b) => b.classList.toggle('active', b.dataset.rmode === rightMode));
  document.getElementById('tabs-right').hidden = !splitMode;
  document.getElementById('split-btn').classList.toggle('on', splitMode);
}
function setMode(m, fromHash) {
  mode = m;
  if (splitMode && rightMode === m) rightMode = SECTIONS.find((s) => s !== m);
  updateViews();
  renderSection(m);
  if (splitMode && rightMode) renderSection(rightMode);
  if (!fromHash) setHash(m === 'pokemon' ? (activeId ? String(activeId) : '') : m === 'areas' ? 'areas' : m === 'calc' ? 'calc' : hcSub);
}
function setRightMode(sec) { if (sec === mode) return; rightMode = sec; updateViews(); renderSection(sec); }
function toggleSplit() {
  splitMode = !splitMode;
  if (splitMode && (!rightMode || rightMode === mode)) rightMode = SECTIONS.find((s) => s !== mode);
  updateViews();
  if (splitMode && rightMode) renderSection(rightMode);
}
function goMon(id) { if (mode !== 'pokemon') setMode('pokemon', true); selectSpecies(id); }
function goArea(idx) { if (mode !== 'areas') setMode('areas', true); showArea(idx); }
function goBoss(id) { if (mode !== 'hardcore') setMode('hardcore', true); showBoss(id); }
function setHcSub(sub) { hcSub = sub; activeBoss = null; renderHardcore(); if (sub === 'bosses') renderBossGrid(); setHash(sub); }

/* ================= Hash routing ================= */
let suppressHash = false;
function setHash(h) { suppressHash = true; location.hash = h ? '#' + h : ''; setTimeout(() => { suppressHash = false; }, 0); }
function applyHash() {
  const h = location.hash.slice(1);
  if (h === 'areas') { setMode('areas', true); showAreaIndex(); return true; }
  if (h[0] === 'a' && /^a\d+$/.test(h)) { goArea(Number(h.slice(1))); return true; }
  if (h.startsWith('boss') && DATA.trainers[h.slice(4)]) { goBoss(Number(h.slice(4))); return true; }
  if (h === 'calc') { setMode('calc', true); return true; }
  if (h === 'order' || h === 'bosses' || h === 'info') { setMode('hardcore', true); hcSub = h; renderHardcore(); if (h === 'bosses') renderBossGrid(); return true; }
  const id = Number(h);
  if (id && DATA.species[id]) { setMode('pokemon', true); selectSpecies(id, true); return true; }
  return false;
}

/* ================= Events / init ================= */
function onFilterToggle(prefix, value, f) {
  if (prefix === 'm') f.methods.has(value) ? f.methods.delete(value) : f.methods.add(value);
  else if (prefix === 't') f.time = f.time === value ? null : value;
  else if (prefix === 'c') f.cats.has(value) ? f.cats.delete(value) : f.cats.add(value);
}

function init() {
  // Tabs (re-clicking the active tab returns to that section's home view)
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
    const m = b.dataset.mode;
    if (mode !== m) { setMode(m); return; }
    if (m === 'areas') { showAreaIndex(); setHash('areas'); }
    else if (m === 'hardcore') { activeBoss = null; renderHardcore(); if (hcSub === 'bosses') renderBossGrid(); setHash(hcSub); }
  }));
  document.getElementById('split-btn').addEventListener('click', toggleSplit);
  document.querySelectorAll('#tabs-right button').forEach((b) => b.addEventListener('click', () => setRightMode(b.dataset.rmode)));

  // Pokémon view
  document.getElementById('pk-search').addEventListener('input', (e) => { pkSearch = e.target.value; renderPkList(); });
  document.getElementById('pk-filters').addEventListener('click', (e) => {
    const c = e.target.closest('.fchip'); if (!c) return;
    const [p, v] = c.dataset.f.split(':'); onFilterToggle(p, v, pkFilters); renderPkFilters(); renderPkList();
  });
  document.getElementById('pk-list').addEventListener('click', (e) => { const r = e.target.closest('.row'); if (r) selectSpecies(Number(r.dataset.id)); });
  document.getElementById('pk-detail-content').addEventListener('click', onGoClick);

  // Areas view (delegated)
  const ar = document.getElementById('ar-body');
  ar.addEventListener('click', (e) => {
    if (onGoClick(e)) return;
    const back = e.target.closest('[data-back]'); if (back) { showAreaIndex(); setHash('areas'); return; }
    const card = e.target.closest('[data-go-area]'); if (card) { showArea(Number(card.dataset.goArea)); return; }
    const chip = e.target.closest('.fchip'); if (chip) { const [p, v] = chip.dataset.f.split(':'); onFilterToggle(p, v, areaFilters); renderAreaFilters(); renderAreaGrid(); }
  });
  ar.addEventListener('input', (e) => { if (e.target.id === 'ar-search') { areaSearch = e.target.value; renderAreaGrid(); } });

  // Hardcore view (delegated)
  const hc = document.getElementById('hc-body');
  hc.addEventListener('click', (e) => {
    if (onGoClick(e)) return;
    if (e.target.closest('[data-dex]')) { openDexModal(); return; }
    const sub = e.target.closest('[data-sub]'); if (sub) { setHcSub(sub.dataset.sub); return; }
    const boss = e.target.closest('[data-go-boss]'); if (boss) { showBoss(Number(boss.dataset.goBoss)); return; }
    const chip = e.target.closest('.fchip'); if (chip) { const [, v] = chip.dataset.f.split(':'); bossCat.has(v) ? bossCat.delete(v) : bossCat.add(v); document.getElementById('hc-filters').innerHTML = chipRow(bossCatList(), 'b', bossCat); renderBossGrid(); }
  });
  hc.addEventListener('input', (e) => {
    if (e.target.id === 'hc-search') { bossSearch = e.target.value; renderBossGrid(); }
    else if (e.target.id === 'hl') {
      playerHighest = Math.max(1, Math.min(255, parseInt(e.target.value, 10) || 100));
      try { localStorage.setItem('rr_highest', playerHighest); } catch (_) {}
      if (hcSub === 'bosses') renderBossGrid();
      if (!document.getElementById('modal').hidden && activeBoss != null) showBoss(activeBoss);
    }
  });

  // Modal (boss team + mini Pokédex)
  const modal = document.getElementById('modal');
  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeModal(); return; }
    const mon = e.target.closest('[data-go-mon]'); if (mon) { closeModal(); goMon(Number(mon.dataset.goMon)); return; }
    const row = e.target.closest('[data-dexid]'); if (row) { selectDexMon(Number(row.dataset.dexid)); }
  });
  modal.addEventListener('input', (e) => { if (e.target.id === 'dex-q') { dexQuery = e.target.value; renderDexList(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  window.addEventListener('hashchange', () => { if (!suppressHash) applyHash(); });
}
function onGoClick(e) {
  const m = e.target.closest('[data-go-mon]'); if (m) { goMon(Number(m.dataset.goMon)); return true; }
  const a = e.target.closest('[data-go-area]'); if (a && e.currentTarget.id === 'pk-detail-content') { goArea(Number(a.dataset.goArea)); return true; }
  return false;
}

async function start() {
  try { await loadAll(); } catch (err) { fail(err); return; }
  try { const h = parseInt(localStorage.getItem('rr_highest'), 10); if (h) playerHighest = h; } catch (_) {}
  buildEntries(); buildAreaIndex();
  bossSprite = {};
  for (const cat of (DATA.hardcore.categories || [])) for (const b of cat.bosses) if (b.sprite) bossSprite[b.trainerId] = b.sprite;
  renderPkFilters(); renderPkList();
  init();
  if (!applyHash()) { setMode('pokemon', true); selectSpecies(ENTRIES[0].ID, true); }
  document.getElementById('loading').remove();
  document.getElementById('app').hidden = false;
}
start();
