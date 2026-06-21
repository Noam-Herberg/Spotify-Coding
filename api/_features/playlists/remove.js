const { getSession } = require('../_lib/auth');
const { getPool } = require('../_lib/db');
const { handler, json } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  const result = await getPool().query('DELETE FROM imported_playlists WHERE id=$1 AND group_id=$2 AND (imported_by=$3 OR $4::boolean) RETURNING id', [request.body?.playlistId, session.group_id, session.spotify_user_id, session.is_owner]);
  if (!result.rowCount) throw new HttpError(404, 'Playlist not found or cannot be removed.', 'playlist_not_found');
  json(response, 200, { removed: result.rows[0].id });
});
