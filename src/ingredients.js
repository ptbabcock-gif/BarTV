// Ingredient model for a tasting, plus ingredient-based insights.

/** Categories captured per drink, with common suggestions for quick entry. */
export const INGREDIENT_CATEGORIES = [
  { key: 'vodka',     label: 'Vodka / base spirit', suggestions: ['Grey Goose', 'Belvedere', 'Ketel One', 'Absolut', 'Tito\'s', 'Smirnoff', 'House vodka', 'Vanilla vodka', 'Tequila', 'Rum', 'Gin'] },
  { key: 'coffee',    label: 'Coffee',              suggestions: ['Fresh espresso', 'Cold brew', 'Espresso shot (bottled)', 'Nitro cold brew', 'Instant coffee', 'Decaf espresso'] },
  { key: 'liqueur',   label: 'Coffee liqueur',      suggestions: ['Kahlúa', 'Mr Black', 'Tia Maria', 'Borghetti', 'Patrón XO Cafe', 'Galliano Ristretto', 'Baileys', 'None'] },
  { key: 'sweetener', label: 'Sweetener',           suggestions: ['Simple syrup', 'Vanilla syrup', 'Demerara syrup', 'Salted caramel', 'Honey', 'Agave', 'None'] },
  { key: 'garnish',   label: 'Garnish',             suggestions: ['3 coffee beans', 'Cocoa dust', 'Orange zest', 'Chocolate shavings', 'Nutmeg', 'None'] },
];

/** Free-form extras that don't fit a category (e.g. "oat milk", "chilli tincture"). */
export const EXTRAS_SUGGESTIONS = ['Oat milk', 'Baileys float', 'Chocolate bitters', 'Orange bitters', 'Sea salt', 'Cinnamon', 'Amaretto', 'Frangelico'];

/** Returns a clean ingredients object: trimmed strings per category and a de-duplicated extras array. */
export function normalizeIngredients(input = {}) {
  const out = { extras: [] };
  for (const c of INGREDIENT_CATEGORIES) {
    const v = typeof input[c.key] === 'string' ? input[c.key].trim() : '';
    out[c.key] = v;
  }
  const seen = new Set();
  for (const raw of Array.isArray(input.extras) ? input.extras : []) {
    const v = String(raw ?? '').trim();
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.extras.push(v);
  }
  return out;
}

/** Flat, human-readable list: ["Grey Goose", "Fresh espresso", ...]. Empty values and "None" are dropped. */
export function ingredientList(ingredients) {
  const ing = normalizeIngredients(ingredients);
  const items = [];
  for (const c of INGREDIENT_CATEGORIES) {
    if (ing[c.key] && ing[c.key].toLowerCase() !== 'none') items.push(ing[c.key]);
  }
  return items.concat(ing.extras);
}

/**
 * Average overall score grouped by ingredient within one category,
 * e.g. which coffee liqueur tends to produce the best drinks.
 * `scoreOf` maps a tasting to its 0–10 score (injected to avoid a circular import).
 * Only groups with at least `min` tastings are returned, best first.
 */
export function insightsByCategory(tastings, categoryKey, scoreOf, min = 1) {
  const groups = new Map();
  for (const t of tastings) {
    const name = normalizeIngredients(t.ingredients)[categoryKey];
    if (!name || name.toLowerCase() === 'none') continue;
    const s = scoreOf(t);
    if (s == null) continue;
    const k = name.toLowerCase();
    if (!groups.has(k)) groups.set(k, { name, total: 0, count: 0 });
    const g = groups.get(k);
    g.total += s;
    g.count += 1;
  }
  return [...groups.values()]
    .filter((g) => g.count >= min)
    .map((g) => ({ name: g.name, count: g.count, avg: Math.round((g.total / g.count) * 10) / 10 }))
    .sort((a, b) => b.avg - a.avg || b.count - a.count || a.name.localeCompare(b.name));
}

/** Distinct ingredient names previously used in a category, for autocomplete. Most recent first. */
export function previouslyUsed(tastings, categoryKey) {
  const seen = new Set();
  const out = [];
  const sorted = [...tastings].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const t of sorted) {
    const v = normalizeIngredients(t.ingredients)[categoryKey];
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}
