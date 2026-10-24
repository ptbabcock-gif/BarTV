// Pure rating functions. No DOM, no storage — fully unit-testable.

/** The tasting rubric. Weights sum to 1. Each criterion is scored 1–5. */
export const CRITERIA = [
  { key: 'coffee',       label: 'Coffee',       weight: 0.30, hint: 'Fresh, rich espresso. Not stale, watery or burnt.' },
  { key: 'balance',      label: 'Balance',      weight: 0.25, hint: 'Sweetness, booze and bitterness in harmony.' },
  { key: 'foam',         label: 'Foam',         weight: 0.20, hint: 'Thick, velvety crema that holds the beans.' },
  { key: 'presentation', label: 'Presentation', weight: 0.15, hint: 'Glass, garnish, the three beans on top.' },
  { key: 'temperature',  label: 'Chill',        weight: 0.10, hint: 'Ice cold, no dilution, served promptly.' },
];

export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

/** Labels for each 1–5 level, shared by every criterion. */
export const LEVEL_LABELS = ['Poor', 'Meh', 'Good', 'Great', 'Perfect'];

/**
 * Weighted overall score on a 0–10 scale.
 * A 3/5 on everything gives 5.0; 5/5 everywhere gives 10.0.
 * Missing criteria are ignored and the remaining weights renormalised.
 * Returns null when nothing has been scored.
 */
export function overallScore(scores = {}) {
  let weighted = 0;
  let weightSum = 0;
  for (const c of CRITERIA) {
    const v = Number(scores[c.key]);
    if (!Number.isFinite(v) || v < SCORE_MIN || v > SCORE_MAX) continue;
    weighted += v * c.weight;
    weightSum += c.weight;
  }
  if (weightSum === 0) return null;
  const mean = weighted / weightSum; // 1..5
  return round1(((mean - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * 10);
}

/** True when every criterion has a valid score. */
export function isComplete(scores = {}) {
  return CRITERIA.every((c) => {
    const v = Number(scores[c.key]);
    return Number.isFinite(v) && v >= SCORE_MIN && v <= SCORE_MAX;
  });
}

/** Human grade for a 0–10 score. */
export function grade(score) {
  if (score == null) return { label: 'Unrated', tone: 'muted' };
  if (score >= 9)   return { label: 'Exceptional', tone: 'gold' };
  if (score >= 7.5) return { label: 'Excellent',   tone: 'green' };
  if (score >= 6)   return { label: 'Good',        tone: 'teal' };
  if (score >= 4.5) return { label: 'Fine',        tone: 'amber' };
  return { label: 'Skip', tone: 'red' };
}

/** Aggregate statistics for a list of tastings (each with .scores, .price, .date, .wouldOrderAgain). */
export function aggregate(tastings = []) {
  const scored = tastings
    .map((t) => ({ t, s: overallScore(t.scores) }))
    .filter((x) => x.s != null);
  const count = tastings.length;
  if (count === 0) {
    return { count: 0, avg: null, best: null, worst: null, avgPrice: null, lastVisit: null, orderAgainRate: null, byCriterion: {} };
  }
  const avg = scored.length ? round1(scored.reduce((a, x) => a + x.s, 0) / scored.length) : null;
  const best = scored.length ? scored.reduce((a, x) => (x.s > a.s ? x : a)).t : null;
  const worst = scored.length ? scored.reduce((a, x) => (x.s < a.s ? x : a)).t : null;
  const priced = tastings.map((t) => Number(t.price)).filter((p) => Number.isFinite(p) && p > 0);
  const avgPrice = priced.length ? round2(priced.reduce((a, b) => a + b, 0) / priced.length) : null;
  const dates = tastings.map((t) => t.date).filter(Boolean).sort();
  const lastVisit = dates.length ? dates[dates.length - 1] : null;
  const answered = tastings.filter((t) => typeof t.wouldOrderAgain === 'boolean');
  const orderAgainRate = answered.length
    ? Math.round((answered.filter((t) => t.wouldOrderAgain).length / answered.length) * 100)
    : null;
  const byCriterion = {};
  for (const c of CRITERIA) {
    const vals = tastings.map((t) => Number(t.scores?.[c.key])).filter((v) => v >= SCORE_MIN && v <= SCORE_MAX);
    byCriterion[c.key] = vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }
  return { count, avg, best, worst, avgPrice, lastVisit, orderAgainRate, byCriterion };
}

/**
 * Rank venues by average score (desc), then visit count (desc), then name.
 * Unrated venues sink to the bottom.
 */
export function rankVenues(venues, tastings) {
  const byVenue = new Map();
  for (const t of tastings) {
    if (!byVenue.has(t.venueId)) byVenue.set(t.venueId, []);
    byVenue.get(t.venueId).push(t);
  }
  return venues
    .map((v) => ({ venue: v, stats: aggregate(byVenue.get(v.id) || []) }))
    .sort((a, b) => {
      const sa = a.stats.avg ?? -1;
      const sb = b.stats.avg ?? -1;
      if (sb !== sa) return sb - sa;
      if (b.stats.count !== a.stats.count) return b.stats.count - a.stats.count;
      return a.venue.name.localeCompare(b.venue.name);
    });
}

/** Score-per-currency-unit, for "best value" lists. Null without a price. */
export function valueRatio(tasting) {
  const s = overallScore(tasting.scores);
  const p = Number(tasting.price);
  if (s == null || !Number.isFinite(p) || p <= 0) return null;
  return round2(s / p);
}

/** Histogram of overall scores into 0–1, 1–2, … 9–10 buckets. */
export function scoreHistogram(tastings) {
  const buckets = new Array(10).fill(0);
  for (const t of tastings) {
    const s = overallScore(t.scores);
    if (s == null) continue;
    buckets[Math.min(9, Math.floor(s))]++;
  }
  return buckets;
}

export function round1(n) { return Math.round(n * 10) / 10; }
export function round2(n) { return Math.round(n * 100) / 100; }
