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
  if (![8, 16, 32].includes(cap)) throw new Error('Bracket size must be 8, 16, or 32.');
  const requiredSlots = playerCount * 2 + 2;
  if (requiredSlots > cap) throw new Error(`This room needs at least a ${requiredSlots <= 16 ? 16 : 32}-song bracket.`);
  return { bracketSize: cap, randomCount: cap - playerCount * 2 };
}

function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function publicPlayer(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    active: row.active,
    ready: row.ready,
    pickCount: Number(row.pick_count || 0),
    overallScore: Number(row.overall_score || 0)
  };
}

function releaseWindow(releaseDate) {
  const year = Number(String(releaseDate || '').slice(0, 4));
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return null;
  const start = Math.floor(year / 10) * 10;
  return { start, end: Math.min(start + 9, new Date().getUTCFullYear()) };
}

function decideVote(totals, attempt) {
  if (!totals.length) return { outcome: 'none' };
  const tied = totals.length > 1 && totals[0].total === totals[1].total;
  if (tied) return { outcome: attempt === 1 ? 'revote' : 'tiebreak' };
  return { outcome: 'win', songId: totals[0].song_id };
}

function rankKnownTracks(values) {
  return [...values].sort((left, right) => {
    const popularity = Number(right.popularity || 0) - Number(left.popularity || 0);
    return popularity || Number(Boolean(right.album?.album_type === 'album')) - Number(Boolean(left.album?.album_type === 'album'));
  });
}

module.exports = { bracketPlan, decideVote, guestToken, hashGuestToken, publicPlayer, rankKnownTracks, releaseWindow, roomCode, shuffle };
