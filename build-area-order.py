"""
build-area-order.py
-------------------
Writes data/area-order.json — the wild-area display order taken from the
"Grass & Caves" tab of the Pokémon Locations spreadsheet (game progression
order), matched to areas.json indices. The app uses this to list areas in the
same order the Locations file shows when browsing/filtering wild areas.

    python build-area-order.py
"""
import glob, json, os, re
import openpyxl

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, 'data')

ALIASES = [('pkmn', 'pokemon'), ('mtmoon', 'mtmoon')]
def norm(s):
    s = str(s).lower()
    s = s.replace('pkmn', 'pokemon')
    return re.sub(r'[^a-z0-9]', '', s)

def header_names(ws, row_idx):
    rows = list(ws.iter_rows(values_only=True))
    if row_idx >= len(rows):
        return []
    return [' '.join(str(c).split()) for c in rows[row_idx] if c is not None and str(c).strip()]

def main():
    locs = glob.glob('C:/Users/anten/Downloads/Pok*Locations*Radical Red*.xlsx')[0]
    wb = openpyxl.load_workbook(locs, read_only=True, data_only=True)

    seq = header_names(wb['Grass & Caves'], 2)
    seq = [n for n in seq if 'POST' not in n.upper() or len(norm(n)) > 6]  # drop "P O S T - G A M E" divider
    seq = [n for n in seq if norm(n)]

    with open(os.path.join(DATA, 'areas.json'), encoding='utf-8') as f:
        areas = json.load(f)
    idx_by_norm = {}
    for i, a in enumerate(areas):
        idx_by_norm.setdefault(norm(a.get('name', '')), i)

    # Spreadsheet name (normalized) -> areas.json name (normalized) for the cases
    # whose names don't line up. Cinnabar "MANSION" = Pokemon Mansion (not Celadon).
    ALIAS = {
        'route21a': 'route21north',
        'diglettcave': 'diglettscave1f', 'diglettcaveb1f': 'diglettscaveb1f',
        'pokemontower35f': 'pokemontower3f',
        'seafoamb1f': 'seafoamislandsb1f', 'seafoamb2f': 'seafoamislandsb2f',
        'seafoamb3f': 'seafoamislandsb3f', 'seafoamb4f': 'seafoamislandsb4f',
        'gougingsroom': 'pokemonmansiongougingfiresroom',
        'mtember1f': 'mtemberinterior', 'rocktunnelsecret': 'rocktunnelmagearnaschamber',
        'mansion1f': 'pokemonmansion1f', 'mansion2f': 'pokemonmansion2f',
        'mansion3f': 'pokemonmansion3f', 'mansionb1f': 'pokemonmansionb1f', 'mansion4f': 'pokemonmansion4f',
    }
    SKIP = {'forestexpansion', 'seafoam1f'}  # no equivalent area in areas.json

    order, unmatched, used = [], [], set()
    for name in seq:
        n = norm(name)
        if n in SKIP:
            continue
        hit = idx_by_norm.get(ALIAS.get(n, n))
        if hit is None or hit in used:
            unmatched.append(name)
            continue
        used.add(hit)
        order.append(hit)

    with open(os.path.join(DATA, 'area-order.json'), 'w', encoding='utf-8') as f:
        json.dump({'source': 'Grass & Caves', 'wild': order}, f, indent=1)

    print('Grass & Caves entries:', len(seq))
    print('matched to areas.json:', len(order))
    print('UNMATCHED (%d): %s' % (len(unmatched), ', '.join(unmatched).encode('ascii', 'replace').decode()))
    # show the resolved order names
    print('\nresolved order:')
    print(' -> '.join(areas[i]['name'] for i in order).encode('ascii', 'replace').decode())

if __name__ == '__main__':
    main()
