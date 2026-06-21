const test = require('node:test');
const assert = require('node:assert/strict');
const { randomSearch, validateFilters } = require('../api/_lib/discovery');

test('validates supported filter combinations', () => {
  assert.equal(validateFilters('rock', '1980'), true);
  assert.equal(validateFilters('not-a-genre', '1980'), false);
  assert.equal(validateFilters('rock', '1950'), false);
});

test('combines a selected genre and decade', () => {
  assert.deepEqual(randomSearch('rock', '1980', () => 0), { query: 'genre:rock year:1980-1989', offset: 0 });
});

test('caps the current decade at 2026', () => {
  assert.match(randomSearch('pop', '2020', () => 0).query, /year:2020-2026/);
});
