const { getSession } = require('../_lib/auth');
const { getPool } = require('../_lib/db');
const { handler, json } = require('../_lib/http');

module.exports = handler('GET', async (request, response) => {
  const session = await getSession(request, { member: true });
  const result = await getPool().query(`SELECT p.id,p.name,p.image_url image,p.spotify_url url,p.imported_by,u.display_name imported_by_name,p.refreshed_at,
    count(pt.track_id)::int track_count,(p.imported_by=$2 OR $3::boolean) can_remove,(p.imported_by=$2) can_refresh
    FROM imported_playlists p JOIN users u ON u.spotify_user_id=p.imported_by LEFT JOIN imported_playlist_tracks pt ON pt.playlist_id=p.id
    WHERE p.group_id=$1 GROUP BY p.id,u.display_name ORDER BY p.created_at DESC`, [session.group_id, session.spotify_user_id, session.is_owner]);
  json(response, 200, { playlists: result.rows });
});
