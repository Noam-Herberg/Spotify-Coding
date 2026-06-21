const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateElo } = require('../api/_lib/elo');

test('equal ratings exchange 16 points', () => {
  assert.deepEqual(calculateElo(1000, 1000), { change: 16, winnerAfter: 1016, loserAfter: 984 });
});

test('an upset awards more points than an expected win', () => {
  assert.ok(calculateElo(800, 1200).change > calculateElo(1200, 800).change);
});

test('the rating pool remains constant', () => {
  const result = calculateElo(1120, 940);
  assert.equal(result.winnerAfter + result.loserAfter, 2060);
});
