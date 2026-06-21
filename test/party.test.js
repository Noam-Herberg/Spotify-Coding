const test = require('node:test');
const assert = require('node:assert/strict');
const { bracketPlan, publicPlayer, roomCode, shuffle } = require('../api/_lib/party');

test('bracket plan includes two surprises and chooses the next power of two', () => {
  assert.deepEqual(bracketPlan(2, 16), { bracketSize: 8, randomCount: 4 });
  assert.deepEqual(bracketPlan(7, 16), { bracketSize: 16, randomCount: 2 });
  assert.deepEqual(bracketPlan(15, 32), { bracketSize: 32, randomCount: 2 });
  assert.throws(() => bracketPlan(8, 16), /needs a 32-song bracket/);
});

test('room code uses six unambiguous characters', () => {
  const code = roomCode(() => Buffer.from([0, 1, 2, 3, 4, 31]));
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
});

test('shuffle retains every element', () => {
  assert.deepEqual(shuffle([1, 2, 3], () => 0), [2, 3, 1]);
});

test('maps database player fields to the public phone state', () => {
  assert.deepEqual(publicPlayer({ id: 'p1', display_name: 'Alex', active: true, ready: false, pick_count: '2' }), {
    id: 'p1', displayName: 'Alex', active: true, ready: false, pickCount: 2, overallScore: 0
  });
});
