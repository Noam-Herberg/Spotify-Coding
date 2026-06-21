const crypto = require('node:crypto');
const { getPool, transaction } = require('./db');
const { HttpError } = require('./errors');
const { applyRating } = require('./ratings');

const trackSelect = `t.spotify_id id,t.uri,t.name,t.artist,t.album,t.image_url image,t.spotify_url url`;

async function requireTournament(client, session, id, lock = false) {
  const tournament = (await client.query(`SELECT t.*,(t.created_by=$3 OR $4::boolean) can_manage FROM tournaments t WHERE t.id=$1 AND t.group_id=$2${lock ? ' FOR UPDATE' : ''}`, [id, session.group_id, session.spotify_user_id, session.is_owner])).rows[0];
  if (!tournament) throw new HttpError(404, 'Tournament not found.', 'tournament_not_found');
  return tournament;
}

async function detail(session, id) {
  const tournament = (await getPool().query('SELECT t.*,(t.created_by=$3 OR $4::boolean) can_manage,u.display_name creator_name FROM tournaments t JOIN users u ON u.spotify_user_id=t.created_by WHERE t.id=$1 AND t.group_id=$2', [id, session.group_id, session.spotify_user_id, session.is_owner])).rows[0];
  if (!tournament) throw new HttpError(404, 'Tournament not found.', 'tournament_not_found');
  const entries = (await getPool().query(`SELECT ${trackSelect},e.seed FROM tournament_entries e JOIN tracks t ON t.spotify_id=e.track_id WHERE e.tournament_id=$1 ORDER BY e.seed NULLS LAST,e.added_at`, [id])).rows;
  const matchups = (await getPool().query(`SELECT m.*,lt.name left_name,lt.artist left_artist,lt.image_url left_image,lt.uri left_uri,
    rt.name right_name,rt.artist right_artist,rt.image_url right_image,rt.uri right_uri,
    count(v.id)::int vote_count,count(v.id) FILTER (WHERE v.winner_track_id=m.left_track_id)::int left_votes,
    count(v.id) FILTER (WHERE v.winner_track_id=m.right_track_id)::int right_votes,
    bool_or(v.voter_user_id=$2) has_voted
    FROM tournament_matchups m LEFT JOIN tracks lt ON lt.spotify_id=m.left_track_id LEFT JOIN tracks rt ON rt.spotify_id=m.right_track_id
    LEFT JOIN tournament_votes v ON v.matchup_id=m.id WHERE m.tournament_id=$1
    GROUP BY m.id,lt.name,lt.artist,lt.image_url,lt.uri,rt.name,rt.artist,rt.image_url,rt.uri ORDER BY m.round,m.position`, [id, session.spotify_user_id])).rows;
  const electorate = (await getPool().query('SELECT count(*)::int count FROM tournament_members WHERE tournament_id=$1', [id])).rows[0].count;
  return { ...tournament, entries, matchups, electorate };
}

async function advance(client, tournament, matchup, winnerId) {
  await client.query("UPDATE tournament_matchups SET winner_track_id=$1,status='closed',closed_at=now() WHERE id=$2", [winnerId, matchup.id]);
  const rounds = Math.log2(tournament.size);
  if (matchup.round === rounds) {
    await client.query("UPDATE tournaments SET status='completed',champion_track_id=$1,completed_at=now() WHERE id=$2", [winnerId, tournament.id]);
    return;
  }
  const nextPosition = Math.floor(matchup.position / 2);
  const field = matchup.position % 2 === 0 ? 'left_track_id' : 'right_track_id';
  await client.query(`UPDATE tournament_matchups SET ${field}=$1 WHERE tournament_id=$2 AND round=$3 AND position=$4`, [winnerId, tournament.id, matchup.round + 1, nextPosition]);
  await client.query("UPDATE tournament_matchups SET status='open' WHERE tournament_id=$1 AND round=$2 AND position=$3 AND left_track_id IS NOT NULL AND right_track_id IS NOT NULL", [tournament.id, matchup.round + 1, nextPosition]);
}

async function vote(session, matchupId, winnerId) {
  const recent = await getPool().query("SELECT count(*)::int count FROM tournament_votes WHERE voter_user_id=$1 AND created_at>now()-interval '1 hour'", [session.spotify_user_id]);
  if (recent.rows[0].count >= 120) throw new HttpError(429, 'Vote limit reached. Try again later.', 'rate_limited');
  return transaction(async (client) => {
    const matchup = (await client.query('SELECT m.*,t.group_id,t.status tournament_status,t.size,t.created_by FROM tournament_matchups m JOIN tournaments t ON t.id=m.tournament_id WHERE m.id=$1 FOR UPDATE OF m,t', [matchupId])).rows[0];
    if (!matchup || matchup.group_id !== session.group_id || matchup.tournament_status !== 'active' || matchup.status !== 'open') throw new HttpError(404, 'Open matchup not found.', 'matchup_not_found');
    if (![matchup.left_track_id, matchup.right_track_id].includes(winnerId)) throw new HttpError(400, 'Winner must be in this matchup.', 'invalid_winner');
    const eligible = await client.query('SELECT 1 FROM tournament_members WHERE tournament_id=$1 AND spotify_user_id=$2', [matchup.tournament_id, session.spotify_user_id]);
    if (!eligible.rowCount) throw new HttpError(403, 'You joined after this tournament started and cannot vote in it.', 'not_in_electorate');
    const loserId = winnerId === matchup.left_track_id ? matchup.right_track_id : matchup.left_track_id;
    const rating = await applyRating(client, session.group_id, winnerId, loserId);
    try {
      await client.query(`INSERT INTO tournament_votes (id,matchup_id,group_id,voter_user_id,winner_track_id,loser_track_id,winner_rating_before,winner_rating_after,loser_rating_before,loser_rating_after)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [crypto.randomUUID(), matchupId, session.group_id, session.spotify_user_id, winnerId, loserId, rating.winnerBefore, rating.winnerAfter, rating.loserBefore, rating.loserAfter]);
    } catch (error) {
      if (error.code === '23505') throw new HttpError(409, 'You already voted in this matchup.', 'duplicate_vote');
      throw error;
    }
    const counts = (await client.query(`SELECT count(*)::int total,count(*) FILTER (WHERE winner_track_id=$2)::int left_votes,count(*) FILTER (WHERE winner_track_id=$3)::int right_votes FROM tournament_votes WHERE matchup_id=$1`, [matchupId, matchup.left_track_id, matchup.right_track_id])).rows[0];
    const electorate = (await client.query('SELECT count(*)::int count FROM tournament_members WHERE tournament_id=$1', [matchup.tournament_id])).rows[0].count;
    if (counts.total === electorate && counts.left_votes !== counts.right_votes) await advance(client, { id: matchup.tournament_id, size: matchup.size }, matchup, counts.left_votes > counts.right_votes ? matchup.left_track_id : matchup.right_track_id);
    return { closed: counts.total === electorate && counts.left_votes !== counts.right_votes, tied: counts.total === electorate && counts.left_votes === counts.right_votes };
  });
}

async function close(session, matchupId, tieWinnerId) {
  return transaction(async (client) => {
    const matchup = (await client.query('SELECT m.*,t.group_id,t.size,t.created_by,t.status tournament_status FROM tournament_matchups m JOIN tournaments t ON t.id=m.tournament_id WHERE m.id=$1 FOR UPDATE OF m,t', [matchupId])).rows[0];
    if (!matchup || matchup.group_id !== session.group_id || matchup.status !== 'open' || matchup.tournament_status !== 'active') throw new HttpError(404, 'Open matchup not found.', 'matchup_not_found');
    if (matchup.created_by !== session.spotify_user_id && !session.is_owner) throw new HttpError(403, 'Only the tournament creator or group owner can close it.', 'manager_required');
    const counts = (await client.query(`SELECT count(*)::int total,count(*) FILTER (WHERE winner_track_id=$2)::int left_votes,count(*) FILTER (WHERE winner_track_id=$3)::int right_votes FROM tournament_votes WHERE matchup_id=$1`, [matchupId, matchup.left_track_id, matchup.right_track_id])).rows[0];
    const electorate = (await client.query('SELECT count(*)::int count FROM tournament_members WHERE tournament_id=$1', [matchup.tournament_id])).rows[0].count;
    if (counts.total < Math.min(2, electorate)) throw new HttpError(409, 'Wait for at least two votes before closing this matchup.', 'not_enough_votes');
    let winnerId = counts.left_votes > counts.right_votes ? matchup.left_track_id : counts.right_votes > counts.left_votes ? matchup.right_track_id : tieWinnerId;
    if (![matchup.left_track_id, matchup.right_track_id].includes(winnerId)) throw new HttpError(409, 'Choose a tie-break winner.', 'tie_break_required');
    await advance(client, { id: matchup.tournament_id, size: matchup.size }, matchup, winnerId);
    return { winnerId };
  });
}

module.exports = { advance, close, detail, requireTournament, vote };
