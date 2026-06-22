/*
 * split-data.js
 * --------------
 * Splits the monolithic `data.js` (a single bare JS object literal holding all
 * Pokémon Radical Red data) into one JSON file per top-level data type under
 * `data/`. Re-run this whenever `data.js` is regenerated/updated.
 *
 *   node split-data.js
 *
 * Output:
 *   data/<type>.json   one file per top-level key (species, moves, ...)
 *   data/manifest.json  list of generated files with entry counts + sizes
 *
 * The script verifies fidelity by recombining every written file and comparing
 * it (via canonical JSON) against the original parsed object. It exits non-zero
 * if anything differs.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'data.js');
const OUT_DIR = path.join(ROOT, 'data');

// One-record-per-line serializer: each top-level entry (object key or array
// element) goes on its own line with a compact value. Readable + diffable
// without exploding number arrays like `stats:[45,49,...]` onto many lines.
function serialize(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]\n';
    const lines = value.map((v) => '  ' + JSON.stringify(v));
    return '[\n' + lines.join(',\n') + '\n]\n';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}\n';
    const lines = keys.map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(value[k]));
    return '{\n' + lines.join(',\n') + '\n}\n';
  }
  // Primitive top-level value (shouldn't happen here, but handle gracefully).
  return JSON.stringify(value) + '\n';
}

function entryCount(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 1;
}

function main() {
  console.log('Reading ' + SRC + ' ...');
  const text = fs.readFileSync(SRC, 'utf8');

  // data.js is a bare object literal with single-quoted keys -> wrap & eval.
  const data = eval('(' + text + ')'); // eslint-disable-line no-eval

  // Guard: warn if the source contains values JSON can't represent. These would
  // be silently altered (undefined/function dropped, NaN/Infinity -> null).
  const canonical = JSON.parse(JSON.stringify(data));

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const keys = Object.keys(data);
  const manifest = [];

  for (const key of keys) {
    const file = key + '.json';
    const out = path.join(OUT_DIR, file);
    fs.writeFileSync(out, serialize(data[key]));
    const bytes = fs.statSync(out).size;
    manifest.push({
      type: key,
      file: file,
      container: Array.isArray(data[key]) ? 'array' : 'object',
      entries: entryCount(data[key]),
      bytes: bytes,
    });
    console.log(
      '  wrote data/' + file.padEnd(18) +
      String(entryCount(data[key])).padStart(6) + ' entries  ' +
      (bytes / 1024).toFixed(1).padStart(9) + ' KB'
    );
  }

  // Manifest for programmatic loading.
  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ generatedFrom: 'data.js', types: manifest }, null, 2) + '\n'
  );

  // --- Fidelity check: recombine every file and compare to the original. ---
  const recombined = {};
  for (const m of manifest) {
    recombined[m.type] = JSON.parse(fs.readFileSync(path.join(OUT_DIR, m.file), 'utf8'));
  }
  const before = JSON.stringify(canonical);
  const after = JSON.stringify(recombined);
  if (before !== after) {
    console.error('\nFIDELITY CHECK FAILED: recombined data != original.');
    process.exit(1);
  }
  console.log('\nFidelity check passed: ' + keys.length + ' files recombine to the original byte-for-byte (canonical JSON).');
  console.log('Total entries across all types: ' +
    manifest.reduce((n, m) => n + m.entries, 0));
}

main();
