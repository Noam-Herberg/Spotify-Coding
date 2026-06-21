const { getSession } = require('../_lib/auth');
const { getPool } = require('../_lib/db');
const { handler, json } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  const id = String(request.body?.trackId || '');
  const result = await getPool().query(`DELETE FROM nominations WHERE group_id=$1 AND track_id=$2
    AND (nominated_by=$3 OR $4::boolean) RETURNING track_id`, [session.group_id, id, session.spotify_user_id, session.is_owner]);
  if (!result.rowCount) throw new HttpError(404, 'Nomination not found or cannot be removed.', 'nomination_not_found');
  json(response, 200, { removed: id });
});
