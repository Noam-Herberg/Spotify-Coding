const { getSession } = require('../_lib/auth');
const { transaction } = require('../_lib/db');
const { handler, json } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');
const { spotifyFetch } = require('../_lib/spotify');
const tracks = require('../_lib/tracks');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  const id = String(request.body?.trackId || '');
  if (!/^[A-Za-z0-9]{10,30}$/.test(id)) throw new HttpError(400, 'Invalid Spotify track.', 'invalid_track');
  const track = tracks.fromSpotify(await spotifyFetch(session.spotify_user_id, `/tracks/${id}`));
  await transaction(async (client) => {
    await tracks.upsert(client, track, session.group_id, false);
    const result = await client.query('INSERT INTO nominations (group_id,track_id,nominated_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING track_id', [session.group_id, id, session.spotify_user_id]);
    if (!result.rowCount) throw new HttpError(409, 'That song is already nominated.', 'duplicate_nomination');
  });
  json(response, 201, { nomination: track });
});
