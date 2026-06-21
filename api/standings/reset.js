const { getSession } = require('../_lib/auth');
const { transaction } = require('../_lib/db');
const { handler } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  if (!session.is_owner) throw new HttpError(403, 'Only the group owner can reset standings.', 'owner_required');
  await transaction(async (client) => {
    const active = await client.query("SELECT 1 FROM tournaments WHERE group_id=$1 AND status='active'", [session.group_id]);
    if (active.rowCount) throw new HttpError(409, 'Finish or cancel the active tournament before resetting standings.', 'active_tournament_exists');
    await client.query('DELETE FROM tournament_votes WHERE group_id=$1', [session.group_id]);
    await client.query('DELETE FROM votes WHERE group_id=$1', [session.group_id]);
    await client.query('DELETE FROM battles WHERE group_id=$1', [session.group_id]);
    await client.query('DELETE FROM group_track_ratings WHERE group_id=$1', [session.group_id]);
  });
  response.status(204).end();
});
