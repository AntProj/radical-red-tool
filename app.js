/* Radical Red Pokédex — vanilla JS, no build step, GitHub Pages friendly.
 * All data is fetched from ./data/*.json with RELATIVE paths so it works from
 * a project subpath (https://user.github.io/repo/). */
'use strict';

const DATA = {};
const STAT_LABELS = ['HP', 'Atk', 'Def', 'Spe', 'SpA', 'SpD'];
const MAX_STAT = 255;
// Type matchup encoding -> multiplier (indexed by defending type in matchup[]).
const EFF = { 0: 1, 5: 0.5, 20: 2, 1: 0 };

let ENTRIES = [];          // sorted species for the list
let TYPE_IDS = [];         // real (non-contiguous) type IDs, e.g. …17,23 (Fairy)
let evolvesFromMap = {};   // targetID -> [{from, evo}]
let activeId = null;
let activeMoveTab = 'level';

/* ---------------- Loading ---------------- */
const FILES = ['species', 'sprites', 'types', 'abilities', 'moves', 'items',
  'evolutions', 'eggGroups', 'tmMoves', 'tutorMoves', 'splits'];

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
    '<b>Could not load the data.</b><br><br>Serve this folder over <code>http://</code> ' +
    '(GitHub Pages does this automatically). Locally, run<br><br>' +
    '<code>python -m http.server 8000</code><br><br>then open ' +
    '<a href="http://localhost:8000/">http://localhost:8000/</a><br><br><small>' +
    String(err) + '</small>';
}

/* ---------------- Helpers ---------------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const spriteFor = (s) => DATA.sprites[s.ID] || DATA.sprites[0] || '';
const pad = (n) => '#' + String(n).padStart(4, '0');

function formName(s) {
  if (!s.key || s.key === s.name) return '';
  if (s.key.startsWith(s.name + '-')) return s.key.slice(s.name.length + 1).replace(/-/g, ' ');
  return s.key.replace(/-/g, ' ');
}

function typeChip(typeId, small) {
  const t = DATA.types[typeId];
  if (!t) return '';
  return '<span class="type-chip' + (small ? ' sm' : '') + '" style="background:' +
    t.color + '">' + esc(t.name) + '</span>';
}

function abilityList(s) {
  if (!s.abilities) return [];
  const seen = new Set();
  const out = [];
  s.abilities.forEach((pair, i) => {
    const id = pair[0];
    if (!id || seen.has(id)) return;
    const a = DATA.abilities[id];
    if (!a) return;
    seen.add(id);
    out.push({ name: a.names[0], desc: a.description, hidden: i === 2 });
  });
  return out;
}

// Evolution condition: stored template strings include their own backticks and
// reference evo/items/types/moves/species — eval them in that scope.
const evoCache = {};
function evoCondition(evo) {
  const tmpl = DATA.evolutions[evo[0]];
  if (!tmpl) return '';
  const key = evo[0] + ':' + evo.join(',');
  if (key in evoCache) return evoCache[key];
  let txt = '';
  try {
    const fn = new Function('evo', 'items', 'types', 'moves', 'species', 'return ' + tmpl);
    txt = fn(evo, DATA.items, DATA.types, DATA.moves, DATA.species);
  } catch (_) { txt = ''; }
  evoCache[key] = txt;
  return txt;
}

function computeDefenses(s) {
  const groups = { weak: [], resist: [], immune: [] };
  // Type IDs are NOT contiguous (no 9/"???"; Fairy is 23) — iterate real keys.
  for (const atk of TYPE_IDS) {
    const t = DATA.types[atk];
    if (!t) continue;
    let m = 1;
    for (const d of s.type) m *= (EFF[t.matchup[d]] ?? 1);
    if (m > 1) groups.weak.push([atk, m]);
    else if (m === 0) groups.immune.push([atk, m]);
    else if (m < 1) groups.resist.push([atk, m]);
  }
  groups.weak.sort((a, b) => b[1] - a[1]);
  groups.resist.sort((a, b) => a[1] - b[1]);
  return groups;
}

const MULT_LABEL = { 4: '4×', 2: '2×', 0.5: '½', 0.25: '¼', 0: '0' };

/* ---------------- List ---------------- */
function buildEntries() {
  TYPE_IDS = Object.keys(DATA.types).map(Number);
  ENTRIES = Object.values(DATA.species)
    .slice()
    .sort((a, b) => (a.dexID - b.dexID) || (a.ID - b.ID));

  evolvesFromMap = {};
  for (const s of Object.values(DATA.species)) {
    if (!s.evolutions) continue;
    for (const evo of s.evolutions) {
      (evolvesFromMap[evo[2]] = evolvesFromMap[evo[2]] || []).push({ from: s.ID, evo });
    }
  }
}

let imgObserver;
function renderList(filter) {
  const list = document.getElementById('list');
  list.innerHTML = '';
  const q = (filter || '').trim().toLowerCase();
  const frag = document.createDocumentFragment();
  let shown = 0;

  for (const s of ENTRIES) {
    if (q && !matches(s, q)) continue;
    shown++;
    const li = document.createElement('li');
    li.className = 'row' + (s.ID === activeId ? ' active' : '');
    li.dataset.id = s.ID;
    li.setAttribute('role', 'option');
    const form = formName(s);
    li.innerHTML =
      '<img class="row-img" alt="" loading="lazy" data-sprite="' + s.ID + '">' +
      '<div class="row-main">' +
        '<div class="row-name">' + esc(s.name) +
          (form ? ' <span class="row-form">' + esc(form) + '</span>' : '') + '</div>' +
        '<div class="row-sub"><span class="row-num">' + pad(s.dexID) + '</span>' +
          s.type.map((t) => '<span class="dot" style="background:' +
            (DATA.types[t] ? DATA.types[t].color : '#666') + '"></span>').join('') +
        '</div>' +
      '</div>';
    frag.appendChild(li);
  }
  list.appendChild(frag);
  document.getElementById('result-count').textContent =
    shown + (q ? ' of ' + ENTRIES.length : '') + ' Pokémon';

  // Lazily assign sprite data URIs as rows scroll into view.
  if (imgObserver) imgObserver.disconnect();
  imgObserver = new IntersectionObserver((ents) => {
    for (const e of ents) {
      if (!e.isIntersecting) continue;
      const img = e.target;
      img.src = DATA.sprites[img.dataset.sprite] || DATA.sprites[0] || '';
      imgObserver.unobserve(img);
    }
  }, { root: list, rootMargin: '200px' });
  list.querySelectorAll('.row-img').forEach((img) => imgObserver.observe(img));
}

function matches(s, q) {
  if (s.name.toLowerCase().includes(q)) return true;
  if (s.key && s.key.toLowerCase().includes(q)) return true;
  if (pad(s.dexID).includes(q) || String(s.dexID) === q) return true;
  return s.type.some((t) => DATA.types[t] && DATA.types[t].name.toLowerCase() === q);
}

/* ---------------- Detail ---------------- */
function selectSpecies(id, fromHash) {
  if (!DATA.species[id]) return;
  activeId = Number(id);
  activeMoveTab = 'level';
  renderDetail(DATA.species[id]);
  document.querySelectorAll('.row').forEach((r) =>
    r.classList.toggle('active', Number(r.dataset.id) === activeId));
  const active = document.querySelector('.row.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
  document.getElementById('detail').scrollTop = 0;
  if (!fromHash) history.replaceState(null, '', '#' + id);
}

function renderDetail(s) {
  const total = s.stats.reduce((a, b) => a + b, 0);
  const form = formName(s);
  const abilities = abilityList(s);
  const def = computeDefenses(s);
  const heldItems = (s.items || []).filter((i) => i && DATA.items[i])
    .map((i) => esc(DATA.items[i].name));
  const eggGroups = [...new Set((s.eggGroup || []).map((e) => DATA.eggGroups[e]).filter(Boolean)
    .filter((n) => n !== 'None'))];

  let html =
    '<div class="d-head">' +
      '<img class="d-art" src="' + spriteFor(s) + '" alt="' + esc(s.name) + '">' +
      '<div class="d-titles">' +
        '<div class="d-num">' + pad(s.dexID) + '</div>' +
        '<div class="d-name">' + esc(s.name) + '</div>' +
        (form ? '<div class="d-form">' + esc(form) + '</div>' : '') +
        '<div class="d-types">' + s.type.map((t) => typeChip(t)).join('') + '</div>' +
      '</div>' +
    '</div>';

  html += '<div class="grid-2">';

  // Base stats
  html += '<section class="card"><h2>Base Stats</h2>';
  s.stats.forEach((v, i) => {
    html += '<div class="stat"><span class="stat-label">' + STAT_LABELS[i] + '</span>' +
      '<span class="stat-val">' + v + '</span>' +
      '<span class="stat-bar"><i style="width:' + Math.min(100, v / MAX_STAT * 100) +
      '%;background:' + statColor(v) + '"></i></span></div>';
  });
  html += '<div class="stat total"><span class="stat-label">BST</span>' +
    '<span class="stat-val">' + total + '</span><span></span></div>';
  html += '</section>';

  // Type defenses
  html += '<section class="card"><h2>Type Defenses</h2>';
  html += defenseGroup('Weak to', def.weak);
  html += defenseGroup('Resists', def.resist);
  html += defenseGroup('Immune to', def.immune);
  if (!def.weak.length && !def.resist.length && !def.immune.length)
    html += '<div class="ability-desc">No notable matchups.</div>';
  html += '</section>';

  html += '</div>'; // grid-2

  // Abilities + profile
  html += '<section class="card"><h2>Abilities</h2>';
  for (const a of abilities) {
    html += '<div class="kv"><div class="v"><span class="ability-name">' + esc(a.name) + '</span>' +
      (a.hidden ? '<span class="tag">Hidden</span>' : '') +
      '<div class="ability-desc">' + esc(a.desc || '') + '</div></div></div>';
  }
  if (!abilities.length) html += '<div class="ability-desc">—</div>';
  html += '<div class="kv" style="margin-top:10px"><div class="k">Egg Groups</div><div class="v">' +
    (eggGroups.length ? eggGroups.map(esc).join(', ') : '—') + '</div></div>';
  if (heldItems.length)
    html += '<div class="kv"><div class="k">Wild Held Items</div><div class="v">' +
      heldItems.join(', ') + '</div></div>';
  html += '</section>';

  // Evolutions
  const evoHtml = evolutionSection(s);
  if (evoHtml) html += evoHtml;

  // Moves
  html += movesSection(s);

  document.getElementById('detail-content').innerHTML = html;
  wireMoveTabs(s);
}

function statColor(v) {
  if (v < 50) return '#e0533d';
  if (v < 75) return '#e08a3d';
  if (v < 95) return '#e0c23d';
  if (v < 120) return '#82c43d';
  return '#3dc0a8';
}

function defenseGroup(label, arr) {
  if (!arr.length) return '';
  return '<div class="def-group"><div class="lbl">' + label + '</div><div class="def-list">' +
    arr.map(([t, m]) => '<span class="def-chip">' + typeChip(t, true) +
      '<span class="mult">' + (MULT_LABEL[m] || (m + '×')) + '</span></span>').join('') +
    '</div></div>';
}

function evolutionSection(s) {
  const froms = evolvesFromMap[s.ID] || [];
  const intos = s.evolutions || [];
  if (!froms.length && !intos.length) return '';
  let html = '<section class="card"><h2>Evolution</h2><div class="evo-row">';
  for (const f of froms) {
    const pre = DATA.species[f.from];
    if (pre) html += evoCard(pre, '← ' + (evoCondition(f.evo) || 'evolves into this'));
  }
  if (froms.length && intos.length)
    html += '<div style="align-self:center;color:var(--muted-2);padding:0 4px">·</div>';
  for (const evo of intos) {
    const tgt = DATA.species[evo[2]];
    if (tgt) html += evoCard(tgt, '→ ' + (evoCondition(evo) || ''));
  }
  html += '</div></section>';
  return html;
}

function evoCard(s, cond) {
  const form = formName(s);
  return '<div class="evo-card" data-id="' + s.ID + '">' +
    '<img src="' + spriteFor(s) + '" alt="' + esc(s.name) + '">' +
    '<div class="en">' + esc(s.name) + (form ? ' <span class="row-form">' + esc(form) + '</span>' : '') + '</div>' +
    '<div class="ec">' + esc(cond) + '</div></div>';
}

/* ---------------- Moves ---------------- */
function movesFor(s, tab) {
  if (tab === 'level') {
    return (s.levelupMoves || []).slice().sort((a, b) => a[1] - b[1])
      .map(([id, lv]) => ({ id, lv }));
  }
  if (tab === 'tm') return (s.tmMoves || []).map((n) => ({ id: DATA.tmMoves[n], tm: n }))
    .filter((m) => m.id);
  if (tab === 'tutor') return (s.tutorMoves || []).map((n) => ({ id: DATA.tutorMoves[n] }))
    .filter((m) => m.id);
  if (tab === 'egg') return (s.eggMoves || []).map((id) => ({ id })).filter((m) => DATA.moves[m.id]);
  return [];
}

function movesSection(s) {
  const counts = {
    level: (s.levelupMoves || []).length,
    tm: (s.tmMoves || []).length,
    tutor: (s.tutorMoves || []).length,
    egg: (s.eggMoves || []).length,
  };
  const tabs = [['level', 'Level-Up'], ['tm', 'TM'], ['tutor', 'Tutor'], ['egg', 'Egg']];
  let html = '<section class="card"><h2>Moves</h2><div class="tabs">';
  for (const [key, label] of tabs) {
    html += '<span class="tab' + (key === activeMoveTab ? ' active' : '') + '" data-tab="' + key +
      '">' + label + '<span class="c">' + counts[key] + '</span></span>';
  }
  html += '</div><div id="moves-body">' + movesTable(s, activeMoveTab) + '</div></section>';
  return html;
}

function movesTable(s, tab) {
  const rows = movesFor(s, tab);
  if (!rows.length) return '<div class="mv-empty">No ' +
    ({ level: 'level-up', tm: 'TM', tutor: 'tutor', egg: 'egg' }[tab]) + ' moves.</div>';
  const first = tab === 'level' ? '<th class="num">Lv</th>' : (tab === 'tm' ? '<th class="num">TM</th>' : '');
  let html = '<table class="mtable"><thead><tr>' + first +
    '<th>Move</th><th>Type</th><th>Cat</th><th class="num">Pwr</th><th class="num">Acc</th><th class="num">PP</th></tr></thead><tbody>';
  for (const r of rows) {
    const m = DATA.moves[r.id];
    if (!m) continue;
    const cat = DATA.splits[m.split];
    const firstCell = tab === 'level' ? '<td class="num">' + (r.lv || '—') + '</td>'
      : (tab === 'tm' ? '<td class="num">' + r.tm + '</td>' : '');
    html += '<tr>' + firstCell +
      '<td class="mv-name" title="' + esc(m.description || '') + '">' + esc(m.name) + '</td>' +
      '<td>' + typeChip(m.type, true) + '</td>' +
      '<td>' + (DATA.sprites[cat] ? '<img class="cat-icon" src="' + DATA.sprites[cat] +
        '" alt="' + esc(cat) + '" title="' + esc(cat) + '">' : esc(cat || '')) + '</td>' +
      '<td class="num">' + (m.power || '—') + '</td>' +
      '<td class="num">' + (m.accuracy || '—') + '</td>' +
      '<td class="num">' + (m.pp || '—') + '</td></tr>';
  }
  html += '</tbody></table>';
  return html;
}

function wireMoveTabs(s) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activeMoveTab = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.getElementById('moves-body').innerHTML = movesTable(s, activeMoveTab);
    });
  });
}

/* ---------------- Events / init ---------------- */
function onListClick(e) {
  const row = e.target.closest('.row');
  if (row) selectSpecies(Number(row.dataset.id));
}
function onDetailClick(e) {
  const card = e.target.closest('.evo-card');
  if (card) selectSpecies(Number(card.dataset.id));
}

let searchTimer;
function onSearch(e) {
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => renderList(v), 120);
}

async function init() {
  try {
    await loadAll();
  } catch (err) {
    fail(err);
    return;
  }
  buildEntries();
  renderList('');

  document.getElementById('list').addEventListener('click', onListClick);
  document.getElementById('detail-content').addEventListener('click', onDetailClick);
  document.getElementById('search').addEventListener('input', onSearch);
  window.addEventListener('hashchange', () => {
    const id = Number(location.hash.slice(1));
    if (id && id !== activeId) selectSpecies(id, true);
  });

  const initial = Number(location.hash.slice(1)) || ENTRIES[0].ID;
  selectSpecies(initial, true);

  document.getElementById('loading').remove();
  document.getElementById('app').hidden = false;
}

init();
