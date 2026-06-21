const { getSession } = require('../_lib/auth');
const { getPool } = require('../_lib/db');
const { handler, json } = require('../_lib/http');

module.exports = handler('GET', async (request, response) => {
  const session = await getSession(request, { member: true });
  const result = await getPool().query(`SELECT t.spotify_id AS id,t.uri,t.name,t.artist,t.album,t.image_url AS image,t.spotify_url AS url,
    r.rating,r.wins,r.losses FROM group_track_ratings r JOIN tracks t ON t.spotify_id=r.track_id
    WHERE r.group_id=$1 AND (r.wins+r.losses)>0 ORDER BY r.rating DESC,r.wins DESC,t.name LIMIT 100`, [session.group_id]);
  json(response, 200, { standings: result.rows });
});
