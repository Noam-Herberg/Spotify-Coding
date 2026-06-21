const { transaction } = require('./db');
const { decrypt, encrypt, required } = require('./crypto');
const { HttpError } = require('./errors');

async function exchangeCode(code, redirectUri) {
  const credentials = Buffer.from(`${required('SPOTIFY_CLIENT_ID')}:${required('SPOTIFY_CLIENT_SECRET')}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
  });
  if (!response.ok) throw new HttpError(400, 'Spotify rejected the login callback.', 'spotify_callback_failed');
  return response.json();
}

async function spotifyProfile(accessToken) {
  const response = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new HttpError(502, 'Spotify profile lookup failed.', 'spotify_profile_failed');
  return response.json();
}

async function getAccessToken(userId) {
  return transaction(async (client) => {
    const account = (await client.query('SELECT * FROM spotify_accounts WHERE spotify_user_id = $1 FOR UPDATE', [userId])).rows[0];
    if (!account) throw new HttpError(401, 'Reconnect Spotify.', 'spotify_reconnect_required');
    if (new Date(account.token_expires_at).getTime() > Date.now() + 600000) return decrypt(account.access_token_encrypted);
    const credentials = Buffer.from(`${required('SPOTIFY_CLIENT_ID')}:${required('SPOTIFY_CLIENT_SECRET')}`).toString('base64');
    const currentRefreshToken = decrypt(account.refresh_token_encrypted);
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: currentRefreshToken })
    });
    if (!response.ok) throw new HttpError(401, 'Reconnect Spotify.', 'spotify_reconnect_required');
    const token = await response.json();
    await client.query(`UPDATE spotify_accounts SET access_token_encrypted=$1, refresh_token_encrypted=$2,
      token_expires_at=now()+make_interval(secs => $3::int), updated_at=now() WHERE spotify_user_id=$4`,
      [encrypt(token.access_token), encrypt(token.refresh_token || currentRefreshToken), token.expires_in, userId]);
    return token.access_token;
  });
}

async function spotifyFetch(userId, path, options = {}) {
  const token = await getAccessToken(userId);
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = response.status === 403 ? 'Reconnect Spotify to grant playlist access.' : payload.error?.message || 'Spotify could not complete this request.';
    throw new HttpError(response.status === 429 ? 429 : 502, message, 'spotify_api_failed');
  }
  return response.status === 204 ? null : response.json();
}

module.exports = { exchangeCode, getAccessToken, spotifyFetch, spotifyProfile };
