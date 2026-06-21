const { getSession } = require('./_lib/auth');
const { handler, json } = require('./_lib/http');
const { HttpError } = require('./_lib/errors');
const { spotifyFetch } = require('./_lib/spotify');
const { fromSpotify } = require('./_lib/tracks');

module.exports = handler('GET', async (request, response) => {
  const session = await getSession(request, { member: true });
  const q = String(request.query.q || '').trim();
  if (q.length < 2 || q.length > 100) throw new HttpError(400, 'Enter at least two characters.', 'invalid_search');
  const payload = await spotifyFetch(session.spotify_user_id, `/search?${new URLSearchParams({ q, type: 'track', limit: '10' })}`);
  json(response, 200, { tracks: payload.tracks.items.filter((track) => track && !track.is_local).map(fromSpotify) });
});
