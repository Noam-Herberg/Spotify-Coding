const { getSession } = require('../_lib/auth');
const { getPool } = require('../_lib/db');
const { handler, json } = require('../_lib/http');

module.exports = handler('GET', async (request, response) => {
  const session = await getSession(request, { member: true });
  const result = await getPool().query(`SELECT t.spotify_id id,t.uri,t.name,t.artist,t.album,t.image_url image,t.spotify_url url,
    n.nominated_by,u.display_name nominated_by_name,n.created_at,(n.nominated_by=$2 OR $3::boolean) can_remove
    FROM nominations n JOIN tracks t ON t.spotify_id=n.track_id JOIN users u ON u.spotify_user_id=n.nominated_by
    WHERE n.group_id=$1 ORDER BY n.created_at DESC`, [session.group_id, session.spotify_user_id, session.is_owner]);
  json(response, 200, { nominations: result.rows });
});
