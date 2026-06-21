const { getSession } = require('../_lib/auth');
const { getAccessToken } = require('../_lib/spotify');
const { handler, json, validateFetchSite } = require('../_lib/http');

module.exports = handler('GET', async (request, response) => {
  validateFetchSite(request);
  const session = await getSession(request);
  const accessToken = await getAccessToken(session.spotify_user_id);
  json(response, 200, { accessToken, expiresIn: 300 });
});
