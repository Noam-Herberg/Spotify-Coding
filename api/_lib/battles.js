const crypto = require('node:crypto');
const { getPool, transaction } = require('./db');
const { getAccessToken } = require('./spotify');
const { randomSearch } = require('./discovery');
const { calculateElo } = require('./elo');
const { HttpError } = require('./errors');

function trackFromSpotify(track) {
  return {
    id: track.id, uri: track.uri, name: track.name,
    artist: track.artists.map((artist) => artist.name).join(', '),
    album: track.album.name, image: track.album.images[0]?.url || '',
    url: track.external_urls.spotify
  };
}

function trackFromRow(row) {
  return { id: row.spotify_id, uri: row.uri, name: row.name, artist: row.artist, album: row.album, image: row.image_url, url: row.spotify_url };
}

async function randomTrack(userId, genre, decade, excluded) {
  const token = await getAccessToken(userId);
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const search = randomSearch(genre, decade);
    const params = new URLSearchParams({ q: search.query, type: 'track', limit: '10', offset: String(search.offset) });
    const response = await fetch(`https://api.spotify.com/v1/search?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) continue;
    const payload = await response.json();
    const candidates = payload.tracks.items.filter((track) => track && !track.is_local && !excluded.has(track.id));
    if (candidates.length) return trackFromSpotify(candidates[Math.floor(Math.random() * candidates.length)]);
  }
  throw new HttpError(503, 'Spotify could not find a fresh song for these filters. Try again.', 'discovery_failed');
}

async function upsertTrack(client, track, groupId) {
  await client.query(`INSERT INTO tracks (spotify_id,uri,name,artist,album,image_url,spotify_url) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (spotify_id) DO UPDATE SET uri=EXCLUDED.uri,name=EXCLUDED.name,artist=EXCLUDED.artist,album=EXCLUDED.album,
    image_url=EXCLUDED.image_url,spotify_url=EXCLUDED.spotify_url,updated_at=now()`,
    [track.id, track.uri, track.name, track.artist, track.album, track.image, track.url]);
  await client.query('INSERT INTO group_track_ratings (group_id,track_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [groupId, track.id]);
}

async function issueBattle(session, genre, decade, previousBattleId) {
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
    if (row.genre !== genre || row.decade !== decade) throw new HttpError(409, 'Restart the battle when changing filters.', 'filters_changed');
    left = trackFromRow(row);
    excluded.delete(left.id);
  } else {
    left = await randomTrack(session.spotify_user_id, genre, decade, excluded);
  }
  excluded.add(left.id);
  const right = await randomTrack(session.spotify_user_id, genre, decade, excluded);
  const id = crypto.randomUUID();
  await transaction(async (client) => {
    await upsertTrack(client, left, session.group_id);
    await upsertTrack(client, right, session.group_id);
    await client.query(`INSERT INTO battles (id,group_id,voter_user_id,left_track_id,right_track_id,genre,decade)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, session.group_id, session.spotify_user_id, left.id, right.id, genre, decade]);
  });
  return { id, genre, decade, left, right };
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
    const ratings = (await client.query(`SELECT * FROM group_track_ratings WHERE group_id=$1 AND track_id=ANY($2::text[]) ORDER BY track_id FOR UPDATE`, [session.group_id, [winnerId, loserId]])).rows;
    const winner = ratings.find((row) => row.track_id === winnerId);
    const loser = ratings.find((row) => row.track_id === loserId);
    const result = calculateElo(winner.rating, loser.rating);
    await client.query('UPDATE group_track_ratings SET rating=$1,wins=wins+1,updated_at=now() WHERE group_id=$2 AND track_id=$3', [result.winnerAfter, session.group_id, winnerId]);
    await client.query('UPDATE group_track_ratings SET rating=$1,losses=losses+1,updated_at=now() WHERE group_id=$2 AND track_id=$3', [result.loserAfter, session.group_id, loserId]);
    await client.query("UPDATE battles SET status='voted',winner_track_id=$1,voted_at=now() WHERE id=$2", [winnerId, battleId]);
    await client.query(`INSERT INTO votes (id,battle_id,group_id,voter_user_id,winner_track_id,loser_track_id,winner_rating_before,winner_rating_after,loser_rating_before,loser_rating_after)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [crypto.randomUUID(), battleId, session.group_id, session.spotify_user_id, winnerId, loserId, winner.rating, result.winnerAfter, loser.rating, result.loserAfter]);
    return { winnerId, loserId, change: result.change, winnerRating: result.winnerAfter, loserRating: result.loserAfter };
  });
}

module.exports = { issueBattle, vote };
