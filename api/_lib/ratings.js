const { calculateElo } = require('./elo');

async function applyRating(client, groupId, winnerId, loserId) {
  await client.query('INSERT INTO group_track_ratings (group_id,track_id) SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING', [groupId, [winnerId, loserId]]);
  const rows = (await client.query('SELECT * FROM group_track_ratings WHERE group_id=$1 AND track_id=ANY($2::text[]) ORDER BY track_id FOR UPDATE', [groupId, [winnerId, loserId]])).rows;
  const winner = rows.find((row) => row.track_id === winnerId);
  const loser = rows.find((row) => row.track_id === loserId);
  const result = calculateElo(winner.rating, loser.rating);
  await client.query('UPDATE group_track_ratings SET rating=$1,wins=wins+1,updated_at=now() WHERE group_id=$2 AND track_id=$3', [result.winnerAfter, groupId, winnerId]);
  await client.query('UPDATE group_track_ratings SET rating=$1,losses=losses+1,updated_at=now() WHERE group_id=$2 AND track_id=$3', [result.loserAfter, groupId, loserId]);
  return { ...result, winnerBefore: winner.rating, loserBefore: loser.rating };
}

module.exports = { applyRating };
