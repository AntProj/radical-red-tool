# Radical Red data

The monolithic `data.js` (one bare JS object, ~4.6 MB) split into one JSON file
per top-level data type. Regenerate with `node split-data.js` from the repo root.

Each file is formatted **one record per line** — compact values, but every
Pokémon / move / trainer / sprite sits on its own line so diffs stay readable.

## Files

| File | Container | Entries | Description |
|------|-----------|--------:|-------------|
| `species.json` | object, keyed by species ID | 1343 | Pokémon: `stats` `[HP,Atk,Def,Spe,SpA,SpD]`, `type`, `abilities`, `eggGroup`, `items`, `levelupMoves` `[moveID,level]`, `evolutions`, `tmMoves`, `tutorMoves`, `eggMoves`, `dexID`, `ancestor` |
| `moves.json` | object, keyed by move ID | 1003 | Moves: `name`, `power`, `type`, `accuracy`, `pp`, `secondaryEffectChance`, `target`, `priority`, `split`, `description` |
| `items.json` | object, keyed by item ID | 749 | Items: `name`, `description` |
| `abilities.json` | object, keyed by ability ID | 255 | Abilities: `names[]`, `description` |
| `trainers.json` | object, keyed by trainer ID | 464 | Trainer teams (incl. `hardcore` rosters): per-mon `species`, `nature`, `ability`, `level`, `item`, `moves`, `IVs`, `EVs` |
| `areas.json` | array | 221 | Map locations: `name`, encounter/`tutors`/`item-cheat` tables |
| `types.json` | object, keyed by type ID | 18 | Types: `name`, `color`, `matchup[]` (damage multipliers ×10) |
| `tmMoves.json` | object | 128 | TM number → move ID |
| `tutorMoves.json` | object | 128 | Tutor index → move ID |
| `natures.json` | object | 25 | Nature ID → name |
| `eggGroups.json` | object | 16 | Egg-group ID → name |
| `splits.json` | object | 3 | Damage category: 0 Physical, 1 Special, 2 Status |
| `evolutions.json` | object | 25 | Evolution-method ID → display template string |
| `scaledLevels.json` | object | 4 | Scaled-level adjustments |
| `caps.json` | object, keyed by boss name | 18 | Level caps: `cap` `[min,max]` per gym/boss |
| `sprites.json` | object, keyed by species `ID` | 1333 | Pokémon sprites as `data:image/png;base64,...` URIs. Key `0` is the missing-sprite placeholder; ~20 newer forms (IDs 1356–1375) have no sprite of their own and fall back to it. Also holds 3 move-category icons keyed `"Physical"`/`"Special"`/`"Status"`. Resolve with `sprites[mon.ID] ?? sprites[0]` (do **not** fall back to `dexID` — that returns a different species' sprite) |
| `manifest.json` | object | — | Generated index of all files (entry counts + byte sizes) |

IDs referenced inside one file (e.g. a species' `type`, a trainer mon's `item`)
are indices into the matching lookup file.

## Loading

Browser (`fetch`):

```js
const species = await fetch('data/species.json').then(r => r.json());
console.log(species['1'].name); // "Bulbasaur"
```

Load everything in parallel and rebuild the original object:

```js
const { types } = await fetch('data/manifest.json').then(r => r.json());
const data = Object.fromEntries(await Promise.all(
  types.map(async t => [t.type, await fetch(`data/${t.file}`).then(r => r.json())])
));
// data.species, data.moves, ... identical to the original data.js object
```

Node:

```js
const fs = require('fs');
const species = JSON.parse(fs.readFileSync('data/species.json', 'utf8'));
```

> Object keys are strings in JSON, so numeric IDs are accessed as
> `species['1']` (or `species[1]` — JS coerces the index either way).
