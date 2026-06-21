const crypto = require('node:crypto');
const { cookie, handler, requiredAppUrl } = require('../_lib/http');
const { required } = require('../_lib/crypto');

module.exports = handler('GET', async (_request, response) => {
  const state = crypto.randomBytes(24).toString('base64url');
  const redirectUri = `${requiredAppUrl()}/api/auth/callback`;
  response.setHeader('Set-Cookie', cookie('spotify_oauth_state', state, { maxAge: 600 }));
  const params = new URLSearchParams({
    client_id: required('SPOTIFY_CLIENT_ID'), response_type: 'code', redirect_uri: redirectUri, state,
    scope: 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state'
  });
  response.redirect(302, `https://accounts.spotify.com/authorize?${params}`);
});
