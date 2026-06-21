const { getSession } = require('../_lib/auth');
const { transaction } = require('../_lib/db');
const { handler, json } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');
const { spotifyFetch } = require('../_lib/spotify');
const tracks = require('../_lib/tracks');
const { requireTournament } = require('../_lib/tournaments');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  const trackId = String(request.body?.trackId || '');
  if (!/^[A-Za-z0-9]{10,30}$/.test(trackId)) throw new HttpError(400, 'Invalid track.', 'invalid_track');
  const track = tracks.fromSpotify(await spotifyFetch(session.spotify_user_id, `/tracks/${trackId}`));
  await transaction(async (client) => {
    const tournament = await requireTournament(client, session, request.body?.tournamentId, true);
    if (!tournament.can_manage || tournament.status !== 'draft') throw new HttpError(403, 'Only the creator or owner can edit this draft.', 'manager_required');
    const count = (await client.query('SELECT count(*)::int count FROM tournament_entries WHERE tournament_id=$1', [tournament.id])).rows[0].count;
    if (count >= tournament.size) throw new HttpError(409, 'The roster is full.', 'roster_full');
    await tracks.upsert(client, track, session.group_id, false);
    try { await client.query('INSERT INTO tournament_entries (tournament_id,track_id) VALUES ($1,$2)', [tournament.id, track.id]); }
    catch (error) { if (error.code === '23505') throw new HttpError(409, 'That song is already in the tournament.', 'duplicate_entry'); throw error; }
  });
  json(response, 201, { track });
});
