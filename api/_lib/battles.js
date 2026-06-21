const crypto = require('node:crypto');
const { getPool, transaction } = require('./db');
const { getAccessToken } = require('./spotify');
const { randomSearch } = require('./discovery');
const { HttpError } = require('./errors');
const tracks = require('./tracks');
const { applyRating } = require('./ratings');

async function randomTrack(userId, genre, decade, excluded) {
  const token = await getAccessToken(userId);
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const search = randomSearch(genre, decade);
    const params = new URLSearchParams({ q: search.query, type: 'track', limit: '10', offset: String(search.offset) });
    const response = await fetch(`https://api.spotify.com/v1/search?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) continue;
    const payload = await response.json();
    const candidates = payload.tracks.items.filter((track) => track && !track.is_local && !excluded.has(track.id));
    if (candidates.length) return tracks.fromSpotify(candidates[Math.floor(Math.random() * candidates.length)]);
  }
  throw new HttpError(503, 'Spotify could not find a fresh song for these filters. Try again.', 'discovery_failed');
}

async function curatedTrack(groupId, type, playlistId, excluded, hardExcluded = new Set()) {
  let source;
  const params = [groupId, [...excluded]];
  if (type === 'nominations') {
    source = 'JOIN nominations n ON n.track_id=t.spotify_id AND n.group_id=$1';
  } else if (type === 'playlist' && playlistId) {
    params.push(playlistId);
    source = 'JOIN imported_playlist_tracks ipt ON ipt.track_id=t.spotify_id JOIN imported_playlists ip ON ip.id=ipt.playlist_id AND ip.group_id=$1 AND ip.id=$3';
  } else if (type === 'playlist') {
    return null;
  } else {
    throw new HttpError(400, 'Choose nominations or an imported playlist.', 'invalid_curated_source');
  }
  const result = await getPool().query(`SELECT t.*,COALESCE(seen.appearances,0) AS appearances FROM tracks t ${source}
    LEFT JOIN (SELECT id,count(*) appearances FROM (SELECT left_track_id id FROM battles WHERE group_id=$1 UNION ALL SELECT right_track_id FROM battles WHERE group_id=$1) x GROUP BY id) seen ON seen.id=t.spotify_id
    WHERE NOT (t.spotify_id=ANY($2::text[])) ORDER BY COALESCE(seen.appearances,0),random() LIMIT 1`, params);
  if (result.rows[0]) return tracks.fromRow(result.rows[0]);
  if (excluded.size > hardExcluded.size) return curatedTrack(groupId, type, playlistId, hardExcluded, hardExcluded);
  return null;
}

async function chooseTrack(session, sourceMode, curatedSourceType, playlistId, genre, decade, excluded, hardExcluded = new Set()) {
  if (sourceMode === 'curated') {
    const track = await curatedTrack(session.group_id, curatedSourceType, playlistId, excluded, hardExcluded);
    if (!track) throw new HttpError(409, 'This curated source needs at least two available songs.', 'curated_source_too_small');
    return track;
  }
  if (sourceMode === 'mixed' && Math.random() < 0.5) {
    const track = await curatedTrack(session.group_id, curatedSourceType, playlistId, excluded, hardExcluded);
    if (track) return track;
  }
  return randomTrack(session.spotify_user_id, genre, decade, excluded);
}

async function issueBattle(session, genre, decade, previousBattleId, options = {}) {
  const sourceMode = options.sourceMode || 'random';
  const curatedSourceType = options.curatedSourceType || null;
  const playlistId = options.playlistId || null;
  if (!['random', 'curated', 'mixed'].includes(sourceMode)) throw new HttpError(400, 'Invalid battle source.', 'invalid_source_mode');
  const limit = await getPool().query("SELECT count(*)::int AS count FROM battles WHERE voter_user_id=$1 AND created_at > now()-interval '1 hour'", [session.spotify_user_id]);
  if (limit.rows[0].count >= 120) throw new HttpError(429, 'Battle limit reached. Try again later.', 'rate_limited');
  const recent = await getPool().query(`SELECT unnest(ARRAY[left_track_id,right_track_id]) AS id FROM
    (SELECT left_track_id,right_track_id FROM battles WHERE voter_user_id=$1 ORDER BY created_at DESC LIMIT 50) recent`, [session.spotify_user_id]);
  const excluded = new Set(recent.rows.map((row) => row.id));
  let left;
  if (previousBattleId) {
    const previous = await getPool().query(`SELECT b.*,t.* FROM battles b JOIN tracks t ON t.spotify_id=b.winner_track_id
      WHERE b.id=$1 AND b.group_id=$2 AND b.voter_user_id=$3 AND b.status='voted'`, [previousBattleId, session.group_id, session.spotify_user_id]);
    const row = previous.rows[0];
    if (!row) throw new HttpError(409, 'The previous battle has no valid winner.', 'invalid_previous_battle');
    if (row.genre !== genre || row.decade !== decade || row.source_mode !== sourceMode || (row.curated_source_type || null) !== curatedSourceType || String(row.curated_playlist_id || '') !== String(playlistId || '')) throw new HttpError(409, 'Restart the battle when changing its setup.', 'filters_changed');
    left = tracks.fromRow(row);
    excluded.delete(left.id);
  } else {
    left = await chooseTrack(session, sourceMode, curatedSourceType, playlistId, genre, decade, excluded);
  }
  excluded.add(left.id);
  const right = await chooseTrack(session, sourceMode, curatedSourceType, playlistId, genre, decade, excluded, new Set([left.id]));
  const id = crypto.randomUUID();
  await transaction(async (client) => {
    await tracks.upsert(client, left, session.group_id);
    await tracks.upsert(client, right, session.group_id);
    await client.query(`INSERT INTO battles (id,group_id,voter_user_id,left_track_id,right_track_id,genre,decade,source_mode,curated_source_type,curated_playlist_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, session.group_id, session.spotify_user_id, left.id, right.id, genre, decade, sourceMode, curatedSourceType, playlistId]);
  });
  return { id, genre, decade, sourceMode, curatedSourceType, playlistId, left, right };
}

async function vote(session, battleId, winnerId) {
  const limit = await getPool().query("SELECT count(*)::int AS count FROM votes WHERE voter_user_id=$1 AND created_at > now()-interval '1 hour'", [session.spotify_user_id]);
  if (limit.rows[0].count >= 120) throw new HttpError(429, 'Vote limit reached. Try again later.', 'rate_limited');
  return transaction(async (client) => {
    const battle = (await client.query('SELECT * FROM battles WHERE id=$1 FOR UPDATE', [battleId])).rows[0];
    if (!battle || battle.group_id !== session.group_id || battle.voter_user_id !== session.spotify_user_id) throw new HttpError(404, 'Battle not found.', 'battle_not_found');
    if (battle.status !== 'issued') throw new HttpError(409, 'This battle was already voted on.', 'duplicate_vote');
    if (![battle.left_track_id, battle.right_track_id].includes(winnerId)) throw new HttpError(400, 'Winner must be one of the battle tracks.', 'invalid_winner');
    const loserId = winnerId === battle.left_track_id ? battle.right_track_id : battle.left_track_id;
    const result = await applyRating(client, session.group_id, winnerId, loserId);
    await client.query("UPDATE battles SET status='voted',winner_track_id=$1,voted_at=now() WHERE id=$2", [winnerId, battleId]);
    await client.query(`INSERT INTO votes (id,battle_id,group_id,voter_user_id,winner_track_id,loser_track_id,winner_rating_before,winner_rating_after,loser_rating_before,loser_rating_after)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [crypto.randomUUID(), battleId, session.group_id, session.spotify_user_id, winnerId, loserId, result.winnerBefore, result.winnerAfter, result.loserBefore, result.loserAfter]);
    return { winnerId, loserId, change: result.change, winnerRating: result.winnerAfter, loserRating: result.loserAfter };
  });
}

module.exports = { issueBattle, randomTrack, vote };
