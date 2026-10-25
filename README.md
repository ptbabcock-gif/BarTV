# The Cheers — espresso martini ratings

The Cheers is a mobile-first web app for rating espresso martinis at bars and restaurants.
Log each drink against a five-part rubric, record what went into the glass, pin the
venue on a map, and let the leaderboard, history and stats tell you where to go next.

It is a Progressive Web App with **no build step and no runtime dependencies**:
plain HTML, CSS and ES modules. Open it in a phone browser, "Add to Home Screen", and
it works offline (map tiles and address search need a connection).

## Features

- **Rating function** — five weighted criteria scored 1–5 (Coffee 30%, Balance 25%,
  Foam 20%, Presentation 15%, Chill 10%) roll up into a 0–10 overall score with a grade
  band (Exceptional / Excellent / Good / Fine / Skip). Live score while you tap.
- **Ingredient list** — per drink: base spirit, coffee, coffee liqueur, sweetener,
  garnish and free-form extras, with quick-pick chips and autocomplete from your own
  history. Stats show which ingredients correlate with your best drinks.
- **Map** — every venue with a location appears as a score-coloured pin on an
  OpenStreetMap map. Set a venue's location from the device GPS or by address search
  (Nominatim). "Near me" lists the closest rated venues with distances, and venue pages
  link straight to directions.
- **Find bars nearby** — one tap on the Map tab queries OpenStreetMap for bars, pubs,
  restaurants and cafes around you (or around the map centre), shows unrated ones as hollow
  pins and a distance-sorted list, flags the ones your group has already scored, and "Rate
  here" opens the form with name, address and location filled in. No API key needed.
- **Venues leaderboard** with search and sort (top rated, most visited, recent,
  cheapest, A–Z), venue pages with per-criterion breakdown, most-common build, and
  full tasting history.
- **History** grouped by month, **Stats** (KPIs, best drink, best value, score
  distribution, criterion averages, ingredient insights).
- Venue photo gallery (add several at once, full-screen viewer, remove) plus a photo per tasting, all downscaled on device; notes, price, "would order again".
- **Groups** — rate together on one shared leaderboard: create a group, share a six-letter
  code or invite link, and everyone's venues, ratings and photos sync (offline-first, with
  names on each rating). Backed by a free Supabase project you own; setup in `docs/GROUPS.md`.
- Light / dark theme, currency symbol, JSON export/import (merge or replace), sample data.
- In solo mode all data lives in the browser's local storage on your device, and nothing is
  sent anywhere except tile and address requests to OpenStreetMap. In a group, shared data
  also goes to your own Supabase project.

## Run it

```sh
npm start            # serves http://localhost:8080 (zero dependencies)
```

Any static file server works too (`python3 -m http.server`, GitHub Pages, Netlify…).
Serve over HTTPS or localhost so geolocation and the service worker are allowed.

## Test it

```sh
npm test             # unit tests for scoring, ingredients, store and geo (node:test)
npm run e2e          # Playwright browser tests: solo smoke test + two-phone group test
npm run icons        # regenerate PNG icons from icons/icon.svg (needs Playwright)
```

The browser test stubs map tiles, place search and geolocation, so it runs offline and
deterministically; it walks the whole app: load sample data, search/sort, map pins and
"near me", rate a new venue with address lookup and ingredients, edit, delete, export,
theme switch, and persistence across reload.

## Project layout

```
index.html              app shell (header, view container, tab bar)
styles.css              design tokens, components, map styling, light/dark themes
manifest.webmanifest    PWA manifest
sw.js                   offline app-shell service worker
src/app.js              router and all views
src/scoring.js          rubric, overall score, aggregates, ranking   (pure)
src/ingredients.js      ingredient model and insights               (pure)
src/store.js            persistence, validation, import/export      (pure, Storage-agnostic)
src/geo.js              haversine, Web Mercator tile math, geocoding (pure)
src/places.js           nearby-places discovery via OpenStreetMap Overpass (pure + fetch)
src/map.js              dependency-free slippy map (tiles, pan, pinch, pins)
src/ui.js               DOM/format helpers
src/sample-data.js      demo venues and tastings
src/config.js           Supabase URL + anon key (empty = solo mode)
src/cloud.js            Supabase REST client over fetch (auth, tables, RPC, storage)
src/sync.js             offline-first sync engine for groups
supabase/schema.sql     database schema, security rules and functions
tests/fake-supabase.js  in-memory Supabase stand-in used by the tests
tests/*.test.js         unit tests
tests/e2e.smoke.js      Playwright smoke test
scripts/serve.js        static dev server
scripts/make-icons.js   icon generator
docs/DESIGN.md          design rationale, data model, scoring maths
docs/GROUPS.md          group setup and how sync works
```

Map data and place listings © OpenStreetMap contributors. Please respect the
[Overpass API usage guidance](https://wiki.openstreetmap.org/wiki/Overpass_API),
[OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) and
[Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) if you
deploy this for more than personal use; swap `OSM_TILE_URL` in `src/map.js` for your own
tile provider at scale.
