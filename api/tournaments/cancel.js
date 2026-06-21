const { getSession } = require('../_lib/auth');
const { transaction } = require('../_lib/db');
const { handler, json } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');
const { requireTournament } = require('../_lib/tournaments');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  await transaction(async (client) => {
    const tournament = await requireTournament(client, session, request.body?.tournamentId, true);
    if (!tournament.can_manage || !['draft', 'active'].includes(tournament.status)) throw new HttpError(403, 'Only the creator or owner can cancel this tournament.', 'manager_required');
    await client.query("UPDATE tournaments SET status='cancelled' WHERE id=$1", [tournament.id]);
  });
  json(response, 200, { cancelled: true });
});
