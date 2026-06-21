const { getSession } = require('../_lib/auth');
const { getPool } = require('../_lib/db');
const { handler, json } = require('../_lib/http');

module.exports = handler('GET', async (request, response) => {
  const session = await getSession(request, { member: true });
  const result = await getPool().query(`SELECT t.*,u.display_name creator_name,c.name champion_name,count(e.track_id)::int entry_count
    FROM tournaments t JOIN users u ON u.spotify_user_id=t.created_by LEFT JOIN tracks c ON c.spotify_id=t.champion_track_id
    LEFT JOIN tournament_entries e ON e.tournament_id=t.id WHERE t.group_id=$1 GROUP BY t.id,u.display_name,c.name ORDER BY t.created_at DESC LIMIT 30`, [session.group_id]);
  json(response, 200, { tournaments: result.rows });
});
