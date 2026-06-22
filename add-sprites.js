/*
 * add-sprites.js
 * --------------
 * Encodes every image in `images/` as a base64 data URI and merges it into
 * `data/sprites.json`, keyed by the file's basename (e.g. images/1357.png ->
 * sprites["1357"]). Use it to fill in sprites that data.js never shipped (the
 * ~20 newer forms that otherwise fall back to the sprites[0] placeholder).
 *
 *   node add-sprites.js
 *
 * Safe to re-run: existing entries are preserved byte-for-byte; a basename that
 * already exists is overwritten (and logged). Updates manifest.json afterward.
 *
 * NOTE: this edits data/sprites.json directly. Do NOT re-run split-data.js
 * afterward — it rebuilds sprites.json from data.js and would drop these.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const IMG_DIR = path.join(ROOT, 'images');
const SPRITES = path.join(ROOT, 'data', 'sprites.json');
const MANIFEST = path.join(ROOT, 'data', 'manifest.json');

const MIME = { '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp' };

// Same one-record-per-line serializer used by split-data.js.
function serialize(obj) {
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}\n';
  const lines = keys.map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(obj[k]));
  return '{\n' + lines.join(',\n') + '\n}\n';
}

function main() {
  const sprites = JSON.parse(fs.readFileSync(SPRITES, 'utf8'));
  const before = JSON.stringify(sprites); // snapshot for the fidelity check

  const files = fs.readdirSync(IMG_DIR)
    .filter((f) => MIME[path.extname(f).toLowerCase()])
    .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b));

  if (files.length === 0) {
    console.error('No images found in ' + IMG_DIR);
    process.exit(1);
  }

  const added = [], updated = [];
  for (const file of files) {
    const key = path.basename(file, path.extname(file));
    const mime = MIME[path.extname(file).toLowerCase()];
    const b64 = fs.readFileSync(path.join(IMG_DIR, file)).toString('base64');
    const uri = 'data:' + mime + ';base64,' + b64;
    (key in sprites ? updated : added).push(key);
    sprites[key] = uri;
  }

  fs.writeFileSync(SPRITES, serialize(sprites));

  // --- Fidelity: every pre-existing key keeps its exact original value. ---
  const prev = JSON.parse(before);
  for (const k of Object.keys(prev)) {
    if (sprites[k] !== prev[k]) {
      console.error('FIDELITY CHECK FAILED: existing sprite "' + k + '" was altered.');
      process.exit(1);
    }
  }

  // Keep manifest counts/bytes accurate.
  if (fs.existsSync(MANIFEST)) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const entry = (manifest.types || []).find((t) => t.type === 'sprites');
    if (entry) {
      entry.entries = Object.keys(sprites).length;
      entry.bytes = fs.statSync(SPRITES).size;
      fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    }
  }

  console.log('Merged ' + files.length + ' image(s) into data/sprites.json');
  console.log('  added  (' + added.length + '): ' + (added.join(', ') || '—'));
  console.log('  updated(' + updated.length + '): ' + (updated.join(', ') || '—'));
  console.log('  sprites.json now has ' + Object.keys(sprites).length + ' entries, ' +
    (fs.statSync(SPRITES).size / 1024 / 1024).toFixed(2) + ' MB');
  console.log('  existing entries verified unchanged.');
}

main();
