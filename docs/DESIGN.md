# The Cheers — design notes

## Who it is for

Someone standing at a bar with a cold glass in one hand and a phone in the other.
Everything about the app follows from that:

- **One-thumb entry.** Big 1–5 segmented buttons instead of stars or sliders; chips for
  ingredients so the common cases are two taps; the live score sticks to the bottom of
  the form so you can see the number move.
- **Works with no signal.** It is a PWA with a cached app shell and local storage. The
  only things that need the network are map tiles and address search, and both fail
  softly (hatched tiles, an inline message).
- **Nothing to install, nothing to build.** Plain ES modules. Fork it, open `index.html`
  on a static host, done. Zero npm dependencies at runtime or for the unit tests.

## Rating function

Five criteria, each 1–5, weighted:

| Criterion     | Weight | What you are judging                               |
|---------------|-------:|----------------------------------------------------|
| Coffee        |   30%  | Fresh, rich espresso. Not stale, watery or burnt.  |
| Balance       |   25%  | Sweetness, booze and bitterness in harmony.        |
| Foam          |   20%  | Thick, velvety crema that holds the beans.         |
| Presentation  |   15%  | Glass, garnish, the three beans on top.            |
| Chill         |   10%  | Ice cold, no dilution, served promptly.            |

`overall = ((weighted_mean − 1) / 4) × 10`, rounded to one decimal. An all-3 drink is a
5.0, an all-5 drink is a 10.0. The 0–10 scale reads better on a badge and ranks more
finely than a 5-star average.

Missing criteria are skipped and the remaining weights renormalised, so a partial rating
(e.g. you forgot Chill) still produces a sensible number and the form only insists on at
least one criterion. Grade bands: 9+ Exceptional, 7.5+ Excellent, 6+ Good, 4.5+ Fine,
below that Skip. Venues are ranked by average overall score, then by number of
tastings, then by name; unrated venues sink.

Weights live in one array in `src/scoring.js`; change them there and the form, badges,
settings explainer and tests all follow.

## Ingredient list

A fixed set of categories (base spirit, coffee, coffee liqueur, sweetener, garnish) plus
free-form extras. Categories rather than a single free-text list because they make the
data comparable: Stats can answer "do drinks made with Mr Black score higher than ones
made with Kahlúa for me?" (`insightsByCategory`). Each category input has a datalist of
sensible defaults merged with everything you have typed before, most recent first, so
your own vocabulary wins over ours. "None" is a valid pick and is excluded from lists
and insights.

## Map

A small hand-written slippy map (`src/map.js`, ~200 lines) rather than Leaflet: no
dependency, no CDN call on an offline-first app, and the maths (`src/geo.js`) is unit
tested. It supports drag, pinch, wheel and double-tap zoom, +/− buttons, score-coloured
pins, a "you are here" dot and fit-to-bounds. Tiles come from OpenStreetMap with the
required attribution.

Venues get coordinates three ways, all from the same location box used by the rating
form and the venue editor:

1. **Use my location** — the Geolocation API; the natural path when you are at the bar.
2. **Find address** — Nominatim search; results fill address, city and coordinates (and
   the venue name if blank).
3. **Importing** a backup that already has them.

"Near me" ranks located venues by haversine distance; the venue page offers a
directions link that opens the device's maps app.

## Finding places nearby

"Find bars nearby" on the Map tab asks OpenStreetMap's Overpass API for named `amenity`
nodes and ways (bar, pub, restaurant, cafe, nightclub, biergarten) within a chosen radius of
the phone's position, or of the map centre when location is unavailable. Results are
de-duplicated (a venue is often both a point and a building outline), sorted by distance and
matched against rated venues (same normalised name within 200 m, or anything within 25 m) so
scored places show their badge and the rest get a "Rate" button that prefills the form.
Responses are cached for ten minutes per rounded location and radius, and queries only run
on tap, to stay well inside the community servers' fair-use guidance. Swap `OVERPASS_URL` in
`src/places.js` for another Overpass mirror or self-hosted instance if needed.

## Data model

```
venue    { id, name, city, address, lat, lng, notes, photos[] (data URLs, max 30), createdAt }
tasting  { id, venueId, date (YYYY-MM-DD), price, scores {coffee, balance, foam,
           presentation, temperature}, ingredients {vodka, coffee, liqueur, sweetener,
           garnish, extras[]}, notes, wouldOrderAgain, photo (data URL), createdAt }
settings { theme: auto|light|dark, currency }
```

Venues are de-duplicated by case-insensitive name + city when you save a rating, so
typing "Dante" twice yields one venue with two tastings. Deleting a venue cascades to its
tastings. Every write goes through `sanitizeVenue` / `sanitizeTasting`, which is also
what import uses, so a hand-edited or foreign JSON file cannot corrupt state.

Storage is `localStorage` (about 5 MB). Photos are downscaled to 720 px JPEG on device
(~60–100 KB each), which comfortably covers a few hundred drinks; a quota error on save
is caught and explained. If that ever becomes limiting, `createStore` takes any
Storage-like object, so swapping in an IndexedDB adapter is local to one file.

## Visual language

Espresso browns, cream and a gold accent; dark by default (bars are dark), light when
the device asks for it or the user picks it. Score badges are colour-coded by grade band
everywhere they appear (lists, venue page, map pins) so the same signal reads at a
glance. 44 px minimum touch targets, safe-area insets for notched phones, a 720 px
column cap so it still looks intentional on a laptop.

## Not built (yet)

- Accounts / sync between devices (export/import covers the basic case).
- Sharing a venue or a rating as an image.
- Tags such as "decaf available" or "batched vs shaken to order".
- Reverse geocoding a GPS fix into an address (currently stores coordinates only).
