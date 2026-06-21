const { getSession } = require('../_lib/auth');
const { getPool } = require('../_lib/db');
const { handler, json } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');
const { spotifyFetch } = require('../_lib/spotify');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  let name;
  let rows;
  if (request.body?.type === 'standings') {
    name = 'Song Battle – Group Top 25';
    rows = (await getPool().query(`SELECT t.uri FROM group_track_ratings r JOIN tracks t ON t.spotify_id=r.track_id
      WHERE r.group_id=$1 AND r.wins+r.losses>0 ORDER BY r.rating DESC,r.wins DESC LIMIT 25`, [session.group_id])).rows;
  } else if (request.body?.type === 'tournament') {
    const tournament = (await getPool().query('SELECT * FROM tournaments WHERE id=$1 AND group_id=$2 AND status=$3', [request.body.tournamentId, session.group_id, 'completed'])).rows[0];
    if (!tournament) throw new HttpError(404, 'Completed tournament not found.', 'tournament_not_found');
    name = `Song Battle – ${tournament.name}`;
    rows = (await getPool().query(`SELECT t.uri FROM tournament_entries e JOIN tracks t ON t.spotify_id=e.track_id
      WHERE e.tournament_id=$1 ORDER BY (e.track_id=$2) DESC,e.seed`, [tournament.id, tournament.champion_track_id])).rows;
  } else throw new HttpError(400, 'Choose standings or a completed tournament.', 'invalid_export');
  if (!rows.length) throw new HttpError(409, 'There are no songs to export yet.', 'empty_export');
  const created = await spotifyFetch(session.spotify_user_id, '/me/playlists', { method: 'POST', body: JSON.stringify({ name, public: false, description: 'Created by Song Battle' }) });
  await spotifyFetch(session.spotify_user_id, `/playlists/${created.id}/items`, { method: 'POST', body: JSON.stringify({ uris: rows.map((row) => row.uri) }) });
  json(response, 201, { playlist: { id: created.id, name: created.name, url: created.external_urls?.spotify } });
});
