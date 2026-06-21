const crypto = require('node:crypto');
const { getPool } = require('./db');
const { hashSession } = require('./crypto');
const { cookies } = require('./http');
const { HttpError } = require('./errors');

async function createSession(client, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await client.query('INSERT INTO sessions (token_hash, spotify_user_id, expires_at) VALUES ($1, $2, now() + interval \'30 days\')', [hashSession(token), userId]);
  return token;
}

async function getSession(request, { required = true, member = false } = {}) {
  const token = cookies(request).song_battle_session;
  if (!token) {
    if (required) throw new HttpError(401, 'Sign in with Spotify.', 'authentication_required');
    return null;
  }
  const result = await getPool().query(`
    SELECT u.spotify_user_id, u.display_name, u.email, s.expires_at,
           gm.group_id, (g.owner_user_id = u.spotify_user_id) AS is_owner
    FROM sessions s
    JOIN users u ON u.spotify_user_id = s.spotify_user_id
    LEFT JOIN group_members gm ON gm.spotify_user_id = u.spotify_user_id
    LEFT JOIN groups g ON g.id = gm.group_id
    WHERE s.token_hash = $1 AND s.expires_at > now()
    ORDER BY is_owner DESC NULLS LAST, gm.group_id
    LIMIT 1
  `, [hashSession(token)]);
  const session = result.rows[0];
  if (!session) {
    if (!required) return null;
    throw new HttpError(401, 'Your session expired. Sign in again.', 'session_expired');
  }
  if (member && !session.group_id) throw new HttpError(403, 'Join the private group first.', 'membership_required');
  return session;
}

async function deleteSession(request) {
  const token = cookies(request).song_battle_session;
  if (token) await getPool().query('DELETE FROM sessions WHERE token_hash = $1', [hashSession(token)]);
}

module.exports = { createSession, deleteSession, getSession };
