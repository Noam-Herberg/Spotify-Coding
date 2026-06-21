const crypto = require('node:crypto');
const { required } = require('./crypto');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function roomCode(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

function guestToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashGuestToken(token) {
  return crypto.createHmac('sha256', required('SESSION_SECRET')).update(`party-player:${token}`).digest('hex');
}

function bracketPlan(playerCount, cap) {
  if (!Number.isInteger(playerCount) || playerCount < 2) throw new Error('At least two players are required.');
  if (![16, 32].includes(cap)) throw new Error('Bracket cap must be 16 or 32.');
  const requiredSlots = playerCount * 2 + 2;
  let size = 1;
  while (size < requiredSlots) size *= 2;
  if (size > cap) throw new Error(`This room needs a ${size}-song bracket.`);
  return { bracketSize: size, randomCount: size - playerCount * 2 };
}

function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

module.exports = { bracketPlan, guestToken, hashGuestToken, roomCode, shuffle };
