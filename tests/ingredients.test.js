import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIngredients, ingredientList, insightsByCategory, previouslyUsed } from '../src/ingredients.js';

test('normalizeIngredients trims, fills categories and de-dupes extras', () => {
  const n = normalizeIngredients({ vodka: '  Grey Goose ', extras: ['Oat milk', 'oat milk', '', null, 'Salt'] });
  assert.equal(n.vodka, 'Grey Goose');
  assert.equal(n.coffee, '');
  assert.deepEqual(n.extras, ['Oat milk', 'Salt']);
  assert.deepEqual(normalizeIngredients(undefined).extras, []);
});

test('ingredientList flattens and drops empties and "None"', () => {
  const list = ingredientList({ vodka: 'Tito\'s', coffee: 'Cold brew', liqueur: 'None', garnish: '3 coffee beans', extras: ['Sea salt'] });
  assert.deepEqual(list, ['Tito\'s', 'Cold brew', '3 coffee beans', 'Sea salt']);
});

test('insightsByCategory averages scores per ingredient, best first', () => {
  const tastings = [
    { ingredients: { liqueur: 'Mr Black' }, s: 9 },
    { ingredients: { liqueur: 'mr black' }, s: 7 },
    { ingredients: { liqueur: 'Kahlúa' }, s: 6 },
    { ingredients: { liqueur: 'None' }, s: 10 },
    { ingredients: {}, s: 10 },
  ];
  const r = insightsByCategory(tastings, 'liqueur', (t) => t.s);
  assert.deepEqual(r, [{ name: 'Mr Black', count: 2, avg: 8 }, { name: 'Kahlúa', count: 1, avg: 6 }]);
  assert.equal(insightsByCategory(tastings, 'liqueur', (t) => t.s, 2).length, 1);
});

test('previouslyUsed returns distinct names, most recent first', () => {
  const tastings = [
    { date: '2026-01-01', ingredients: { vodka: 'Absolut' } },
    { date: '2026-02-01', ingredients: { vodka: 'Grey Goose' } },
    { date: '2026-03-01', ingredients: { vodka: 'absolut' } },
  ];
  assert.deepEqual(previouslyUsed(tastings, 'vodka'), ['absolut', 'Grey Goose']);
});
