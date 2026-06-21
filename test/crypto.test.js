const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TOKEN_ENCRYPTION_KEY ||= 'test-only-encryption-key-with-32-characters';
process.env.SESSION_SECRET ||= 'test-only-session-secret-with-32-characters';
const { decrypt, encrypt, hashSession, safeEqual } = require('../api/_lib/crypto');

test('encrypts and decrypts Spotify credentials', () => {
  const encrypted = encrypt('refresh-token');
  assert.notEqual(encrypted, 'refresh-token');
  assert.equal(decrypt(encrypted), 'refresh-token');
});

test('hashes sessions deterministically without retaining plaintext', () => {
  assert.equal(hashSession('session'), hashSession('session'));
  assert.notEqual(hashSession('session'), 'session');
});

test('compares invite values safely', () => {
  assert.equal(safeEqual('invite', 'invite'), true);
  assert.equal(safeEqual('invite', 'wrong'), false);
});
