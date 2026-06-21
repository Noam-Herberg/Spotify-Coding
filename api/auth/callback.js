const { transaction } = require('../_lib/db');
const { createSession } = require('../_lib/auth');
const { encrypt, safeEqual } = require('../_lib/crypto');
const { cookie, cookies, handler, requiredAppUrl } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');
const { exchangeCode, spotifyProfile } = require('../_lib/spotify');

module.exports = handler('GET', async (request, response) => {
  const state = cookies(request).spotify_oauth_state;
  if (!state || !request.query.state || !safeEqual(state, request.query.state)) throw new HttpError(400, 'Spotify login state could not be verified.', 'invalid_oauth_state');
  if (!request.query.code) throw new HttpError(400, 'Spotify login was cancelled.', 'spotify_login_cancelled');
  const appUrl = requiredAppUrl(request);
  const token = await exchangeCode(request.query.code, `${appUrl}/api/auth/callback`);
  const profile = await spotifyProfile(token.access_token);
  const sessionToken = await transaction(async (client) => {
    await client.query(`INSERT INTO users (spotify_user_id, display_name, email) VALUES ($1,$2,$3)
      ON CONFLICT (spotify_user_id) DO UPDATE SET display_name=EXCLUDED.display_name,email=EXCLUDED.email,updated_at=now()`,
      [profile.id, profile.display_name || profile.id, profile.email || null]);
    const existing = await client.query('SELECT refresh_token_encrypted FROM spotify_accounts WHERE spotify_user_id=$1', [profile.id]);
    const refresh = token.refresh_token ? encrypt(token.refresh_token) : existing.rows[0]?.refresh_token_encrypted;
    if (!refresh) throw new HttpError(400, 'Spotify did not issue a refresh token. Remove app access in Spotify and reconnect.', 'missing_refresh_token');
    await client.query(`INSERT INTO spotify_accounts (spotify_user_id,access_token_encrypted,refresh_token_encrypted,token_expires_at)
      VALUES ($1,$2,$3,now()+make_interval(secs => $4::int)) ON CONFLICT (spotify_user_id) DO UPDATE SET
      access_token_encrypted=EXCLUDED.access_token_encrypted,refresh_token_encrypted=EXCLUDED.refresh_token_encrypted,
      token_expires_at=EXCLUDED.token_expires_at,updated_at=now()`, [profile.id, encrypt(token.access_token), refresh, token.expires_in]);
    return createSession(client, profile.id);
  });
  response.setHeader('Set-Cookie', [cookie('song_battle_session', sessionToken, { maxAge: 2592000 }), cookie('spotify_oauth_state', '', { maxAge: 0 })]);
  response.redirect(302, `${appUrl}/host`);
});
