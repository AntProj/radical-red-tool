/* Radical Red Pokédex — vanilla JS, no build step, GitHub Pages friendly.
 * Three top tabs: Pokémon (two-pane dex), Areas (full-width), Hardcore (full-width).
 * All data fetched from ./data/*.json with RELATIVE paths (Pages subpath safe). */
'use strict';

const DATA = {};
const STAT_LABELS = ['HP', 'Atk', 'Def', 'Spe', 'SpA', 'SpD'];  // raw data order — Speed is index 3
// Conventional display order (Speed LAST): [label, rawIndex into stats/ivs/evs].
const STAT_DISPLAY = [['HP', 0], ['Atk', 1], ['Def', 2], ['SpA', 4], ['SpD', 5], ['Spe', 3]];
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
let activeId = null, pkSearch = '', activeMoveTab = 'level', sidebarOpen = true, filtersOpen = true;
const pkFilters = { methods: new Set(), time: null };
// areas
let activeAreaIdx = null, areaSearch = '';
const areaFilters = { methods: new Set(), time: null, cats: new Set() };
// hardcore
let hcSub = 'order', activeBoss = null, bossSearch = '', bossBackTo = 'bosses';
const bossCat = new Set();
let playerHighest = 100;   // resolves scaled boss levels (codes 101–104) relative to your top mon
let rivalStarter = 'Fire'; // starter the rival CHOSE (Grass/Fire/Water) — swaps rival teams in Trainer Order
let bossSprite = {};       // trainerId -> trainer sprite URL (from the Hardcore sheet's =IMAGE cells)

/* ---------- Persisted UI state (search / filters / tabs survive reloads) ---------- */
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
function loadUiState() {
  pkSearch = lsGet('rr_pk_q', '');
  areaSearch = lsGet('rr_area_q', '');
  bossSearch = lsGet('rr_boss_q', '');
  hcSub = lsGet('rr_hcsub', 'order');
  rivalStarter = lsGet('rr_rival', 'Fire');
  sidebarOpen = lsGet('rr_pk_side', '1') !== '0';
  filtersOpen = lsGet('rr_pk_filt', '1') !== '0';
  try {
    const pf = JSON.parse(lsGet('rr_pk_f', '{}'));
    (pf.methods || []).forEach((m) => pkFilters.methods.add(m)); if (pf.time) pkFilters.time = pf.time;
    const af = JSON.parse(lsGet('rr_area_f', '{}'));
    (af.methods || []).forEach((m) => areaFilters.methods.add(m)); if (af.time) areaFilters.time = af.time;
    (af.cats || []).forEach((c) => areaFilters.cats.add(c));
    JSON.parse(lsGet('rr_boss_cat', '[]')).forEach((c) => bossCat.add(c));
  } catch (_) {}
  const tms = lsGet('rr_tms', null);   // owned TM/HM indices; default = all (DATA is loaded by now)
  try { ownedTMs = new Set(tms ? JSON.parse(tms) : Object.keys(DATA.tmMoves).map(Number)); } catch (_) { ownedTMs = new Set(Object.keys(DATA.tmMoves).map(Number)); }
}
const saveTMs = () => lsSet('rr_tms', JSON.stringify([...ownedTMs]));
const savePkState = () => { lsSet('rr_pk_q', pkSearch); lsSet('rr_pk_f', JSON.stringify({ methods: [...pkFilters.methods], time: pkFilters.time })); };
const saveAreaState = () => { lsSet('rr_area_q', areaSearch); lsSet('rr_area_f', JSON.stringify({ methods: [...areaFilters.methods], time: areaFilters.time, cats: [...areaFilters.cats] })); };
const saveBossState = () => { lsSet('rr_boss_q', bossSearch); lsSet('rr_boss_cat', JSON.stringify([...bossCat])); };

/* ---------------- Loading ---------------- */
const FILES = ['species', 'sprites', 'types', 'abilities', 'moves', 'items', 'evolutions',
  'eggGroups', 'tmMoves', 'tutorMoves', 'splits', 'natures', 'scaledLevels', 'areas', 'trainers', 'hardcore', 'area-order', 'genders', 'growth'];

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
// Item sprites from the PokeAPI sprite repo, keyed by lowercase-hyphenated name.
const itemSlug = (name) => name.toLowerCase().replace(/[’'.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// A "TMxx" item -> the move it teaches (tmMoves is 0-indexed; the TM number is 1-indexed).
function tmMove(name) {
  const mt = /^TM(\d+)$/i.exec(name || '');
  if (!mt) return null;
  const mid = DATA.tmMoves[(+mt[1]) - 1];
  return mid ? DATA.moves[mid] : null;
}
function itemIcon(id, imgCls, phCls) {
  const it = id && DATA.items[id];
  if (!it) return '<span class="' + phCls + '"></span>';
  const tm = tmMove(it.name);
  const url = tm
    ? 'assets/items/tm-' + (DATA.types[tm.type] ? DATA.types[tm.type].name.toLowerCase() : 'normal') + '.png'
    : 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/' + itemSlug(it.name) + '.png';
  return '<img class="' + imgCls + '" src="' + url + '" alt="" referrerpolicy="no-referrer" loading="lazy" ' +
    'onerror="this.outerHTML=\'<span class=&quot;' + phCls + '&quot;></span>\'">';
}
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
  // species.abilities = [hidden, ability1, ability2]; show regulars first, hidden last.
  [1, 2, 0].forEach((i) => {
    const pair = s.abilities[i], id = pair && pair[0];
    if (!id || seen.has(id) || !DATA.abilities[id]) return;
    seen.add(id);
    out.push({ name: DATA.abilities[id].names[0], desc: DATA.abilities[id].description, hidden: i === 0 });
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
  // Stats row: Base Stats (left) | Type Defenses over Abilities (right column).
  let stats = '';
  STAT_DISPLAY.forEach(([lab, i]) => {
    const v = s.stats[i];
    stats += '<div class="stat"><span class="stat-label">' + lab + '</span><span class="stat-val">' + v +
      '</span><span class="stat-bar"><i style="width:' + Math.min(100, v / MAX_STAT * 100) + '%;background:' + statColor(v) + '"></i></span></div>';
  });
  stats += '<div class="stat total"><span class="stat-label">BST</span><span class="stat-val">' + total + '</span><span></span></div>';
  let defenses = defenseGroup('Weak to', def.weak) + defenseGroup('Resists', def.resist) + defenseGroup('Immune to', def.immune);
  if (!def.weak.length && !def.resist.length && !def.immune.length) defenses += '<div class="ability-desc">No notable matchups.</div>';
  let abil = '';
  for (const a of abilities) abil += '<div class="kv"><div class="v"><span class="ability-name">' + esc(a.name) + '</span>' +
    (a.hidden ? '<span class="tag">Hidden</span>' : '') + '<div class="ability-desc">' + esc(a.desc || '') + '</div></div></div>';
  if (!abilities.length) abil += '<div class="ability-desc">—</div>';
  abil += '<div class="kv" style="margin-top:10px"><div class="k">Egg Groups</div><div class="v">' + (eggGroups.length ? eggGroups.map(esc).join(', ') : '—') + '</div></div>';
  if (heldItems.length) abil += '<div class="kv"><div class="k">Wild Held Items</div><div class="v">' + heldItems.join(', ') + '</div></div>';
  html += '<div class="grid-2"><section class="card stats-card"><h2>Base Stats</h2>' + stats + '</section>' +
    '<div class="d-rightcol"><section class="card"><h2>Type Defenses</h2>' + defenses + '</section>' +
    '<section class="card"><h2>Abilities</h2>' + abil + '</section></div></div>';
  const evo = evolutionSection(s);
  if (evo) html += evo;
  html += movesSection(s) + locationsSection(s);   // Moves placed ABOVE Locations
  document.getElementById('pk-detail-content').innerHTML = html;
  wireMoveTabs(s);
}
function defenseGroup(label, arr) {
  if (!arr.length) return '';
  return '<div class="def-group"><div class="lbl">' + label + '</div><div class="def-list">' +
    arr.map(([t, m]) => '<span class="def-chip">' + typeChip(t, true) + '<span class="mult">' + (MULT_LABEL[m] || (m + '×')) + '</span></span>').join('') + '</div></div>';
}
// Build the WHOLE evolution family tree (climb to the root, then BFS every descendant incl. branches
// & megas) and render it for ANY member, with the current mon highlighted. dataAttr = 'data-go-mon'
// (main dex → navigate) or 'data-dexid' (mini-dex modal → select in place).
function evoTree(s, dataAttr) {
  let rootId = s.ID; const climbed = new Set();
  while (evolvesFromMap[rootId] && evolvesFromMap[rootId][0] && !climbed.has(rootId)) { climbed.add(rootId); rootId = evolvesFromMap[rootId][0].from; }
  const stages = []; let frontier = [{ id: rootId, cond: '' }]; const seen = new Set([rootId]);
  while (frontier.length) {
    stages.push(frontier);
    const next = [];
    for (const node of frontier) {
      for (const evo of (DATA.species[node.id] && DATA.species[node.id].evolutions) || []) {
        const tid = evo[2];
        if (tid && DATA.species[tid] && !seen.has(tid)) { seen.add(tid); next.push({ id: tid, cond: evoCondition(evo) || '' }); }
      }
    }
    frontier = next;
    if (stages.length > 8) break;   // safety against bad data cycles
  }
  if (stages.length < 2) return '';  // lone species, nothing to show
  const attr = dataAttr || 'data-go-mon';
  const cols = stages.map((stage) =>
    '<div class="evo-stage">' + stage.map((n) => evoTreeCard(DATA.species[n.id], n.cond, n.id === s.ID, attr)).join('') + '</div>');
  return '<div class="evo-tree">' + cols.join('<div class="evo-arr">→</div>') + '</div>';
}
function evoTreeCard(sp, cond, current, attr) {
  const form = formName(sp);
  return '<div class="evo-card' + (current ? ' cur' : '') + '" ' + attr + '="' + sp.ID + '"><img src="' + spriteFor(sp) + '" alt="' + esc(sp.name) + '">' +
    '<div class="en">' + esc(sp.name) + (form ? ' <span class="row-form">' + esc(form) + '</span>' : '') + '</div>' +
    (cond ? '<div class="ec">' + esc(cond) + '</div>' : '') + '</div>';
}
function evolutionSection(s) {
  const tree = evoTree(s, 'data-go-mon');
  return tree ? '<section class="card"><h2>Evolution</h2>' + tree + '</section>' : '';
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
  let html = '<div class="mtable-scroll"><table class="mtable"><thead><tr>' + first + '<th>Move</th><th>Type</th><th>Cat</th><th class="num">Pwr</th><th class="num">Acc</th><th class="num">PP</th></tr></thead><tbody>';
  for (const r of rows) {
    const m = DATA.moves[r.id]; if (!m) continue;
    const cat = DATA.splits[m.split];
    const fc = tab === 'level' ? '<td class="num">' + (r.lv || '—') + '</td>' : (tab === 'tm' ? '<td class="num">' + r.tm + '</td>' : '');
    html += '<tr>' + fc + '<td class="mv-name" title="' + esc(m.description || '') + '">' + esc(m.name) + '</td><td>' + typeChip(m.type, true) + '</td><td>' +
      (DATA.sprites[cat] ? '<img class="cat-icon" src="' + DATA.sprites[cat] + '" alt="' + esc(cat) + '" title="' + esc(cat) + '">' : esc(cat || '')) +
      '</td><td class="num">' + (m.power || '—') + '</td><td class="num">' + (m.accuracy || '—') + '</td><td class="num">' + (m.pp || '—') + '</td></tr>';
  }
  return html + '</tbody></table></div>';
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
  document.getElementById('ar-body').innerHTML =
    '<div class="page"><div class="page-head"><h1>Areas</h1><p class="page-sub">Wild encounters, fishing, and items for every location. Click an area to expand its encounter tables by category.</p></div>' +
    '<div class="ar-sticky"><input id="ar-search" class="page-search" type="search" placeholder="Search areas…" autocomplete="off" value="' + esc(areaSearch) + '">' +
    '<div id="ar-filters"></div><div id="ar-count" class="count"></div></div><div id="ar-grid" class="to-list"></div></div>';
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
  const html = list.map((a) => {
    const open = a.idx === activeAreaIdx;
    return '<div class="to-entry linkable' + (open ? ' open' : '') + '" data-area="' + a.idx + '">' +
      '<div class="to-row"><span class="to-chev">▸</span><span class="to-name">' + esc(a.name) + '</span>' +
      '<span class="to-loc">' + esc(areaSummary(a)) + '</span></div>' +
      '<div class="area-panel"' + (open ? ' data-filled="1"' : '') + '>' + (open ? areaCategoriesHtml(a) : '') + '</div></div>';
  }).join('');
  document.getElementById('ar-grid').innerHTML = html || '<div class="ability-desc">No areas match the filters.</div>';
  document.getElementById('ar-count').textContent = list.length + ' of ' + AREAVIEW.length + ' areas' + (wildContext ? ' · locations-file order' : '');
}
// Expanded area = a responsive grid of vertical category cards (handoff Areas spec).
const AREA_DOT = { grass: '#62A13D', night: '#9b6dde', surf: '#6390F0', fish: '#65A19E', smash: '#B6A136', items: '#ffce6b', special: '#8571BE', raid: '#e3413a', trainers: '#7db1ff', tutors: '#65A19E' };
function areaCatCard(color, label, lvChip, rows) {
  return '<div class="acat"><div class="acat-head"><span class="acat-dot" style="background:' + color + '"></span>' +
    '<span class="acat-label">' + esc(label) + '</span>' + (lvChip ? '<span class="acat-lv">' + esc(lvChip) + '</span>' : '') +
    '</div><div class="acat-rows">' + rows + '</div></div>';
}
function areaMonRow(id, lvText) {
  const s = DATA.species[id];
  if (!s) return '';
  return '<div class="acat-row" data-go-mon="' + id + '"><img class="acat-sprite" src="' + spriteFor(s) + '" alt="" loading="lazy"><span class="acat-name">' + esc(s.name) + '</span>' +
    (lvText ? '<span class="acat-rlv">' + esc(lvText) + '</span>' : '') + '</div>';
}
// A move row with type chip + power + accuracy (Move Tutors and TMs).
function areaMoveRow(moveId, opts) {
  const mv = DATA.moves[moveId];
  if (!mv) return '';
  opts = opts || {};
  const stats = opts.noStats ? '' :
    '<span class="acat-mstat">Pwr ' + (mv.power || '—') + '</span><span class="acat-mstat">Acc ' + (mv.accuracy || '—') + '</span>';
  return '<div class="acat-mrow">' +
    '<div class="acat-mtop">' + (opts.icon || '') + '<span class="acat-name">' + esc(opts.label || mv.name) + '</span>' +
    (opts.tag ? '<span class="acat-tmtag">' + esc(opts.tag) + '</span>' : '') + '</div>' +
    '<div class="acat-mmeta">' + typeChip(mv.type, true) + stats + '</div></div>';
}
function areaItemRow(id) {
  const it = DATA.items[id];
  if (!it) return '<div class="acat-row no-link"><span class="acat-iicon"></span><span class="acat-name">#' + id + '</span></div>';
  const tm = tmMove(it.name);
  if (tm) return '<div class="acat-row no-link">' + itemIcon(id, 'acat-iimg', 'acat-iicon') +
    '<span class="acat-name">' + esc(tm.name) + '</span><span class="acat-tmtag">' + esc(it.name) + '</span></div>';
  return '<div class="acat-row no-link">' + itemIcon(id, 'acat-iimg', 'acat-iicon') + '<span class="acat-name">' + esc(it.name) + '</span></div>';
}
function areaCategoriesHtml(a) {
  const cards = [];
  for (const key of WILD_ORDER) {
    const list = a.wild[key];
    if (!list || !list.length) continue;
    const m = WILD_METHODS[key];
    const label = m.time ? m.label + ' (' + m.time + ')' : m.label;
    const color = key === 'wild-night' ? AREA_DOT.night : AREA_DOT[m.group];
    const rows = list.slice().sort((x, y) => x.min - y.min).map((e) => areaMonRow(e.id, lv(e.min, e.max))).join('');
    cards.push(areaCatCard(color, label, '', rows));
  }
  for (const key of ITEM_ORDER) {
    const ids = a.items[key];
    if (!ids || !ids.length) continue;
    cards.push(areaCatCard(AREA_DOT.items, ITEM_CATS[key] + ' Items', '', ids.map(areaItemRow).join('')));
  }
  for (const key of FIXED_ORDER) {
    const ids = a.fixed[key];
    if (!ids || !ids.length) continue;
    cards.push(areaCatCard(AREA_DOT.special, FIXED_METHODS[key], '', ids.map((id) => areaMonRow(id)).join('')));
  }
  for (let star = 6; star >= 1; star--) {
    const ids = a.raids[star];
    if (!ids || !ids.length) continue;
    cards.push(areaCatCard(AREA_DOT.raid, star + '★ Raid', '', ids.map((id) => areaMonRow(id)).join('')));
  }
  if (a.trainers.length) {
    const rows = a.trainers.map((id) => '<div class="acat-row no-link"><span class="acat-name">' + (DATA.trainers[id] ? esc(DATA.trainers[id].name) : '#' + id) + '</span></div>').join('');
    cards.push(areaCatCard(AREA_DOT.trainers, 'Trainers', '', rows));
  }
  if (a.tutors.length) {
    const rows = a.tutors.map((n) => DATA.tutorMoves[n]).filter(Boolean).map((mid) => areaMoveRow(mid)).join('');
    if (rows) cards.push(areaCatCard(AREA_DOT.tutors, 'Move Tutors', '', rows));
  }
  return cards.join('') || '<div class="ability-desc" style="grid-column:1/-1">No encounter data for this area.</div>';
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
// Rival ("Rival Blue") fights have 3 starter-dependent teams. Map every rival variant trainerId ->
// { Grass, Fire, Water } (keyed by the rival's OWN starter, detected from its team) so Trainer Order
// can show whichever one matches the player's run. Only the 3-variant fights are included.
let _rivalVar = null;
function rivalVariants() {
  if (_rivalVar) return _rivalVar;
  _rivalVar = {};
  const ST = { 1: 'Grass', 2: 'Grass', 3: 'Grass', 4: 'Fire', 5: 'Fire', 6: 'Fire', 7: 'Water', 8: 'Water', 9: 'Water' };
  const starterOf = (tid) => { const t = DATA.trainers[tid]; if (!t || !t.hardcore) return null; for (const m of t.hardcore) if (ST[m.species]) return ST[m.species]; return null; };
  const cat = (DATA.hardcore.categories || []).find((c) => c.name === 'Rivals');
  if (!cat) return _rivalVar;
  const groups = []; let cur = null;
  for (const b of cat.bosses) { if (!cur || cur.name !== b.name) { cur = { name: b.name, tids: [] }; groups.push(cur); } cur.tids.push(b.trainerId); }
  for (const g of groups) {
    const byType = {};
    for (const tid of g.tids) { const st = starterOf(tid); if (st && !byType[st]) byType[st] = tid; }
    if (Object.keys(byType).length >= 2) for (const tid of g.tids) _rivalVar[tid] = byType;
  }
  return _rivalVar;
}
const rivalTid = (tid) => { const v = rivalVariants()[tid]; return (v && v[rivalStarter]) || tid; };
const STARTER_TYPES = ['Grass', 'Fire', 'Water'];
const starterTypeChip = (name) => { const t = Object.values(DATA.types).find((x) => x.name === name); return t ? typeChip(t.ID, true) : esc(name); };
function trainerOrderHtml() {
  const order = DATA.hardcore.trainerOrder || [];
  let rows = '';
  let lastCap = null;
  for (const e of order) {
    if (e.cap !== lastCap) { rows += '<div class="to-cap">Level Cap ' + esc(e.cap) + '</div>'; lastCap = e.cap; }
    const link = !!e.trainerId;
    const isRival = link && !!rivalVariants()[e.trainerId];
    const tid = link ? rivalTid(e.trainerId) : 0;
    rows += '<div class="to-entry' + (link ? ' linkable' : '') + '"' + (link ? ' data-boss="' + tid + '"' : '') + '>' +
      '<div class="to-row">' +
        '<span class="to-chev">' + (link ? '▸' : '') + '</span>' +
        '<span class="to-name">' + esc(e.name) + '</span>' +
        (isRival ? '<span class="to-rstarter" title="Rival’s starter">' + starterTypeChip(rivalStarter) + '</span>' : '') +
        (e.optional ? '<span class="to-opt">optional</span>' : '') +
        '<span class="to-loc">' + esc(e.location || '') + '</span>' +
        (link ? '<button class="vs-btn sm" data-vs="' + tid + '">⚔ VS</button>' : '') +
      '</div><div class="to-team"></div></div>';
  }
  const picker = '<div class="rival-pick-row"><span class="rival-pick-lbl">Rival’s starter</span>' +
    STARTER_TYPES.map((n) => { const t = Object.values(DATA.types).find((x) => x.name === n); const on = n === rivalStarter;
      return '<button class="rival-pick' + (on ? ' on' : '') + '" data-rival="' + n + '" style="background:' + (on && t ? t.color : 'var(--panel-2)') + '">' + esc(n) + '</button>'; }).join('') +
    '<span class="rival-pick-note">changes the 5 rival fights’ teams</span></div>';
  return '<div class="page-head"><h1>Trainer Order</h1><p class="page-sub">Story-order fights with their level caps. Click a trainer to expand their team, or ⚔ VS to compare against your party.</p>' +
    picker + '</div><div class="to-list">' + rows + '</div>';
}
function bossCatList() { return (DATA.hardcore.categories || []).map((c) => ({ key: c.name, label: c.name })); }
function bossesHtml() {
  return '<div class="page-head"><h1>Hardcore Bosses</h1><p class="page-sub">Major battles grouped by region and arc. Click a boss to expand their team, or ⚔ VS to compare against your party.</p></div>' +
    '<input id="hc-search" class="page-search" type="search" placeholder="Search bosses…" autocomplete="off" value="' + esc(bossSearch) + '">' +
    '<div id="hc-filters" class="fchips">' + chipRow(bossCatList(), 'b', bossCat) + '</div>' +
    '<div id="hc-grid" class="to-list"></div>';
}
function renderBossGrid() {
  const q = bossSearch.trim().toLowerCase();
  let html = '';
  for (const cat of (DATA.hardcore.categories || [])) {
    if (bossCat.size && !bossCat.has(cat.name)) continue;
    const bosses = cat.bosses.filter((b) => !q || b.name.toLowerCase().includes(q) || b.trainerName.toLowerCase().includes(q));
    if (!bosses.length) continue;
    html += '<div class="to-cap">' + esc(cat.name) + '</div>';
    for (const b of bosses) {
      const lo = Math.min(resolveLevel(b.minLevel), resolveLevel(b.maxLevel));
      const hi = Math.max(resolveLevel(b.minLevel), resolveLevel(b.maxLevel));
      html += '<div class="to-entry linkable" data-boss="' + b.trainerId + '">' +
        '<div class="to-row">' +
          '<span class="to-chev">▸</span>' +
          '<span class="to-name">' + esc(b.trainerName) + '</span>' +
          '<span class="to-loc">' + esc(b.name) + '</span>' +
          '<span class="to-lv">Lv ' + (lo === hi ? lo : lo + '–' + hi) + '</span>' +
          '<button class="vs-btn sm" data-vs="' + b.trainerId + '">⚔ VS</button>' +
        '</div><div class="to-team"></div></div>';
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
// Inline collapsible team (shown under a boss card / trainer-order row).
function bossTeamHtml(id, cardFn) {
  const t = DATA.trainers[id];
  const fn = cardFn || bossMonCard;
  return t && t.hardcore ? t.hardcore.map(fn).join('') : '';
}
function toggleInlineTeam(el, id, panelSel, cardFn) {
  const panel = el.querySelector(panelSel);
  if (!panel) return;
  if (el.classList.contains('open')) { el.classList.remove('open'); return; }
  if (!panel.dataset.filled) { panel.innerHTML = bossTeamHtml(id, cardFn); panel.dataset.filled = '1'; }
  el.classList.add('open');
}

/* ---------------- Versus (head-to-head + damage calc) ---------------- */
let vs = { tid: null, rightIdx: 0, leftIdx: 0 };
let vsLeftTeam = [], vsRightTeam = [];  // player team (built via Add), boss team cfgs
let ownedTMs = new Set();               // TM/HM indices the player owns (restricts player move pools)
let vsLeft = null;   // selected player mon cfg
let vsRight = null;  // selected boss mon cfg
let vsField = null;  // {label, weather, terrain, trickRoom}
let vsAddMode = 'box', vsDexQ = '';
const PLAYER_SPRITE = 'assets/player-red.png';
const VS_JITTER = [-7, -3, -11, -5, -9, -4];

/* ----- damage-calc engine (lazy: ~470KB of the embedded @smogon/calc, RR data) ----- */
let RRC = null, _calcLoading = null;
function ensureCalcEngine() {
  if (RRC) return Promise.resolve(RRC);
  if (_calcLoading) return _calcLoading;
  window.__createBinding = window.__createBinding || function (o, m, k) { o[k] = m[k]; };
  if (!window.exports) { window.exports = {}; window.require = function () { return window.exports; }; }
  const base = 'calc/calc/', files = ['util.js', 'stats.js', 'data/species.js', 'data/types.js', 'data/natures.js', 'data/abilities.js', 'data/moves.js', 'data/items.js', 'data/index.js', 'move.js', 'pokemon.js', 'field.js', 'items.js', 'mechanics/util.js', 'mechanics/gen789.js', 'mechanics/gen56.js', 'mechanics/gen4.js', 'mechanics/gen3.js', 'mechanics/gen12.js', 'calc.js', 'desc.js', 'result.js', 'adaptable.js', 'index.js'];
  const load = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('calc ' + src)); document.head.appendChild(s); });
  _calcLoading = (async () => { for (const f of files) await load(base + f); RRC = window.exports; RRC._gen = RRC.Generations.get(9); return RRC; })();
  return _calcLoading;
}

/* ----- mon configs ----- */
function abilityNamesOf(sp) {
  const seen = new Set(), out = [];
  (sp.abilities || []).forEach((a) => { const id = a && a[0]; if (id && DATA.abilities[id]) { const n = DATA.abilities[id].names[0]; if (!seen.has(n)) { seen.add(n); out.push(n); } } });
  return out;
}
// Resolve a slot into species.abilities = [hidden, ability1, ability2] -> ability NAME.
// If the requested slot is empty (e.g. ability2 missing), fall back to ability1, then hidden.
function abilityNameSlot(sp, slot) {
  const abils = (sp && sp.abilities) || [];
  const at = (i) => { const a = abils[i], id = a && a[0]; return (id && DATA.abilities[id]) ? DATA.abilities[id].names[0] : ''; };
  return at(slot) || at(1) || at(0) || '';
}
/* ----- gender ----- */
// data/genders.json marks genderless species ('N'); every other species is treated as
// the common 50/50 split. Gen-3 rule: female if (PID & 0xFF) < threshold (127 for 50/50).
function genderFixed(speciesId) { return (DATA.genders && DATA.genders[speciesId]) || null; } // 'N' | 'M' | 'F' | null
function genderFromPid(speciesId, pid) {
  const fixed = genderFixed(speciesId);
  if (fixed) return fixed;                 // genderless / single-gender species
  if (pid == null) return null;            // unknown (no save data)
  return ((pid & 0xFF) < 127) ? 'F' : 'M';
}
// Default gender for mons with no PID (bosses / dex picks): fixed gender if any, else male.
function genderDefault(speciesId) { return genderFixed(speciesId) || 'M'; }
// ♂/♀ glyph for save mons (empty for genderless/unknown).
function genderSymbolHtml(speciesId, pid) {
  const g = genderFromPid(speciesId, pid);
  return g === 'M' ? ' <span class="gsym m">♂</span>' : g === 'F' ? ' <span class="gsym f">♀</span>' : '';
}
const vsExtras = () => ({ boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, status: '', crit: false, side: {} });
function cfgFromBoss(m) {
  const sp = DATA.species[m.species];
  return Object.assign({ species: m.species, level: resolveLevel(m.level), nature: m.nature || 0, ability: abilityNameSlot(sp, m.ability || 0), gender: genderDefault(m.species),
    item: m.item || 0, moves: (m.moves || []).filter(Boolean).slice(0, 4), ivs: (m.IVs || [31, 31, 31, 31, 31, 31]).slice(), evs: (m.EVs || [0, 0, 0, 0, 0, 0]).slice() }, vsExtras());
}
function cfgFromBox(m) {
  const sp = DATA.species[m.species];
  return Object.assign({ species: m.species, level: m.level || 50, nature: m.nature || 0, ability: abilityNameSlot(sp, m.ability || 0), gender: genderFromPid(m.species, m.pid) || genderDefault(m.species),
    item: m.heldItem || m.item || 0, moves: (m.moves || []).filter(Boolean).slice(0, 4), ivs: (m.IVs || m.ivs || [31, 31, 31, 31, 31, 31]).slice(), evs: (m.EVs || m.evs || [0, 0, 0, 0, 0, 0]).slice(), nickname: m.nickname }, vsExtras());
}
function cfgFromDex(id) {
  const sp = DATA.species[id];
  const lv = (sp.levelupMoves || []).slice().sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  return Object.assign({ species: id, level: (playerHighest && playerHighest <= 100) ? playerHighest : 50, nature: 0, ability: abilityNameSlot(sp, 1), gender: genderDefault(id),
    item: 0, moves: lv.slice(-4), ivs: [31, 31, 31, 31, 31, 31], evs: [0, 0, 0, 0, 0, 0] }, vsExtras());
}

/* ----- calc bridge ----- */
const vsStatsObj = (a) => ({ hp: a[0] || 0, atk: a[1] || 0, def: a[2] || 0, spe: a[3] || 0, spa: a[4] || 0, spd: a[5] || 0 });
function toCalcMon(cfg) {
  const sp = DATA.species[cfg.species];
  const opts = { level: cfg.level, nature: DATA.natures[cfg.nature] || 'Hardy', ivs: vsStatsObj(cfg.ivs), evs: vsStatsObj(cfg.evs) };
  if (cfg.ability) opts.ability = cfg.ability;
  if (cfg.gender) opts.gender = cfg.gender;
  if (cfg.item && DATA.items[cfg.item]) opts.item = DATA.items[cfg.item].name;
  if (cfg.boosts) opts.boosts = cfg.boosts;
  if (cfg.status) opts.status = cfg.status;
  // Use the form-aware calc key (e.g. "Wooper-Paldea", "Linoone-Galar") so regional forms get the
  // correct types/stats/STAB; plain name resolves the base form (wrong types). Fall back if unknown.
  try { return new RRC.Pokemon(RRC._gen, sp.key || sp.name, opts); }
  catch (e) { return new RRC.Pokemon(RRC._gen, sp.name, opts); }
}
const SIDE_FLAGS = ['isSR', 'isReflect', 'isLightScreen', 'isAuroraVeil', 'isSeeded', 'isHelpingHand', 'isTailwind', 'isFriendGuard'];
function sideObj(side) {
  side = side || {}; const o = {};
  SIDE_FLAGS.forEach((k) => { if (side[k]) o[k] = true; });
  if (side.spikes) o.spikes = side.spikes;
  return o;
}
const battleStats = (cfg) => { try { return toCalcMon(cfg).stats; } catch (e) { return null; } };
// Hidden Power's type comes from the mon's IVs (Gen 3-7 mechanic that RR keeps) — the data/calc
// store it as Normal, so derive it here. IV order is HP,Atk,Def,Spe,SpA,SpD.
const HP_TYPES = ['Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark'];
function hiddenPowerType(ivs) {
  const b = (i) => ((ivs && ivs[i] != null ? ivs[i] : 31) & 1);
  const n = b(0) + 2 * b(1) + 4 * b(2) + 8 * b(3) + 16 * b(4) + 32 * b(5);
  return HP_TYPES[Math.floor(n * 15 / 63)];
}
let _typeIdByName = null;
function typeIdByName(name) {
  if (!_typeIdByName) { _typeIdByName = {}; Object.values(DATA.types).forEach((t) => { if (t && t.name) _typeIdByName[t.name] = t.ID; }); }
  return _typeIdByName[name];
}
// Effective type for a move given the attacker's IVs (Hidden Power → IV-based, else the move's own).
function effectiveMoveType(moveId, ivs) {
  const mv = DATA.moves[moveId];
  if (!mv) return null;
  return mv.name === 'Hidden Power' ? hiddenPowerType(ivs) : null;  // null = use mv.type as-is
}
function calcMove(atkCfg, defCfg, moveId) {
  if (!RRC || !atkCfg || !defCfg) return null;
  const mv = DATA.moves[moveId];
  if (!mv || !mv.power) return null;  // status / no base power -> no damage
  try {
    const def = toCalcMon(defCfg);
    const field = new RRC.Field({ weather: (vsField && vsField.weather) || undefined, terrain: (vsField && vsField.terrain) || undefined, attackerSide: sideObj(atkCfg.side), defenderSide: sideObj(defCfg.side) });
    const ovType = effectiveMoveType(moveId, atkCfg.ivs);  // Hidden Power → IV-derived type
    const moveOpts = { isCrit: !!atkCfg.crit };
    if (ovType) moveOpts.overrides = { type: ovType };      // mutating move.type is ignored by calculate()
    const move = new RRC.Move(RRC._gen, mv.name, moveOpts);
    const r = RRC.calculate(RRC._gen, toCalcMon(atkCfg), def, move, field);
    const range = r.range(), maxHP = (def.stats && def.stats.hp) || 1;
    const ko = r.kochance ? r.kochance() : null;
    return { pctLo: +(range[0] / maxHP * 100).toFixed(1), pctHi: +(range[1] / maxHP * 100).toFixed(1), ko: ko && ko.text };
  } catch (e) { return null; }
}
const STATUS_OPTS = [['', 'Healthy'], ['brn', 'Burn'], ['par', 'Paralysis'], ['psn', 'Poison'], ['tox', 'Badly Poisoned'], ['slp', 'Sleep'], ['frz', 'Frozen']];
const COND_OPTS = [['isSR', 'Stealth Rock'], ['spikes', 'Spikes'], ['isReflect', 'Reflect'], ['isLightScreen', 'Light Screen'], ['isAuroraVeil', 'Aurora Veil'], ['isSeeded', 'Leech Seed'], ['isHelpingHand', 'Helping Hand'], ['isTailwind', 'Tailwind'], ['isFriendGuard', 'Friend Guard']];

/* ----- option lists (cached) ----- */
let _itemOpts = null;
function itemOptionsHtml() {
  if (_itemOpts) return _itemOpts;
  const list = Object.values(DATA.items).filter((it) => it && it.name && !/^TM\d|^HM\d|^\?\?\?$/.test(it.name)).sort((a, b) => a.name.localeCompare(b.name));
  _itemOpts = '<option value="0">— None —</option>' + list.map((it) => '<option value="' + it.ID + '">' + esc(it.name) + '</option>').join('');
  return _itemOpts;
}
let _abilOpts = null;  // ALL abilities (hardcore changes some, so let the player pick any)
function abilityOptionsHtml() {
  if (_abilOpts) return _abilOpts;
  const names = [...new Set(Object.values(DATA.abilities).map((a) => a && a.names && a.names[0]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  _abilOpts = names.map((n) => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
  return _abilOpts;
}
const _movePool = {};
function movePoolOf(sp) {
  if (_movePool[sp.ID]) return _movePool[sp.ID];
  const ids = new Set();
  (sp.levelupMoves || []).forEach((x) => ids.add(x[0]));
  (sp.tmMoves || []).forEach((n) => { const m = DATA.tmMoves[n]; if (m) ids.add(m); });
  (sp.tutorMoves || []).forEach((n) => { const m = DATA.tutorMoves[n]; if (m) ids.add(m); });
  (sp.eggMoves || []).forEach((m) => ids.add(m));
  const out = [...ids].filter((id) => DATA.moves[id]).map((id) => [id, DATA.moves[id].name]).sort((a, b) => a[1].localeCompare(b[1]));
  _movePool[sp.ID] = out;
  return out;
}
const tmLabel = (n) => n < 120 ? 'TM' + String(n + 1).padStart(2, '0') : 'HM' + String(n - 119).padStart(2, '0');
// Player move pool = level-up moves learnable at/below this level + owned TMs/HMs it can learn
// (+ its current moves so imported sets stay intact). Bosses keep their full learnset.
let _allMoves = null;
function allMovesPool() {
  if (_allMoves) return _allMoves;
  _allMoves = Object.values(DATA.moves).filter((m) => m && m.name).map((m) => [m.ID, m.name]).sort((a, b) => a[1].localeCompare(b[1]));
  return _allMoves;
}
function movePoolFor(cfg, isBoss) {
  if (isBoss) return allMovesPool();   // bosses get any move (custom hardcore movesets)
  const sp = DATA.species[cfg.species];
  const ids = new Set();
  (sp.levelupMoves || []).forEach((x) => { if (x[1] <= cfg.level) ids.add(x[0]); });
  (sp.tmMoves || []).forEach((n) => { if (ownedTMs.has(n)) { const m = DATA.tmMoves[n]; if (m) ids.add(m); } });
  (cfg.moves || []).forEach((id) => { if (id) ids.add(id); });
  return [...ids].filter((id) => DATA.moves[id]).map((id) => [id, DATA.moves[id].name]).sort((a, b) => a[1].localeCompare(b[1]));
}
const selOpts = (pairs, sel) => pairs.map(([v, l]) => '<option value="' + v + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>').join('');

/* ----- head-to-head render ----- */
const STAT_MAP = [['HP', 'hp', 0], ['Atk', 'atk', 1], ['Def', 'def', 2], ['SpA', 'spa', 4], ['SpD', 'spd', 5], ['Spe', 'spe', 3]];
// 2x2 config block (nature, ability, item, conditions) shown beside the mon header.
function hthCfgGrid(cfg, side) {
  const sp = DATA.species[cfg.species];
  const n = COND_OPTS.filter(([k]) => k === 'spikes' ? cfg.side.spikes : cfg.side[k]).length;
  const checks = COND_OPTS.map(([k, l]) => '<label><input type="checkbox" data-cond="' + k + '" data-side="' + side + '"' + ((k === 'spikes' ? cfg.side.spikes : cfg.side[k]) ? ' checked' : '') + '> ' + esc(l) + '</label>').join('');
  return '<div class="hth-cfg">' +
    '<select class="vs-sel" data-side="' + side + '" data-edit="nature" title="Nature">' + selOpts(Object.entries(DATA.natures), cfg.nature) + '</select>' +
    '<select class="vs-sel vs-abil" data-side="' + side + '" data-edit="ability" data-val="' + esc(cfg.ability) + '" title="Ability">' + abilityOptionsHtml() + '</select>' +
    '<select class="vs-sel vs-item" data-side="' + side + '" data-edit="item" data-val="' + cfg.item + '" title="Item">' + itemOptionsHtml() + '</select>' +
    '<details class="vs-multi" data-side="' + side + '"><summary>Cond' + (n ? ' (' + n + ')' : '') + '</summary><div class="vs-multi-panel">' + checks + '</div></details>' +
    '</div>';
}
// Gender chip in the mon header. Genderless = static ⚲; otherwise a click-to-toggle ♂/♀
// (boss gender isn't in the data, so it's editable; save mons start at the detected value).
function genderControl(cfg, sideKey) {
  const g = cfg.gender;
  if (g === 'N') return ' <span class="vs-gender gl" title="Genderless">⚲</span>';
  if (g !== 'M' && g !== 'F') return '';
  return ' <button class="vs-gender ' + (g === 'F' ? 'f' : 'm') + '" data-side="' + sideKey + '" data-gender title="Gender — click to toggle">' + (g === 'F' ? '♀' : '♂') + '</button>';
}
function hthHead(cfg, isBoss) {
  const side = isBoss ? 'r' : 'l';
  const sp = cfg ? DATA.species[cfg.species] : null;
  if (!sp) return '<div class="hth-head ' + side + '"><div class="hth-noteam">Add a Pokémon ↙</div></div>';
  const name = (!isBoss && cfg.nickname) ? esc(cfg.nickname) : esc(sp.name);
  const meta = '<div class="hth-hmeta"><div class="hth-hname">' + name + '</div>' +
    '<div class="hth-hlv">Lv ' + cfg.level + genderControl(cfg, isBoss ? 'right' : 'left') + '</div>' +
    '<div class="hth-htypes">' + sp.type.map((t) => typeChip(t)).join('') + '</div></div>';
  return '<div class="hth-head ' + side + '"><img class="hth-hsprite" src="' + spriteFor(sp) + '" alt="">' + meta + hthCfgGrid(cfg, isBoss ? 'right' : 'left') + '</div>';
}
// Stage multiplier on a raw stat (battle stat) — Gen-style.
function statWithStage(raw, stage) { if (!stage) return raw; return Math.floor(raw * (stage > 0 ? (2 + stage) / 2 : 2 / (2 - stage))); }
// One diverging stat row: from the center outward = name · [battle / base] · stage · bar(base) · IV.
function hthStatRow(lab, key, idx, L, R, Ls, Rs, Lb, Rb) {
  const lBase = Ls ? Ls.stats[idx] : null, rBase = Rs ? Rs.stats[idx] : null, isHP = key === 'hp', max = 120;
  const lw = lBase != null ? Math.min(100, lBase / max * 100) : 0, rw = rBase != null ? Math.min(100, rBase / max * 100) : 0;
  const lWin = lBase != null && rBase != null && lBase > rBase, rWin = lBase != null && rBase != null && rBase > lBase;
  const iv = (cfg, side) => cfg ? '<input class="vs-iv" type="number" min="0" max="31" value="' + (cfg.ivs[idx] != null ? cfg.ivs[idx] : 31) + '" data-side="' + side + '" data-iv="' + idx + '" title="IV">' : '<span></span>';
  const stage = (cfg, side) => (!cfg || isHP) ? '<span class="vs-stage"></span>' :
    '<span class="vs-stage"><button class="vs-step" data-side="' + side + '" data-stat="' + key + '" data-dir="-1">−</button><b>' + ((cfg.boosts[key] || 0) > 0 ? '+' : '') + (cfg.boosts[key] || 0) + '</b><button class="vs-step" data-side="' + side + '" data-stat="' + key + '" data-dir="1">+</button></span>';
  // value cell: battle stat bold + base stat below. Stages are applied to the
  // DAMAGE (like items), so only SPEED's displayed stat reflects its stage.
  const val = (cfg, b, base) => {
    if (!cfg || !b || b[key] == null) return '<span class="hth-statv"><b>—</b><span class="hth-basev">' + (base != null ? base : '—') + '</span></span>';
    const st = (key === 'spe') ? (cfg.boosts[key] || 0) : 0;
    return '<span class="hth-statv"><b' + (st ? ' class="boosted"' : '') + '>' + statWithStage(b[key], st) + '</b><span class="hth-basev">' + base + '</span></span>';
  };
  return '<div class="hth-srow">' + iv(L, 'left') +
    '<span class="hth-bar l"><i' + (rWin ? ' class="dim"' : '') + ' style="width:' + lw + '%;background:' + statColor(lBase || 0) + '"></i></span>' +
    stage(L, 'left') + val(L, Lb, lBase) + '<span class="hth-lab">' + lab + '</span>' + val(R, Rb, rBase) + stage(R, 'right') +
    '<span class="hth-bar r"><i' + (lWin ? ' class="dim"' : '') + ' style="width:' + rw + '%;background:' + statColor(rBase || 0) + '"></i></span>' + iv(R, 'right') + '</div>';
}
function bstRow(lt, rt) {
  const max = 720, lw = lt != null ? Math.min(100, lt / max * 100) : 0, rw = rt != null ? Math.min(100, rt / max * 100) : 0;
  const lWin = lt != null && rt != null && lt > rt, rWin = lt != null && rt != null && rt > lt;
  return '<div class="hth-srow bst"><span></span>' +
    '<span class="hth-bar l"><i' + (rWin ? ' class="dim"' : '') + ' style="width:' + lw + '%;background:' + (lWin ? 'var(--accent)' : '#5b6472') + '"></i></span>' +
    '<span class="vs-stage"></span><span class="hth-battle">' + (lt != null ? lt : '—') + '</span><span class="hth-lab">BST</span><span class="hth-battle">' + (rt != null ? rt : '—') + '</span><span class="vs-stage"></span>' +
    '<span class="hth-bar r"><i' + (lWin ? ' class="dim"' : '') + ' style="width:' + rw + '%;background:' + (rWin ? 'var(--accent)' : '#5b6472') + '"></i></span><span></span></div>';
}
function hthStats(L, R) {
  const Ls = L ? DATA.species[L.species] : null, Rs = R ? DATA.species[R.species] : null;
  const Lb = L ? battleStats(L) : null, Rb = R ? battleStats(R) : null;
  let h = '<div class="hth-stats"><div class="hth-srow hth-shdr"><span>IV</span><span>Base</span><span>Stage</span><span>Stat</span><span></span><span>Stat</span><span>Stage</span><span>Base</span><span>IV</span></div>';
  STAT_MAP.forEach(([lab, key, idx]) => { h += hthStatRow(lab, key, idx, L, R, Ls, Rs, Lb, Rb); });
  h += bstRow(Ls ? Ls.stats.reduce((a, b) => a + b, 0) : null, Rs ? Rs.stats.reduce((a, b) => a + b, 0) : null);
  return h + '</div>';
}
function hthMoves(cfg, oppCfg, isBoss) {
  const side = isBoss ? 'r' : 'l', sideKey = isBoss ? 'right' : 'left';
  const sp = cfg ? DATA.species[cfg.species] : null;
  if (!sp) return '<div class="hth-mcol ' + side + '"><div class="hth-noteam">—</div></div>';
  const name = (!isBoss && cfg.nickname) ? esc(cfg.nickname) : esc(sp.name), pool = movePoolFor(cfg, isBoss);
  let rows = '';
  for (let i = 0; i < 4; i++) {
    const id = cfg.moves[i] || 0, mv = DATA.moves[id], d = mv ? calcMove(cfg, oppCfg, id) : null;
    const dmg = '<span class="hth-dmg' + (d ? '' : ' none') + '" title="' + (d ? esc(d.ko || '') : '') + '">' + (d ? d.pctLo + '–' + d.pctHi + '%' : (mv ? '—' : '')) + '</span>';
    const ovType = mv ? effectiveMoveType(id, cfg.ivs) : null;   // Hidden Power → IV-based type chip
    const chip = mv ? typeChip(ovType != null ? typeIdByName(ovType) : mv.type, true) : '<span class="hth-notype">·</span>';
    const sel = '<select class="vs-sel vs-mv" data-side="' + sideKey + '" data-slot="' + i + '"><option value="0">—</option>' + selOpts(pool, id) + '</select>';
    rows += '<div class="hth-move ' + side + '">' + (isBoss ? (dmg + chip + sel) : (sel + chip + dmg)) + '</div>';
  }
  const head = '<div class="hth-mhead"><label class="vs-fld">Status<select class="vs-sel" data-side="' + sideKey + '" data-edit="status">' + selOpts(STATUS_OPTS, cfg.status || '') + '</select></label>' +
    '<label class="vs-fld vs-crit"><input type="checkbox" data-side="' + sideKey + '" data-edit="crit"' + (cfg.crit ? ' checked' : '') + '> Crit</label></div>';
  return '<div class="hth-mcol ' + side + '"><div class="hth-mtitle">' + name + '’s Moves</div>' + head + rows + '</div>';
}
const WEATHERS = [['', '— none —'], ['Sand', 'Sandstorm'], ['Rain', 'Rain'], ['Sun', 'Sun'], ['Snow', 'Snow'], ['Hail', 'Hail'], ['Harsh Sunshine', 'Desolate Land'], ['Heavy Rain', 'Primordial Sea'], ['Strong Winds', 'Delta Stream']];
const TERRAINS = [['', '— none —'], ['Electric', 'Electric'], ['Grassy', 'Grassy'], ['Misty', 'Misty'], ['Psychic', 'Psychic']];
function fieldBar() {
  return '<div class="vs-field"><span class="vs-field-lbl">⚑ Field</span>' +
    '<label class="vs-fld">Weather<select class="vs-sel" data-field="weather">' + selOpts(WEATHERS, (vsField && vsField.weather) || '') + '</select></label>' +
    '<label class="vs-fld">Terrain<select class="vs-sel" data-field="terrain">' + selOpts(TERRAINS, (vsField && vsField.terrain) || '') + '</select></label>' +
    (vsField && vsField.label ? '<span class="vs-field-note">' + esc(vsField.label) + '</span>' : '') + '</div>';
}
function allBoxMons() {
  if (!savData) return [];
  return [...(savData.party || []), ...((savData.boxes || []).flatMap((b) => b.mons || []))];
}
// Add-Pokémon picker = a popup overlay over the modal (does NOT replace the compare).
function openAddPop() {
  let pop = document.getElementById('vs-pop');
  if (!pop) {
    pop = document.createElement('div'); pop.id = 'vs-pop'; pop.className = 'vs-pop';
    pop.innerHTML = '<div class="vs-pop-bd" data-addcancel></div><div class="vs-pop-box">' +
      '<div class="vs-pop-head"><b>Add your Pokémon</b><div class="vs-pop-actions"><span id="vs-add-n" class="vs-add-n"></span><button class="vs-pop-done" data-addcancel>Done</button><button class="vs-pick-x" data-addcancel aria-label="Close">✕</button></div></div>' +
      '<div class="vs-pop-tabs"><button class="vs-pick-tab" data-pick="box">PC</button><button class="vs-pick-tab" data-pick="dex">Dex</button><button class="vs-pick-tab" data-pick="tm">TM/HM</button></div>' +
      '<input id="vs-pop-q" class="vs-dexq" type="search" placeholder="Search…" autocomplete="off">' +
      '<div id="vs-pop-list" class="vs-pickgrid"></div></div>';
    (document.querySelector('.vs-modal') || document.getElementById('modal-content')).appendChild(pop);
  }
  pop.classList.add('on');
  const q = document.getElementById('vs-pop-q'); if (q) q.value = '';
  vsDexQ = '';
  renderAddPicker();
  bumpAddCount();
  if (q) q.focus();
}
function bumpAddCount() { const el = document.getElementById('vs-add-n'); if (el) el.textContent = vsLeftTeam.length ? 'Team: ' + vsLeftTeam.length : ''; }
function closeAddPop() { const p = document.getElementById('vs-pop'); if (p) p.classList.remove('on'); }
function renderAddPicker() {
  const pop = document.getElementById('vs-pop'); if (!pop) return;
  pop.querySelectorAll('.vs-pick-tab').forEach((b) => b.classList.toggle('on', b.dataset.pick === vsAddMode));
  const q = (document.getElementById('vs-pop-q') ? document.getElementById('vs-pop-q').value : vsDexQ).trim().toLowerCase();
  const list = document.getElementById('vs-pop-list'); if (!list) return;
  list.className = 'vs-pickgrid' + (vsAddMode === 'tm' ? ' vs-tmlist' : '');
  const sc = list.scrollTop;
  if (vsAddMode === 'tm') {
    const all = Object.keys(DATA.tmMoves).map(Number).map((n) => ({ n, mv: DATA.moves[DATA.tmMoves[n]] })).filter((x) => x.mv && (!q || tmLabel(x.n).toLowerCase().includes(q) || x.mv.name.toLowerCase().includes(q)));
    list.innerHTML = '<div class="vs-tmctl"><button data-tmall="1">All</button><button data-tmall="0">None</button><span>' + ownedTMs.size + ' owned</span></div>' +
      all.map(({ n, mv }) => '<label class="vs-tmrow"><input type="checkbox" data-tm="' + n + '"' + (ownedTMs.has(n) ? ' checked' : '') + '><b>' + tmLabel(n) + '</b><span class="vs-tmname">' + esc(mv.name) + '</span>' + typeChip(mv.type, true) + '</label>').join('');
  } else if (vsAddMode === 'box') {
    const mons = allBoxMons().map((m, i) => ({ m, i, sp: DATA.species[m.species] })).filter((x) => x.sp && (!q || (x.m.nickname || x.sp.name).toLowerCase().includes(q)));
    list.innerHTML = allBoxMons().length
      ? (mons.map(({ m, i, sp }) => '<button class="vs-pickmon" data-boxpick="' + i + '"><img src="' + spriteFor(sp) + '" alt=""><span>' + esc(m.nickname || sp.name) + '</span><small>Lv ' + (m.level || '?') + '</small></button>').join('') || '<div class="hth-noteam">No matches</div>')
      : '<div class="hth-noteam" style="padding:18px">Import a save in the <b>Box</b> tab to pick from your PC.</div>';
  } else {
    const ms = ENTRIES.filter((s) => !q || s.name.toLowerCase().includes(q) || pad(s.dexID).includes(q));
    list.innerHTML = ms.map((s) => '<button class="vs-pickmon" data-dexpick="' + s.ID + '"><img src="' + spriteFor(s) + '" alt="" loading="lazy"><span>' + esc(s.name) + '</span><small>' + pad(s.dexID) + '</small></button>').join('') || '<div class="hth-noteam">No matches</div>';
  }
  list.scrollTop = sc;
}
function renderHthCompare() {
  const el = document.getElementById('hth-compare'); if (!el) return;
  const sc = el.scrollTop;
  el.innerHTML = fieldBar() +
    '<div class="hth-heads">' + hthHead(vsLeft, false) + hthHead(vsRight, true) + '</div>' +
    hthStats(vsLeft, vsRight) +
    '<div class="hth-moves" id="hth-moves">' + hthMoves(vsLeft, vsRight, false) + hthMoves(vsRight, vsLeft, true) + '</div>';
  el.querySelectorAll('.vs-item, .vs-abil').forEach((s) => { s.value = s.dataset.val; });  // big cached selects: set value post-render
  el.scrollTop = sc;
}
function renderMovesOnly() {  // lighter update (e.g. conditions) that keeps header dropdowns open
  const el = document.getElementById('hth-moves'); if (el) el.innerHTML = hthMoves(vsLeft, vsRight, false) + hthMoves(vsRight, vsLeft, true);
}
// Crop a data-URI sprite to its opaque bounding box and report its real drawn
// height (so the lineup can scale each mon to its actual size). Cached by URI.
const _spriteBox = {};
function cropAndSize(img) {
  const raw = img.dataset.rawsrc;
  if (!raw) return;
  const apply = (box) => {
    if (!box) return;
    img.src = box.uri;
    const oh = Math.max(14, Math.min(64, box.oh));
    img.style.height = Math.round(34 + (oh - 14) / (64 - 14) * (66 - 34)) + 'px';
    img.classList.add('sized');
  };
  if (_spriteBox[raw]) { apply(_spriteBox[raw]); return; }
  const im = new Image();
  im.onload = () => {
    const W = im.width, H = im.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0);
    let data;
    try { data = ctx.getImageData(0, 0, W, H).data; } catch (e) { return; }
    let top = H, bot = -1, left = W, right = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 16) { if (y < top) top = y; if (y > bot) bot = y; if (x < left) left = x; if (x > right) right = x; }
    }
    let out;
    if (bot < 0) { out = { uri: raw, oh: H }; }
    else {
      const cw = right - left + 1, ch = bot - top + 1;
      const oc = document.createElement('canvas'); oc.width = cw; oc.height = ch;
      oc.getContext('2d').drawImage(c, left, top, cw, ch, 0, 0, cw, ch);
      out = { uri: oc.toDataURL(), oh: ch };
    }
    _spriteBox[raw] = out; apply(out);
  };
  im.src = raw;
}
function sizeLineups() {
  document.querySelectorAll('.vs-party .vs-mon').forEach(cropAndSize);
}
function vsTrainerImg(side, boss) {
  if (side === 'right') { const url = bossSprite[boss.ID]; return url ? '<img class="hth-trainer r" src="' + esc(url) + '" referrerpolicy="no-referrer" alt="" onerror="this.style.display=\'none\'">' : ''; }
  return '<img class="hth-trainer l" src="' + PLAYER_SPRITE + '" alt="">';
}
function vsBossHuddle(team) {
  return team.map((m, i) => {
    const sp = DATA.species[m.species], uri = sp ? spriteFor(sp) : (DATA.sprites[0] || ''), flip = i % 2 === 0;
    return '<img class="vs-mon' + (flip ? ' flip' : '') + (i === vs.rightIdx ? ' on' : '') + '" style="--j:' + VS_JITTER[i % VS_JITTER.length] +
      'px;z-index:' + (i + 1) + '" data-vsidx="' + i + '" data-rawsrc="' + uri + '" src="' + uri + '" alt="" title="' + (sp ? esc(sp.name) : '') + '">';
  }).join('');
}
function vsPlayerHuddle() {
  return vsLeftTeam.map((c, i) => {
    const sp = DATA.species[c.species], uri = sp ? spriteFor(sp) : '', flip = i % 2 === 1;
    return '<img class="vs-mon' + (flip ? ' flip' : '') + (i === vs.leftIdx ? ' on' : '') + '" style="--j:' + VS_JITTER[i % VS_JITTER.length] +
      'px;z-index:' + (i + 1) + '" data-vsleftidx="' + i + '" data-rawsrc="' + uri + '" src="' + uri + '" alt="" title="' + (sp ? esc(c.nickname || sp.name) : '') + '">';
  }).join('');
}
function vsBand(side, boss) {
  if (side === 'right') {
    const team = boss.hardcore || [];
    return '<div class="hth-band right"><div class="hth-tname">' + esc(boss.name) + '<span>Hardcore Boss · ' + team.length + ' Pokémon</span></div>' +
      '<div class="vs-party right" id="vs-party-right">' + vsBossHuddle(team) + '</div></div>';
  }
  const ot = (savData && savData.party && savData.party[0] && savData.party[0].otName) || 'You';
  const sub = vsLeftTeam.length ? 'Your Team · ' + vsLeftTeam.length + ' · right-click to remove' : 'No Pokémon yet — Add one ↙';
  return '<div class="hth-band left"><div class="hth-tname you">' + esc(ot) + '<span>' + sub + '</span></div>' +
    '<div class="vs-party left" id="vs-party-left">' + vsPlayerHuddle() + '</div></div>';
}
function highlightBossHuddle() { document.querySelectorAll('#vs-party-right .vs-mon').forEach((b, i) => b.classList.toggle('on', i === vs.rightIdx)); }
function highlightPlayerHuddle() { document.querySelectorAll('#vs-party-left .vs-mon').forEach((b, i) => b.classList.toggle('on', i === vs.leftIdx)); }
function bossData(tid) {
  for (const c of (DATA.hardcore.categories || [])) for (const b of c.bosses) if (b.trainerId === tid) return b;
  return null;
}
function showVersus(tid) {
  const boss = DATA.trainers[tid];
  if (!boss) return;
  // Fresh boss side only when opening a different boss (or first time) — otherwise
  // resume where we left off. The player TEAM always persists across opens.
  if (vs.tid !== tid || !vsRightTeam.length) {
    vs.tid = tid; vs.rightIdx = 0;
    vsRightTeam = (boss.hardcore || []).map(cfgFromBoss);
    const bd = bossData(tid);
    vsField = bd && bd.field ? Object.assign({}, bd.field) : null;
  }
  vsRight = vsRightTeam[vs.rightIdx] || null;
  if (vs.leftIdx >= vsLeftTeam.length) vs.leftIdx = Math.max(0, vsLeftTeam.length - 1);
  vsLeft = vsLeftTeam[vs.leftIdx] || null;
  vsAddMode = 'box'; vsDexQ = '';
  const html = '<div class="vs-modal">' +
    vsTrainerImg('left', boss) + vsTrainerImg('right', boss) +
    '<div class="hth-card"><div class="hth-bands">' + vsBand('left', boss) + vsBand('right', boss) +
      '<div class="hth-vs">VS</div></div><div class="hth-compare" id="hth-compare"></div></div>' +
    '<button class="vs-addfab" data-addmon title="Add Pokémon" aria-label="Add Pokémon">＋</button></div>';
  openModal(html, 'vs-modal-box');
  renderHthCompare();
  sizeLineups();
  ensureCalcEngine().then(() => renderHthCompare()).catch(() => {});
}
function rebuildVsBands() {
  const boss = DATA.trainers[vs.tid];
  const bands = document.querySelector('.vs-modal .hth-bands');
  if (boss && bands) { bands.innerHTML = vsBand('left', boss) + vsBand('right', boss) + '<div class="hth-vs">VS</div>'; sizeLineups(); }
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
  let html = '';
  for (const s of ENTRIES) {
    if (!pkMatchesText(s, q)) continue;
    html += '<li class="dex-row' + (s.ID === dexSel ? ' active' : '') + '" data-dexid="' + s.ID + '">' +
      '<img src="' + spriteFor(s) + '" alt=""><span class="dex-rn">' + esc(s.name) + '</span><span class="dex-rnum">' + pad(s.dexID) + '</span></li>';
  }
  const el = document.getElementById('dex-list');
  if (el) el.innerHTML = html || '<li class="dex-empty">No matches</li>';
}
// Compact evolution line for the mini-Pokédex modal; clicking a card selects it in-modal
// (the modal click handler routes [data-dexid] -> selectDexMon).
function dexEvoLine(s) {
  const tree = evoTree(s, 'data-dexid');  // full family tree; cards select in-modal via [data-dexid]
  return tree ? '<h3 class="dex-h">Evolution</h3>' + tree : '';
}
function selectDexMon(id) {
  const s = DATA.species[id];
  if (!s) return;
  dexSel = Number(id);
  const total = s.stats.reduce((a, b) => a + b, 0), form = formName(s);
  let html = '<div class="dex-d-left"><div class="dex-d-top"><div class="dex-d-head"><img src="' + spriteFor(s) + '" alt="' + esc(s.name) + '">' +
    '<div><div class="d-num">' + pad(s.dexID) + '</div><div class="dex-d-name">' + esc(s.name) +
    (form ? ' <span class="row-form">' + esc(form) + '</span>' : '') + '</div>' +
    '<div class="d-types">' + s.type.map((t) => typeChip(t)).join('') + '</div></div></div>';
  html += '<h3 class="dex-h">Base Stats</h3>';
  STAT_DISPLAY.forEach(([lab, i]) => {
    const v = s.stats[i];
    html += '<div class="stat"><span class="stat-label">' + lab + '</span><span class="stat-val">' + v +
      '</span><span class="stat-bar"><i style="width:' + Math.min(100, v / MAX_STAT * 100) + '%;background:' + statColor(v) + '"></i></span></div>';
  });
  html += '<div class="stat total"><span class="stat-label">BST</span><span class="stat-val">' + total + '</span><span></span></div></div>';
  html += dexEvoLine(s) + '</div>';  // close .dex-d-left (stats + evolution)
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
// Detailed vertical team card for the Trainer Order 6-up grid (handoff wireframe
// field order: sprite, name, level, types | nature, ability, item, moves, stats).
function orderMonCard(m) {
  const sp = DATA.species[m.species];
  if (!sp) return '<div class="omon"></div>';
  const slot = sp.abilities && sp.abilities[m.ability] && sp.abilities[m.ability][0];
  const ab = slot && DATA.abilities[slot] ? DATA.abilities[slot].names[0] : '—';
  const item = (m.item && DATA.items[m.item]) ? DATA.items[m.item].name : '—';
  const nature = DATA.natures[m.nature] || '—';
  const moves = (m.moves || []).filter(Boolean).map((id) => {
    const mv = DATA.moves[id];
    return mv ? '<div class="bm-move">' + typeChip(mv.type, true) + '<span class="bm-mname">' + esc(mv.name) + '</span></div>' : '';
  }).join('');
  const stats = STAT_DISPLAY.map(([lab, i]) => { const v = sp.stats[i]; return '<div class="omon-stat"><span class="omon-slab">' + lab +
    '</span><span class="omon-sbar"><i style="width:' + Math.min(100, v / MAX_STAT * 100) + '%;background:' + statColor(v) + '"></i></span><span class="omon-sval">' + v + '</span></div>'; }).join('');
  const bst = sp.stats.reduce((a, b) => a + b, 0);
  return '<div class="omon">' +
    '<img class="omon-sprite" src="' + spriteFor(sp) + '" alt="" data-go-mon="' + m.species + '">' +
    '<div class="omon-name" title="' + esc(sp.name) + '">' + esc(sp.name) + '</div>' +
    '<div class="omon-lv">Lv ' + resolveLevel(m.level) + '</div>' +
    '<div class="omon-types">' + sp.type.map((t) => typeChip(t)).join('') + '</div>' +
    '<div class="omon-div"></div>' +
    '<div class="omon-lab">Nature</div><div class="omon-val">' + esc(nature) + '</div>' +
    '<div class="omon-lab">Ability</div><div class="omon-val">' + esc(ab) + '</div>' +
    '<div class="omon-lab">Item</div><div class="omon-val omon-item">' + itemIcon(m.item, 'omon-iimg', 'omon-idot') + '<span>' + esc(item) + '</span></div>' +
    '<div class="omon-lab">Moves</div><div class="tc-moves">' + moves + '</div>' +
    '<div class="omon-lab">Stats</div><div class="omon-stats">' + stats + '<div class="omon-bst"><span>BST</span><span>' + bst + '</span></div></div>' +
  '</div>';
}

/* ================= Box (save import) ================= */
let savData = null, activeBoxTab = 'party';

function pickSave() {
  let inp = document.getElementById('sav-input-global');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file'; inp.id = 'sav-input-global'; inp.accept = '.sav,.srm,.sa1,.bin,.dsv'; inp.hidden = true;
    document.body.appendChild(inp);
    inp.addEventListener('change', () => { if (inp.files && inp.files[0]) loadSaveFile(inp.files[0]); inp.value = ''; });
  }
  inp.click();
}
function loadSaveFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const res = window.RRSav ? RRSav.parse(reader.result, (id) => !!DATA.species[id], DATA.growth) : { ok: false, error: 'Parser not loaded.' };
    if (res.ok) {
      savData = res;
      const fb = res.boxes.findIndex((b) => b.mons.length);
      activeBoxTab = res.party.length ? 'party' : (fb >= 0 ? String(fb) : 'party');
    } else { savData = { error: res.error, diag: res.diag }; }
    renderBox();
  };
  reader.onerror = () => { savData = { error: 'Could not read the file.' }; renderBox(); };
  reader.readAsArrayBuffer(file);
}
function renderBox() {
  const el = document.getElementById('box-body');
  if (!el) return;
  if (!savData || !savData.party) {
    const err = savData && savData.error
      ? '<div class="box-err">' + esc(savData.error) + (savData.diag ? ' <code>' + esc(JSON.stringify(savData.diag)) + '</code>' : '') + '</div>' : '';
    el.innerHTML = '<div class="page"><div class="page-head"><h1>Box</h1>' +
      '<p class="page-sub">Import your Radical Red <b>.sav</b> to view your party and PC boxes. The file is read entirely in your browser — nothing is uploaded.</p></div>' +
      '<div class="box-drop" id="box-drop"><div class="box-drop-icon">📦</div>' +
      '<button class="dex-btn" data-savpick>Choose .sav file…</button>' +
      '<div class="box-hint">or drag &amp; drop it here</div></div>' + err + '</div>';
    return;
  }
  const tabs = [];
  if (savData.party.length) tabs.push(['party', 'Party · ' + savData.party.length]);
  savData.boxes.forEach((b, i) => { if (b.mons.length) tabs.push([String(i), b.name + ' · ' + b.mons.length]); });
  if (!tabs.some((t) => t[0] === String(activeBoxTab))) activeBoxTab = tabs.length ? tabs[0][0] : 'party';
  const mons = activeBoxTab === 'party' ? savData.party : (savData.boxes[+activeBoxTab] ? savData.boxes[+activeBoxTab].mons : []);
  const total = savData.party.length + savData.boxes.reduce((n, b) => n + b.mons.length, 0);
  let html = '<div class="page"><div class="page-head"><h1>Box</h1>' +
    '<p class="page-sub">' + total + ' Pokémon imported · <button class="link-btn" data-savpick>load another save</button></p></div>' +
    '<div class="subbar"><div class="subtabs">' + tabs.map(([k, l]) =>
      '<button class="subtab' + (String(activeBoxTab) === k ? ' active' : '') + '" data-boxtab="' + k + '">' + esc(l) + '</button>').join('') + '</div></div>' +
    '<div class="box-grid">' + mons.map(boxMonCard).join('') + '</div></div>';
  el.innerHTML = html;
}
// Compact VERTICAL box card (matches the Trainer Order .omon style): name+gender, sprite,
// types, then labelled ability / nature / moves.
function boxMonCard(mon) {
  const sp = DATA.species[mon.species];
  const sprite = sp ? spriteFor(sp) : (DATA.sprites[0] || '');
  const speciesName = sp ? sp.name : ('#' + mon.species);
  const nick = mon.isEgg ? 'Egg' : (mon.nickname || speciesName);
  const gender = mon.isEgg ? '' : genderSymbolHtml(mon.species, mon.pid);
  const sub = (!mon.isEgg && mon.nickname && mon.nickname !== speciesName) ? esc(speciesName) + ' · ' : '';
  const ab = sp ? abilityNameSlot(sp, mon.ability || 0) : '';
  const nature = DATA.natures[mon.nature] || '';
  const types = sp ? sp.type.map((t) => typeChip(t, true)).join('') : '';
  const moves = mon.moves.map((id) => { const mv = DATA.moves[id]; return mv ? '<div class="bm-move">' + typeChip(mv.type, true) + '<span class="bm-mname">' + esc(mv.name) + '</span></div>' : ''; }).join('');
  return '<div class="omon bx-card"' + (sp && !mon.isEgg ? ' data-go-mon="' + mon.species + '"' : '') + '>' +
    (mon.shiny ? '<span class="shiny" title="Shiny">★</span>' : '') +
    '<div class="omon-name">' + esc(nick) + gender + '</div>' +
    '<div class="omon-lv">' + sub + (mon.levelExact ? 'Lv ' : '~Lv ') + mon.level + '</div>' +
    '<img class="omon-sprite" src="' + sprite + '" alt="">' +
    '<div class="omon-types">' + types + '</div>' +
    '<div class="omon-div"></div>' +
    '<div class="omon-lab">Ability</div><div class="omon-val">' + (ab ? esc(ab) : '—') + '</div>' +
    '<div class="omon-lab">Nature</div><div class="omon-val">' + (nature ? esc(nature) : '—') + '</div>' +
    '<div class="omon-lab">Moves</div><div class="tc-moves">' + (moves || '<span class="omon-val">—</span>') + '</div>' +
    '</div>';
}

/* ================= Navigation ================= */
const SECTIONS = ['pokemon', 'areas', 'hardcore', 'calc', 'box'];
function ensureCalc() {
  const f = document.getElementById('calc-frame');
  if (f && !f.src && f.dataset.src) f.src = f.dataset.src;  // lazy-load the ~8 MB calc on first open
}
function renderSection(sec) {
  if (sec === 'areas') showAreaIndex();
  else if (sec === 'hardcore') { renderHardcore(); if (hcSub === 'bosses') renderBossGrid(); }
  else if (sec === 'calc') ensureCalc();
  else if (sec === 'box') renderBox();
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
  if (!fromHash) setHash(m === 'pokemon' ? (activeId ? String(activeId) : '') : m === 'areas' ? 'areas' : m === 'calc' ? 'calc' : m === 'box' ? 'box' : hcSub);
}
function setRightMode(sec) { if (sec === mode) return; rightMode = sec; updateViews(); renderSection(sec); }
function toggleSplit() {
  splitMode = !splitMode;
  if (splitMode && (!rightMode || rightMode === mode)) rightMode = SECTIONS.find((s) => s !== mode);
  updateViews();
  if (splitMode && rightMode) renderSection(rightMode);
}
// Show section m in the primary pane — UNLESS it's already visible in either split pane, so that
// clicking a mon/area/boss while that section is on the RIGHT updates it in place (no pane snap).
function ensureMode(m) { if (mode !== m && !(splitMode && rightMode === m)) setMode(m, true); }
function goMon(id) { ensureMode('pokemon'); selectSpecies(id); }
function goArea(idx) {
  ensureMode('areas');
  // Only drop the (persisted) search/filters if they'd hide the target area.
  const a = AREAVIEW[idx], q = areaSearch.trim().toLowerCase();
  if (a && ((q && !a.name.toLowerCase().includes(q)) || !passesAreaFilter(a))) {
    areaSearch = ''; areaFilters.methods.clear(); areaFilters.time = null; areaFilters.cats.clear(); saveAreaState();
  }
  activeAreaIdx = idx;
  showAreaIndex();                                              // renders the list with this area expanded
  const ae = document.querySelector('#ar-grid .to-entry[data-area="' + idx + '"]');
  if (ae) ae.scrollIntoView({ block: 'start' });
  setHash('a' + idx);
}
function goBoss(id) { ensureMode('hardcore'); hcSub = 'bosses'; renderHardcore(); renderBossGrid(); }
function setHcSub(sub) { hcSub = sub; lsSet('rr_hcsub', sub); activeBoss = null; renderHardcore(); if (sub === 'bosses') renderBossGrid(); setHash(sub); }

/* ================= Hash routing ================= */
let suppressHash = false;
function setHash(h) { suppressHash = true; location.hash = h ? '#' + h : ''; setTimeout(() => { suppressHash = false; }, 0); }
function applyHash() {
  const h = location.hash.slice(1);
  if (h === 'areas') { setMode('areas', true); showAreaIndex(); return true; }
  if (h[0] === 'a' && /^a\d+$/.test(h)) { goArea(Number(h.slice(1))); return true; }
  if (h.startsWith('boss') && DATA.trainers[h.slice(4)]) { goBoss(Number(h.slice(4))); return true; }
  if (h === 'calc') { setMode('calc', true); return true; }
  if (h === 'box') { setMode('box', true); return true; }
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
  document.getElementById('pk-search').addEventListener('input', (e) => { pkSearch = e.target.value; savePkState(); renderPkList(); });
  document.getElementById('pk-filters').addEventListener('click', (e) => {
    const c = e.target.closest('.fchip'); if (!c) return;
    const [p, v] = c.dataset.f.split(':'); onFilterToggle(p, v, pkFilters); savePkState(); renderPkFilters(); renderPkList();
  });
  document.getElementById('pk-list').addEventListener('click', (e) => { const r = e.target.closest('.row'); if (r) selectSpecies(Number(r.dataset.id)); });
  document.getElementById('pk-detail-content').addEventListener('click', onGoClick);
  // Collapsible sidebar panel + independent search/filters toggle
  const sidebar = document.getElementById('pk-sidebar'), sideHead = sidebar.querySelector('.side-head');
  const applyPkPanel = () => {
    sidebar.classList.toggle('collapsed', !sidebarOpen);
    sideHead.classList.toggle('filt-closed', !filtersOpen);
    document.getElementById('pk-filt-state').textContent = filtersOpen ? '▾ hide' : '▸ show';
  };
  document.getElementById('pk-collapse').addEventListener('click', () => { sidebarOpen = false; lsSet('rr_pk_side', '0'); applyPkPanel(); });
  document.getElementById('pk-expand').addEventListener('click', () => { sidebarOpen = true; lsSet('rr_pk_side', '1'); applyPkPanel(); });
  document.getElementById('pk-filt-toggle').addEventListener('click', () => { filtersOpen = !filtersOpen; lsSet('rr_pk_filt', filtersOpen ? '1' : '0'); applyPkPanel(); });
  applyPkPanel();

  // Areas view (delegated)
  const ar = document.getElementById('ar-body');
  ar.addEventListener('click', (e) => {
    if (onGoClick(e)) return;
    if (onGoClick(e)) return;                                   // mon chip inside an expanded area -> dex
    const chip = e.target.closest('.fchip'); if (chip) { const [p, v] = chip.dataset.f.split(':'); onFilterToggle(p, v, areaFilters); saveAreaState(); renderAreaFilters(); renderAreaGrid(); return; }
    const arow = e.target.closest('.to-row');
    if (arow) {
      const ae = arow.closest('.to-entry[data-area]');
      if (ae) {
        const idx = Number(ae.dataset.area);
        const wasOpen = ae.classList.contains('open');
        document.querySelectorAll('#ar-grid .to-entry.open').forEach((o) => o.classList.remove('open')); // single-open accordion
        if (wasOpen) { activeAreaIdx = null; setHash('areas'); }
        else {
          const panel = ae.querySelector('.area-panel');
          if (!panel.dataset.filled) { panel.innerHTML = areaCategoriesHtml(AREAVIEW[idx]); panel.dataset.filled = '1'; }
          ae.classList.add('open'); activeAreaIdx = idx; setHash('a' + idx);
        }
      }
      return;
    }
  });
  ar.addEventListener('input', (e) => { if (e.target.id === 'ar-search') { areaSearch = e.target.value; saveAreaState(); renderAreaGrid(); } });

  // Hardcore view (delegated)
  const hc = document.getElementById('hc-body');
  hc.addEventListener('click', (e) => {
    const vsb = e.target.closest('[data-vs]'); if (vsb) { showVersus(Number(vsb.dataset.vs)); return; }
    if (onGoClick(e)) return;                                   // team-mon click -> dex (inside expanded teams)
    if (e.target.closest('[data-dex]')) { openDexModal(); return; }
    const sub = e.target.closest('[data-sub]'); if (sub) { setHcSub(sub.dataset.sub); return; }
    const rp = e.target.closest('[data-rival]'); if (rp) { rivalStarter = rp.dataset.rival; lsSet('rr_rival', rivalStarter); renderHardcore(); return; }
    const trow = e.target.closest('.to-row');
    if (trow) {
      const te = trow.closest('.to-entry[data-boss]');
      if (te) {
        const wasOpen = te.classList.contains('open');
        document.querySelectorAll('.to-list .to-entry.open').forEach((o) => o.classList.remove('open')); // accordion: single-open
        if (!wasOpen) toggleInlineTeam(te, Number(te.dataset.boss), '.to-team', orderMonCard);
      }
      return;
    }
    const chip = e.target.closest('.fchip'); if (chip) { const [, v] = chip.dataset.f.split(':'); bossCat.has(v) ? bossCat.delete(v) : bossCat.add(v); saveBossState(); document.getElementById('hc-filters').innerHTML = chipRow(bossCatList(), 'b', bossCat); renderBossGrid(); }
  });
  // Box view (delegated): file picker, drag-drop, sub-tabs, mon -> dex
  const bx = document.getElementById('box-body');
  bx.addEventListener('click', (e) => {
    if (e.target.closest('[data-savpick]')) { pickSave(); return; }
    const tab = e.target.closest('[data-boxtab]'); if (tab) { activeBoxTab = tab.dataset.boxtab; renderBox(); return; }
    onGoClick(e);
  });
  bx.addEventListener('dragover', (e) => { e.preventDefault(); const d = document.getElementById('box-drop'); if (d) d.classList.add('drag'); });
  bx.addEventListener('dragleave', () => { const d = document.getElementById('box-drop'); if (d) d.classList.remove('drag'); });
  bx.addEventListener('drop', (e) => {
    e.preventDefault();
    const d = document.getElementById('box-drop'); if (d) d.classList.remove('drag');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) loadSaveFile(e.dataTransfer.files[0]);
  });

  hc.addEventListener('input', (e) => {
    if (e.target.id === 'hc-search') { bossSearch = e.target.value; saveBossState(); renderBossGrid(); }
    else if (e.target.id === 'hl') {
      playerHighest = Math.max(1, Math.min(255, parseInt(e.target.value, 10) || 100));
      try { localStorage.setItem('rr_highest', playerHighest); } catch (_) {}
      if (hcSub === 'bosses') renderBossGrid();
      if (!document.getElementById('modal').hidden && vs.tid != null) {
        vsRightTeam = ((DATA.trainers[vs.tid] || {}).hardcore || []).map(cfgFromBoss); // re-resolve scaled boss levels
        vsRight = vsRightTeam[vs.rightIdx] || null;
        renderHthCompare();
      }
    }
  });

  // Modal (versus + mini Pokédex)
  const modal = document.getElementById('modal');
  modal.addEventListener('contextmenu', (e) => {   // right-click a player team sprite to remove it
    const lc = e.target.closest('#vs-party-left [data-vsleftidx]');
    if (!lc) return;
    e.preventDefault();
    const i = +lc.dataset.vsleftidx;
    vsLeftTeam.splice(i, 1);
    if (vs.leftIdx >= vsLeftTeam.length) vs.leftIdx = Math.max(0, vsLeftTeam.length - 1);
    vsLeft = vsLeftTeam[vs.leftIdx] || null;
    rebuildVsBands(); renderHthCompare();
  });
  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeModal(); return; }
    const step = e.target.closest('.vs-step');
    if (step) { const cfg = step.dataset.side === 'right' ? vsRight : vsLeft; if (cfg) { const k = step.dataset.stat; cfg.boosts[k] = Math.max(-6, Math.min(6, (cfg.boosts[k] || 0) + (+step.dataset.dir))); renderHthCompare(); } return; }
    const gbtn = e.target.closest('[data-gender]');
    if (gbtn) { const cfg = gbtn.dataset.side === 'right' ? vsRight : vsLeft; if (cfg && cfg.gender !== 'N') { cfg.gender = cfg.gender === 'F' ? 'M' : 'F'; renderHthCompare(); } return; }
    const vc = e.target.closest('[data-vsidx]');
    if (vc) { vs.rightIdx = +vc.dataset.vsidx; vsRight = vsRightTeam[vs.rightIdx] || null; highlightBossHuddle(); renderHthCompare(); return; }
    const lc = e.target.closest('[data-vsleftidx]');
    if (lc) { vs.leftIdx = +lc.dataset.vsleftidx; vsLeft = vsLeftTeam[vs.leftIdx] || null; highlightPlayerHuddle(); renderHthCompare(); return; }
    if (e.target.closest('[data-addmon]')) { openAddPop(); return; }
    const ptab = e.target.closest('[data-pick]'); if (ptab) { vsAddMode = ptab.dataset.pick; renderAddPicker(); return; }
    const tmall = e.target.closest('[data-tmall]'); if (tmall) { ownedTMs = tmall.dataset.tmall === '1' ? new Set(Object.keys(DATA.tmMoves).map(Number)) : new Set(); saveTMs(); renderAddPicker(); return; }
    if (e.target.closest('[data-addcancel]')) { closeAddPop(); renderHthCompare(); return; }
    const bp = e.target.closest('[data-boxpick]'); if (bp) { const m = allBoxMons()[+bp.dataset.boxpick]; if (m) { vsLeftTeam.push(cfgFromBox(m)); vs.leftIdx = vsLeftTeam.length - 1; vsLeft = vsLeftTeam[vs.leftIdx]; bp.classList.add('picked'); bumpAddCount(); rebuildVsBands(); } return; }
    const dp = e.target.closest('[data-dexpick]'); if (dp) { vsLeftTeam.push(cfgFromDex(+dp.dataset.dexpick)); vs.leftIdx = vsLeftTeam.length - 1; vsLeft = vsLeftTeam[vs.leftIdx]; dp.classList.add('picked'); bumpAddCount(); rebuildVsBands(); return; }
    const mon = e.target.closest('[data-go-mon]'); if (mon) { closeModal(); goMon(Number(mon.dataset.goMon)); return; }
    const row = e.target.closest('[data-dexid]'); if (row) { selectDexMon(Number(row.dataset.dexid)); }
  });
  modal.addEventListener('change', (e) => {
    const t = e.target; if (!t.dataset) return;
    if (t.dataset.field) { vsField = vsField || {}; vsField[t.dataset.field] = t.value || undefined; renderHthCompare(); return; }
    if (t.dataset.tm != null) { const n = +t.dataset.tm; if (t.checked) ownedTMs.add(n); else ownedTMs.delete(n); saveTMs(); const c = document.querySelector('#vs-pop .vs-tmctl span'); if (c) c.textContent = ownedTMs.size + ' owned'; return; }
    const cfg = t.dataset.side === 'right' ? vsRight : (t.dataset.side === 'left' ? vsLeft : null);
    if (!cfg) return;
    if (t.dataset.iv != null) { cfg.ivs[+t.dataset.iv] = Math.max(0, Math.min(31, parseInt(t.value, 10) || 0)); renderHthCompare(); return; }
    if (t.dataset.edit === 'crit') { cfg.crit = t.checked; renderHthCompare(); return; }
    if (t.dataset.cond) { if (t.dataset.cond === 'spikes') cfg.side.spikes = t.checked ? 3 : 0; else cfg.side[t.dataset.cond] = t.checked; renderMovesOnly(); return; }
    if (t.dataset.edit === 'nature') cfg.nature = +t.value;
    else if (t.dataset.edit === 'ability') cfg.ability = t.value;
    else if (t.dataset.edit === 'item') cfg.item = +t.value;
    else if (t.dataset.edit === 'status') cfg.status = t.value;
    else if (t.classList.contains('vs-mv')) cfg.moves[+t.dataset.slot] = +t.value;
    else return;
    renderHthCompare();
  });
  modal.addEventListener('input', (e) => {
    if (e.target.id === 'dex-q') { dexQuery = e.target.value; renderDexList(); }
    else if (e.target.id === 'vs-pop-q') { vsDexQ = e.target.value; renderAddPicker(); }
  });
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
  loadUiState();
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
