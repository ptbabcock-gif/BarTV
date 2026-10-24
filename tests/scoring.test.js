import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRITERIA, overallScore, isComplete, grade, aggregate, rankVenues, valueRatio, scoreHistogram } from '../src/scoring.js';

const all = (n) => Object.fromEntries(CRITERIA.map((c) => [c.key, n]));

test('criteria weights sum to 1', () => {
  const sum = CRITERIA.reduce((a, c) => a + c.weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('overallScore maps 1..5 onto 0..10', () => {
  assert.equal(overallScore(all(1)), 0);
  assert.equal(overallScore(all(3)), 5);
  assert.equal(overallScore(all(5)), 10);
});

test('overallScore is weighted', () => {
  const s = overallScore({ ...all(3), coffee: 5 }); // +2 on a 0.30-weight criterion
  assert.equal(s, 6.5); // mean = 3 + 0.6 = 3.6 -> (2.6/4)*10 = 6.5
});

test('overallScore renormalises when criteria are missing and returns null when empty', () => {
  assert.equal(overallScore({ coffee: 5 }), 10);
  assert.equal(overallScore({ coffee: 5, foam: 1 }), overallScore({ coffee: 5, foam: 1, bogus: 3 }));
  assert.equal(overallScore({}), null);
  assert.equal(overallScore({ coffee: 9 }), null);
});

test('isComplete', () => {
  assert.equal(isComplete(all(4)), true);
  assert.equal(isComplete({ ...all(4), chill: undefined, temperature: undefined }), false);
});

test('grade bands', () => {
  assert.equal(grade(null).label, 'Unrated');
  assert.equal(grade(9.2).label, 'Exceptional');
  assert.equal(grade(7.5).label, 'Excellent');
  assert.equal(grade(6.4).label, 'Good');
  assert.equal(grade(5).label, 'Fine');
  assert.equal(grade(2).label, 'Skip');
});

test('aggregate computes count, average, best, price, order-again and per-criterion means', () => {
  const t1 = { scores: all(5), price: 14, date: '2026-01-02', wouldOrderAgain: true };
  const t2 = { scores: all(3), price: 10, date: '2026-03-01', wouldOrderAgain: false };
  const t3 = { scores: {}, price: null, date: '2026-02-01', wouldOrderAgain: null };
  const a = aggregate([t1, t2, t3]);
  assert.equal(a.count, 3);
  assert.equal(a.avg, 7.5);
  assert.equal(a.best, t1);
  assert.equal(a.worst, t2);
  assert.equal(a.avgPrice, 12);
  assert.equal(a.lastVisit, '2026-03-01');
  assert.equal(a.orderAgainRate, 50);
  assert.equal(a.byCriterion.coffee, 4);
  assert.deepEqual(aggregate([]).count, 0);
});

test('rankVenues orders by avg, then visits, then name; unrated last', () => {
  const venues = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }, { id: 'c', name: 'Charlie' }, { id: 'd', name: 'Delta' }];
  const tastings = [
    { venueId: 'a', scores: all(4) },
    { venueId: 'b', scores: all(4) }, { venueId: 'b', scores: all(4) },
    { venueId: 'c', scores: all(5) },
  ];
  const ranked = rankVenues(venues, tastings).map((r) => r.venue.id);
  assert.deepEqual(ranked, ['c', 'b', 'a', 'd']);
});

test('valueRatio and histogram', () => {
  assert.equal(valueRatio({ scores: all(5), price: 20 }), 0.5);
  assert.equal(valueRatio({ scores: all(5), price: 0 }), null);
  const h = scoreHistogram([{ scores: all(5) }, { scores: all(3) }, { scores: all(1) }, { scores: {} }]);
  assert.equal(h[9], 1); assert.equal(h[5], 1); assert.equal(h[0], 1);
  assert.equal(h.reduce((a, b) => a + b), 3);
});
