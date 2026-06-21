const crypto = require('node:crypto');
const { getSession } = require('../_lib/auth');
const { transaction } = require('../_lib/db');
const { handler, json } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');
const { requireTournament } = require('../_lib/tournaments');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  await transaction(async (client) => {
    const tournament = await requireTournament(client, session, request.body?.tournamentId, true);
    if (!tournament.can_manage || tournament.status !== 'draft') throw new HttpError(403, 'Only the creator or owner can start this draft.', 'manager_required');
    const active = await client.query("SELECT 1 FROM tournaments WHERE group_id=$1 AND status='active' AND id<>$2", [session.group_id, tournament.id]);
    if (active.rowCount) throw new HttpError(409, 'Another tournament is active.', 'active_tournament_exists');
    const entries = (await client.query('SELECT track_id FROM tournament_entries WHERE tournament_id=$1', [tournament.id])).rows;
    if (entries.length !== tournament.size) throw new HttpError(409, `Add exactly ${tournament.size} songs before starting.`, 'incomplete_roster');
    const shuffled = entries.map((row) => row.track_id).sort(() => Math.random() - 0.5);
    for (let index = 0; index < shuffled.length; index += 1) await client.query('UPDATE tournament_entries SET seed=$1 WHERE tournament_id=$2 AND track_id=$3', [index + 1, tournament.id, shuffled[index]]);
    await client.query('INSERT INTO tournament_members (tournament_id,spotify_user_id) SELECT $1,spotify_user_id FROM group_members WHERE group_id=$2', [tournament.id, session.group_id]);
    const rounds = Math.log2(tournament.size);
    for (let round = 1; round <= rounds; round += 1) {
      const count = tournament.size / (2 ** round);
      for (let position = 0; position < count; position += 1) {
        await client.query(`INSERT INTO tournament_matchups (id,tournament_id,round,position,left_track_id,right_track_id,status)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [crypto.randomUUID(), tournament.id, round, position, round === 1 ? shuffled[position * 2] : null, round === 1 ? shuffled[position * 2 + 1] : null, round === 1 ? 'open' : 'pending']);
      }
    }
    await client.query("UPDATE tournaments SET status='active',started_at=now() WHERE id=$1", [tournament.id]);
  });
  json(response, 200, { started: true });
});
