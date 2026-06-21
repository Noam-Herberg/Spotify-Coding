const { getSession } = require('../_lib/auth');
const { transaction } = require('../_lib/db');
const { handler, json } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');
const { requireTournament } = require('../_lib/tournaments');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  await transaction(async (client) => {
    const tournament = await requireTournament(client, session, request.body?.tournamentId, true);
    if (!tournament.can_manage || tournament.status !== 'draft') throw new HttpError(403, 'Only the creator or owner can edit this draft.', 'manager_required');
    await client.query('DELETE FROM tournament_entries WHERE tournament_id=$1 AND track_id=$2', [tournament.id, request.body?.trackId]);
  });
  json(response, 200, { removed: request.body?.trackId });
});
