# Radical Red Pokédex

A fast, static Pokédex for the **Pokémon Radical Red** romhack. Horizontal layout:
a scrollable list of every Pokémon on the left, full details on the right.

**Live site:** https://antproj.github.io/radical-red-tool/

No build step, no dependencies — plain HTML/CSS/JS reading the JSON data in
[`data/`](data/). Works locally over any static server and on GitHub Pages.

## Features

- **1,343 Pokémon** including forms and Mega Evolutions, sprites bundled inline.
- Search by name, dex number, or type.
- Per-Pokémon detail: base stats (with BST), computed **type weaknesses /
  resistances / immunities**, abilities (incl. hidden) with descriptions, egg
  groups, wild held items, the full **evolution line** (with conditions, megas
  included), and **moves** — level-up, TM, tutor, and egg — each with type,
  category, power, accuracy, and PP.
- Deep links: every Pokémon has its own URL hash (e.g. `#6` for Charizard).

## Run locally

The page fetches JSON, so it must be served over `http://` (not opened as a
`file://` path):

```bash
python -m http.server 8000
# then open http://localhost:8000/
```

## Data

All game data lives in [`data/`](data/) as one JSON file per type — see
[`data/README.md`](data/README.md) for the schema of each file. It was split out
of the original monolithic `data.js` by [`split-data.js`](split-data.js).

Sprites are keyed by species `ID` in `data/sprites.json` (resolve with
`sprites[id] ?? sprites[0]`, the placeholder). Extra/replacement sprites can be
dropped into `images/<id>.png` and merged in with
[`add-sprites.js`](add-sprites.js).

## Deployment (GitHub Pages)

This repo is Pages-ready: `index.html` is at the root, all asset/data paths are
relative, and a `.nojekyll` file is included. To publish:

1. Push to GitHub.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a
   branch**, branch **`main`**, folder **`/ (root)`**, then **Save**.
3. The site goes live at the URL above within a minute or two.

## Credits

Fan project. Pokémon Radical Red is a romhack by Yuuiii; Pokémon data and
sprites belong to their respective owners. This tool is unaffiliated and
non-commercial.
