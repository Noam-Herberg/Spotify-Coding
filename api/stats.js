const { getSession } = require('./_lib/auth');
const { getPool } = require('./_lib/db');
const { handler, json } = require('./_lib/http');

module.exports = handler('GET', async (request, response) => {
  const session = await getSession(request, { member: true });
  const members = (await getPool().query(`SELECT u.spotify_user_id id,u.display_name name FROM group_members gm
    JOIN users u ON u.spotify_user_id=gm.spotify_user_id WHERE gm.group_id=$1 ORDER BY u.display_name`, [session.group_id])).rows;
  const votes = (await getPool().query(`SELECT * FROM (
    SELECT voter_user_id,winner_track_id,loser_track_id,winner_rating_before,loser_rating_before,created_at,false tournament FROM votes WHERE group_id=$1
    UNION ALL SELECT voter_user_id,winner_track_id,loser_track_id,winner_rating_before,loser_rating_before,created_at,true FROM tournament_votes WHERE group_id=$1
    ) all_votes ORDER BY created_at`, [session.group_id])).rows;
  const trackIds = [...new Set(votes.flatMap((vote) => [vote.winner_track_id, vote.loser_track_id]))];
  const trackRows = trackIds.length ? (await getPool().query('SELECT spotify_id,name,artist FROM tracks WHERE spotify_id=ANY($1::text[])', [trackIds])).rows : [];
  const trackMap = new Map(trackRows.map((track) => [track.spotify_id, track]));
  const choices = new Map();
  const result = members.map((member) => {
    const own = votes.filter((vote) => vote.voter_user_id === member.id);
    const wins = new Map();
    const artists = new Map();
    for (const vote of own) {
      wins.set(vote.winner_track_id, (wins.get(vote.winner_track_id) || 0) + 1);
      const artist = trackMap.get(vote.winner_track_id)?.artist || 'Unknown';
      artists.set(artist, (artists.get(artist) || 0) + 1);
      const pair = [vote.winner_track_id, vote.loser_track_id].sort().join(':');
      choices.set(`${member.id}:${pair}`, vote.winner_track_id);
    }
    const favouriteId = [...wins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const favouriteArtist = [...artists.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const upset = own.filter((vote) => vote.winner_rating_before < vote.loser_rating_before).sort((a, b) => (b.loser_rating_before - b.winner_rating_before) - (a.loser_rating_before - a.winner_rating_before))[0];
    return { ...member, totalVotes: own.length, tournamentVotes: own.filter((vote) => vote.tournament).length, favouriteTrack: favouriteId ? trackMap.get(favouriteId) : null, favouriteArtist, biggestUpset: upset ? { winner: trackMap.get(upset.winner_track_id), difference: upset.loser_rating_before - upset.winner_rating_before } : null };
  });
  const agreement = [];
  for (let a = 0; a < members.length; a += 1) for (let b = a + 1; b < members.length; b += 1) {
    let compared = 0; let agreed = 0;
    for (const key of choices.keys()) {
      if (!key.startsWith(`${members[a].id}:`)) continue;
      const pair = key.slice(members[a].id.length + 1);
      const other = choices.get(`${members[b].id}:${pair}`);
      if (other) { compared += 1; if (other === choices.get(key)) agreed += 1; }
    }
    agreement.push({ left: members[a], right: members[b], compared, percentage: compared ? Math.round(agreed / compared * 100) : null });
  }
  json(response, 200, { members: result, agreement });
});
