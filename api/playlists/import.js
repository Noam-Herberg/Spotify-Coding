const { getSession } = require('../_lib/auth');
const { transaction } = require('../_lib/db');
const { handler, json } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');
const { saveSnapshot } = require('../_lib/playlists');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  const id = String(request.body?.spotifyPlaylistId || '');
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) throw new HttpError(400, 'Invalid Spotify playlist.', 'invalid_playlist');
  const saved = await transaction(async (client) => {
    const duplicate = await client.query('SELECT 1 FROM imported_playlists WHERE group_id=$1 AND spotify_playlist_id=$2', [session.group_id, id]);
    if (duplicate.rowCount) throw new HttpError(409, 'That playlist is already imported. Refresh the existing snapshot instead.', 'duplicate_playlist');
    return saveSnapshot(client, session, id);
  });
  json(response, 201, { playlist: saved });
});
