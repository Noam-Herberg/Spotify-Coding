const { getSession } = require('../_lib/auth');
const { getPool, transaction } = require('../_lib/db');
const { handler, json } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');
const { randomTrack } = require('../_lib/battles');
const tracks = require('../_lib/tracks');
const { requireTournament } = require('../_lib/tournaments');
const { validateFilters } = require('../_lib/discovery');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  const tournament = await requireTournament(getPool(), session, request.body?.tournamentId);
  if (!tournament.can_manage || tournament.status !== 'draft') throw new HttpError(403, 'Only the creator or owner can fill this draft.', 'manager_required');
  const current = (await getPool().query('SELECT track_id FROM tournament_entries WHERE tournament_id=$1', [tournament.id])).rows.map((row) => row.track_id);
  const needed = tournament.size - current.length;
  if (!needed) throw new HttpError(409, 'The roster is already full.', 'roster_full');
  const source = request.body?.source;
  let additions = [];
  if (source === 'random') {
    if (!validateFilters(request.body?.genre || 'all', request.body?.decade || 'all')) throw new HttpError(400, 'Invalid random discovery filters.', 'invalid_filters');
    const excluded = new Set(current);
    for (let index = 0; index < needed; index += 1) { const track = await randomTrack(session.spotify_user_id, request.body?.genre || 'all', request.body?.decade || 'all', excluded); additions.push(track); excluded.add(track.id); }
  } else {
    const params = [session.group_id, current, needed];
    let join;
    if (source === 'nominations') join = 'JOIN nominations n ON n.track_id=t.spotify_id AND n.group_id=$1';
    else if (source === 'playlist') { params.push(request.body?.playlistId); join = 'JOIN imported_playlist_tracks ipt ON ipt.track_id=t.spotify_id JOIN imported_playlists ip ON ip.id=ipt.playlist_id AND ip.group_id=$1 AND ip.id=$4'; }
    else throw new HttpError(400, 'Choose nominations, playlist, or random.', 'invalid_fill_source');
    additions = (await getPool().query(`SELECT t.* FROM tracks t ${join} WHERE NOT (t.spotify_id=ANY($2::text[])) ORDER BY random() LIMIT $3`, params)).rows.map((row) => tracks.fromRow(row));
    if (additions.length < needed) throw new HttpError(409, `This source only has ${additions.length} additional songs; ${needed} are needed.`, 'source_too_small');
  }
  await transaction(async (client) => {
    const locked = await requireTournament(client, session, tournament.id, true);
    if (locked.status !== 'draft') throw new HttpError(409, 'This tournament already started.', 'tournament_started');
    for (const track of additions) { await tracks.upsert(client, track, session.group_id, false); await client.query('INSERT INTO tournament_entries (tournament_id,track_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [tournament.id, track.id]); }
  });
  json(response, 200, { added: additions.length });
});
