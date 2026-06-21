const { getSession } = require('../_lib/auth');
const { transaction } = require('../_lib/db');
const { handler, json } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');
const { saveSnapshot } = require('../_lib/playlists');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  const row = await transaction(async (client) => {
    const playlist = (await client.query('SELECT * FROM imported_playlists WHERE id=$1 AND group_id=$2 AND imported_by=$3 FOR UPDATE', [request.body?.playlistId, session.group_id, session.spotify_user_id])).rows[0];
    if (!playlist) throw new HttpError(404, 'Only the importer can refresh this playlist.', 'playlist_not_found');
    return saveSnapshot(client, session, playlist.spotify_playlist_id, playlist.id);
  });
  json(response, 200, { playlist: row });
});
