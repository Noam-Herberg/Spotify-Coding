const crypto = require('node:crypto');
const { getSession } = require('./_lib/auth');
const { getPool, transaction } = require('./_lib/db');
const { HttpError } = require('./_lib/errors');
const { cookie, cookies, json, validateOrigin } = require('./_lib/http');
const { bracketPlan, guestToken, hashGuestToken, publicPlayer, roomCode, shuffle } = require('./_lib/party');
const { randomSearch } = require('./_lib/discovery');
const { spotifyFetch } = require('./_lib/spotify');
const tracks = require('./_lib/tracks');

const uuid = () => crypto.randomUUID();
const writeActions = new Set(['create','settings','begin','assemble','active','start','played','open-voting','tie-break','advance','replace','replay','end','join','pick','unpick','ready','vote']);

function body(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  try { return JSON.parse(request.body || '{}'); } catch { throw new HttpError(400, 'Invalid JSON body.', 'invalid_body'); }
}

function cleanCode(value) { return String(value || '').trim().toUpperCase(); }
function cleanName(value) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 30); }

async function rateLimit(key, maximum) {
  const result = await getPool().query(`INSERT INTO party_rate_limits(key) VALUES($1)
    ON CONFLICT(key) DO UPDATE SET
      request_count=CASE WHEN party_rate_limits.window_started < now()-interval '1 minute' THEN 1 ELSE party_rate_limits.request_count+1 END,
      window_started=CASE WHEN party_rate_limits.window_started < now()-interval '1 minute' THEN now() ELSE party_rate_limits.window_started END
    RETURNING request_count`, [key]);
  if (result.rows[0].request_count > maximum) throw new HttpError(429, 'Too many requests. Wait a minute and try again.', 'rate_limited');
}

async function hostRoom(request, { lock = false, allowEnded = false } = {}) {
  const session = await getSession(request);
  const query = `SELECT * FROM party_rooms WHERE host_user_id=$1 ${allowEnded ? '' : "AND phase<>'ended' AND expires_at>now()"} ORDER BY created_at DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`;
  const room = (await getPool().query(query, [session.spotify_user_id])).rows[0];
  if (!room) throw new HttpError(404, 'No active hosted room.', 'room_not_found');
  return { session, room };
}

async function guest(request, roomCodeValue) {
  const token = cookies(request).party_player;
  if (!token) throw new HttpError(401, 'Join this room first.', 'player_session_required');
  const params = [hashGuestToken(token)];
  let filter = '';
  if (roomCodeValue) { params.push(cleanCode(roomCodeValue)); filter = 'AND r.code=$2'; }
  const player = (await getPool().query(`SELECT p.*,r.code,r.phase,r.host_user_id,r.expires_at FROM party_players p JOIN party_rooms r ON r.id=p.room_id WHERE p.token_hash=$1 ${filter} AND r.expires_at>now()`, params)).rows[0];
  if (!player) throw new HttpError(401, 'Your player session expired. Join again.', 'player_session_expired');
  return player;
}

function trackFromJoined(row, prefix = '') {
  if (!row[`${prefix}spotify_id`]) return null;
  return tracks.fromRow(row, prefix);
}

async function fetchState(roomId, role, playerId = null) {
  const room = (await getPool().query('SELECT * FROM party_rooms WHERE id=$1', [roomId])).rows[0];
  if (!room) throw new HttpError(404, 'Room not found.', 'room_not_found');
  const playerRows = (await getPool().query(`SELECT p.id,p.display_name,p.active,p.ready,p.overall_score,p.last_seen_at,count(s.id)::int AS pick_count
    FROM party_players p LEFT JOIN party_songs s ON s.owner_player_id=p.id AND s.source='pick'
    WHERE p.room_id=$1 GROUP BY p.id ORDER BY p.joined_at`, [roomId])).rows;
  const revealOwners = room.phase === 'results' || room.phase === 'ended';
  const matches = (await getPool().query(`SELECT m.*,
    ta.spotify_id a_spotify_id,ta.uri a_uri,ta.name a_name,ta.artist a_artist,ta.album a_album,ta.image_url a_image_url,ta.spotify_url a_spotify_url,
    tb.spotify_id b_spotify_id,tb.uri b_uri,tb.name b_name,tb.artist b_artist,tb.album b_album,tb.image_url b_image_url,tb.spotify_url b_spotify_url,
    sa.owner_player_id a_owner,sb.owner_player_id b_owner,pa.display_name a_owner_name,pb.display_name b_owner_name
    FROM party_matchups m
    LEFT JOIN party_songs sa ON sa.id=m.song_a_id LEFT JOIN tracks ta ON ta.spotify_id=sa.track_id
    LEFT JOIN party_songs sb ON sb.id=m.song_b_id LEFT JOIN tracks tb ON tb.spotify_id=sb.track_id
    LEFT JOIN party_players pa ON pa.id=sa.owner_player_id LEFT JOIN party_players pb ON pb.id=sb.owner_player_id
    WHERE m.room_id=$1 ORDER BY m.round,m.position`, [roomId])).rows;
  const current = matches.find((match) => match.id === room.current_matchup_id) || null;
  const voteProgress = current ? (await getPool().query(`SELECT
    count(*) FILTER (WHERE active)::int AS eligible,
    count(v.id) FILTER (WHERE p.active)::int AS voted
    FROM party_players p LEFT JOIN party_votes v ON v.player_id=p.id AND v.matchup_id=$1 AND v.attempt=$2
    WHERE p.room_id=$3`, [current.id, current.vote_attempt, roomId])).rows[0] : { eligible: 0, voted: 0 };
  const visiblePlayers = playerRows.map(publicPlayer);
  const result = {
    room: { code: room.code, phase: room.phase, maxBracketSize: room.max_bracket_size, bracketSize: room.bracket_size, roundsPlayed: room.rounds_played, version: Number(room.version), expiresAt: room.expires_at },
    players: visiblePlayers,
    currentMatchup: current ? {
      id: current.id, round: current.round, position: current.position, status: current.status, attempt: current.vote_attempt,
      playedA: current.played_a, playedB: current.played_b,
      songA: current.song_a_id ? { ...trackFromJoined(current, 'a_'), roomSongId: current.song_a_id } : null,
      songB: current.song_b_id ? { ...trackFromJoined(current, 'b_'), roomSongId: current.song_b_id } : null,
      winnerId: current.status === 'complete' ? current.winner_song_id : null,
      votes: { voted: voteProgress.voted, eligible: voteProgress.eligible }
    } : null
  };
  if (role === 'player') {
    const own = await getPool().query(`SELECT s.id AS room_song_id,t.* FROM party_songs s JOIN tracks t ON t.spotify_id=s.track_id WHERE s.owner_player_id=$1 AND s.room_id=$2 ORDER BY s.created_at`, [playerId, roomId]);
    result.you = visiblePlayers.find((p) => p.id === playerId);
    result.picks = own.rows.map((row) => ({ roomSongId: row.room_song_id, ...tracks.fromRow(row) }));
    if (current && ['voting','revote'].includes(current.status)) {
      const voted = await getPool().query('SELECT song_id FROM party_votes WHERE matchup_id=$1 AND attempt=$2 AND player_id=$3', [current.id, current.vote_attempt, playerId]);
      result.yourVote = voted.rows[0]?.song_id || null;
    }
  }
  if (revealOwners) {
    result.bracket = matches.map((m) => ({ id: m.id, round: m.round, position: m.position,
      songA: m.song_a_id ? { ...trackFromJoined(m, 'a_'), roomSongId: m.song_a_id } : null,
      songB: m.song_b_id ? { ...trackFromJoined(m, 'b_'), roomSongId: m.song_b_id } : null,
      winnerId: m.winner_song_id, ownerA: m.a_owner_name || null, ownerB: m.b_owner_name || null }));
    const scores = await getPool().query(`SELECT p.id,p.display_name,count(m.id)::int AS score FROM party_players p
      LEFT JOIN party_songs s ON s.owner_player_id=p.id LEFT JOIN party_matchups m ON m.winner_song_id=s.id AND m.room_id=p.room_id
      WHERE p.room_id=$1 GROUP BY p.id ORDER BY score DESC,p.display_name`, [roomId]);
    result.curators = scores.rows.map((r) => ({ id: r.id, displayName: r.display_name, score: r.score }));
    result.overallCurators = [...visiblePlayers]
      .sort((a, b) => b.overallScore - a.overallScore || a.displayName.localeCompare(b.displayName))
      .map((player) => ({ id: player.id, displayName: player.displayName, score: player.overallScore }));
  }
  return result;
}

async function randomTracks(hostId, count, excluded = new Set()) {
  const found = [];
  for (let attempt = 0; attempt < 24 && found.length < count; attempt += 1) {
    const { query, offset } = randomSearch('all', 'all');
    const payload = await spotifyFetch(hostId, `/search?type=track&limit=10&offset=${offset}&q=${encodeURIComponent(query)}`);
    for (const item of payload.tracks?.items || []) {
      if (!item?.id || item.is_local || item.is_playable === false || excluded.has(item.id)) continue;
      excluded.add(item.id); found.push(tracks.fromSpotify(item));
      if (found.length === count) break;
    }
  }
  if (found.length < count) throw new HttpError(502, 'Spotify could not find enough unique playable tracks. Try again.', 'random_tracks_unavailable');
  return found;
}

async function createRoom(request, response) {
  const session = await getSession(request);
  const profile = await spotifyFetch(session.spotify_user_id, '/me');
  if (profile.product !== 'premium') throw new HttpError(403, 'Hosting full-track playback requires Spotify Premium.', 'premium_required');
  const existing = (await getPool().query("SELECT * FROM party_rooms WHERE host_user_id=$1 AND phase<>'ended' AND expires_at>now() ORDER BY created_at DESC LIMIT 1", [session.spotify_user_id])).rows[0];
  if (existing) return json(response, 200, await fetchState(existing.id, 'host'));
  const created = await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`party-host:${session.spotify_user_id}`]);
    const concurrent = (await client.query("SELECT * FROM party_rooms WHERE host_user_id=$1 AND phase<>'ended' AND expires_at>now() ORDER BY created_at DESC LIMIT 1", [session.spotify_user_id])).rows[0];
    if (concurrent) return concurrent;
    return (await client.query('INSERT INTO party_rooms(id,code,host_user_id) VALUES($1,$2,$3) RETURNING *', [uuid(), roomCode(), session.spotify_user_id])).rows[0];
  });
  json(response, 201, await fetchState(created.id, 'host'));
}

async function assemble(request, response) {
  const { session, room } = await hostRoom(request);
  const players = (await getPool().query('SELECT * FROM party_players WHERE room_id=$1 AND active ORDER BY joined_at', [room.id])).rows;
  let plan;
  try { plan = bracketPlan(players.length, room.max_bracket_size); } catch (error) { throw new HttpError(409, error.message, 'bracket_capacity'); }
  const picks = (await getPool().query("SELECT s.* FROM party_songs s JOIN party_players p ON p.id=s.owner_player_id WHERE s.room_id=$1 AND s.source='pick' AND p.active", [room.id])).rows;
  const missing = players.reduce((total, player) => total + Math.max(0, 2 - picks.filter((song) => song.owner_player_id === player.id).length), 0);
  const excluded = new Set(picks.map((song) => song.track_id));
  const generated = await randomTracks(session.spotify_user_id, plan.randomCount + missing, excluded);
  await transaction(async (client) => {
    const locked = (await client.query('SELECT * FROM party_rooms WHERE id=$1 FOR UPDATE', [room.id])).rows[0];
    if (!['lobby','picking'].includes(locked.phase)) throw new HttpError(409, 'The bracket has already started.', 'invalid_room_phase');
    await client.query("DELETE FROM party_songs s USING party_players p WHERE s.owner_player_id=p.id AND s.room_id=$1 AND NOT p.active", [room.id]);
    await client.query("DELETE FROM party_songs WHERE room_id=$1 AND source<>'pick'", [room.id]);
    let cursor = 0;
    for (const player of players) {
      const count = picks.filter((song) => song.owner_player_id === player.id).length;
      for (let index = count; index < 2; index += 1) {
        const track = generated[cursor++]; await tracks.upsert(client, track, null, false);
        await client.query('INSERT INTO party_songs(id,room_id,track_id,owner_player_id,source) VALUES($1,$2,$3,$4,$5)', [uuid(), room.id, track.id, player.id, 'missing_fill']);
      }
    }
    while (cursor < generated.length) {
      const track = generated[cursor++]; await tracks.upsert(client, track, null, false);
      await client.query('INSERT INTO party_songs(id,room_id,track_id,source) VALUES($1,$2,$3,$4)', [uuid(), room.id, track.id, 'surprise']);
    }
    const songs = shuffle((await client.query('SELECT id FROM party_songs WHERE room_id=$1', [room.id])).rows);
    if (songs.length !== plan.bracketSize) throw new HttpError(409, 'Song picks changed while the bracket was being built. Try again.', 'picks_changed');
    for (let i = 0; i < songs.length; i += 1) await client.query('UPDATE party_songs SET seed=$1 WHERE id=$2', [i + 1, songs[i].id]);
    await client.query('DELETE FROM party_matchups WHERE room_id=$1', [room.id]);
    const rounds = Math.log2(plan.bracketSize);
    const ids = [];
    for (let round = 1; round <= rounds; round += 1) {
      ids[round] = [];
      for (let position = 0; position < plan.bracketSize / (2 ** round); position += 1) {
        const id = uuid(); ids[round][position] = id;
        const a = round === 1 ? songs[position * 2].id : null;
        const b = round === 1 ? songs[position * 2 + 1].id : null;
        await client.query('INSERT INTO party_matchups(id,room_id,round,position,song_a_id,song_b_id,status) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, room.id, round, position, a, b, round === 1 ? 'ready' : 'pending']);
      }
    }
    await client.query("UPDATE party_rooms SET phase='reveal',bracket_size=$2,random_count=$3,current_matchup_id=$4,version=version+1,updated_at=now(),expires_at=now()+interval '24 hours' WHERE id=$1", [room.id, plan.bracketSize, plan.randomCount, ids[1][0]]);
  });
  json(response, 200, await fetchState(room.id, 'host'));
}

async function completeMatch(client, room, match, winnerId) {
  if (![match.song_a_id, match.song_b_id].includes(winnerId)) throw new HttpError(400, 'Choose one of the matchup songs.', 'invalid_winner');
  await client.query("UPDATE party_matchups SET winner_song_id=$1,status='complete',completed_at=now() WHERE id=$2", [winnerId, match.id]);
  const maxRound = Math.log2(room.bracket_size);
  if (match.round === maxRound) {
    await client.query(`UPDATE party_players p SET overall_score=p.overall_score+scores.score
      FROM (SELECT s.owner_player_id,count(m.id)::int AS score
        FROM party_matchups m JOIN party_songs s ON s.id=m.winner_song_id
        WHERE m.room_id=$1 AND s.owner_player_id IS NOT NULL GROUP BY s.owner_player_id) scores
      WHERE p.id=scores.owner_player_id`, [room.id]);
    await client.query("UPDATE party_rooms SET phase='results',rounds_played=rounds_played+1,version=version+1,updated_at=now(),expires_at=now()+interval '24 hours' WHERE id=$1", [room.id]);
    return;
  }
  const nextRound = match.round + 1, nextPosition = Math.floor(match.position / 2);
  const column = match.position % 2 === 0 ? 'song_a_id' : 'song_b_id';
  const next = (await client.query(`UPDATE party_matchups SET ${column}=$1 WHERE room_id=$2 AND round=$3 AND position=$4 RETURNING *`, [winnerId, room.id, nextRound, nextPosition])).rows[0];
  if (next.song_a_id && next.song_b_id) await client.query("UPDATE party_matchups SET status='ready' WHERE id=$1", [next.id]);
  await client.query('UPDATE party_rooms SET version=version+1,updated_at=now() WHERE id=$1', [room.id]);
}

async function resolveVotesIfComplete(client, room, match) {
  if (!['voting','revote'].includes(match?.status)) return false;
  const counts = (await client.query(`SELECT count(*) FILTER (WHERE p.active)::int eligible,count(v.id) FILTER (WHERE p.active)::int voted
    FROM party_players p LEFT JOIN party_votes v ON v.player_id=p.id AND v.matchup_id=$1 AND v.attempt=$2 WHERE p.room_id=$3`, [match.id, match.vote_attempt, room.id])).rows[0];
  if (!counts.eligible || counts.voted !== counts.eligible) return false;
  const totals = (await client.query('SELECT song_id,count(*)::int total FROM party_votes WHERE matchup_id=$1 AND attempt=$2 GROUP BY song_id ORDER BY total DESC', [match.id, match.vote_attempt])).rows;
  const tied = totals.length > 1 && totals[0].total === totals[1].total;
  if (tied && match.vote_attempt === 1) await client.query("UPDATE party_matchups SET vote_attempt=2,status='revote' WHERE id=$1", [match.id]);
  else if (tied) await client.query("UPDATE party_matchups SET status='host_tiebreak' WHERE id=$1", [match.id]);
  else await completeMatch(client, room, match, totals[0].song_id);
  return true;
}

async function vote(request, response) {
  const player = await guest(request, body(request).code);
  if (!player.active) throw new HttpError(403, 'The Host marked you absent from this game.', 'player_inactive');
  await rateLimit(`vote:${player.id}`, 10);
  const selected = String(body(request).songId || '');
  await transaction(async (client) => {
    const room = (await client.query('SELECT * FROM party_rooms WHERE id=$1 FOR UPDATE', [player.room_id])).rows[0];
    const match = (await client.query('SELECT * FROM party_matchups WHERE id=$1 FOR UPDATE', [room.current_matchup_id])).rows[0];
    if (!['voting','revote'].includes(match?.status)) throw new HttpError(409, 'Voting is not open.', 'voting_closed');
    if (![match.song_a_id, match.song_b_id].includes(selected)) throw new HttpError(400, 'Choose one of the matchup songs.', 'invalid_vote');
    await client.query('INSERT INTO party_votes(id,room_id,matchup_id,attempt,player_id,song_id) VALUES($1,$2,$3,$4,$5,$6)', [uuid(), room.id, match.id, match.vote_attempt, player.id, selected]);
    await resolveVotesIfComplete(client, room, match);
    await client.query('UPDATE party_rooms SET version=version+1,updated_at=now() WHERE id=$1', [room.id]);
  }).catch((error) => { if (error.code === '23505') throw new HttpError(409, 'You already voted in this round.', 'duplicate_vote'); throw error; });
  json(response, 200, await fetchState(player.room_id, 'player', player.id));
}

async function route(request, response) {
  const action = String(request.query.action || '');
  if (writeActions.has(action)) validateOrigin(request);
  if (action === 'create' && request.method === 'POST') return createRoom(request, response);
  if (action === 'host-state' && request.method === 'GET') { const { room } = await hostRoom(request); const since = Number(request.query.since || 0); if (since === Number(room.version)) return response.status(204).end(); return json(response, 200, await fetchState(room.id, 'host')); }
  if (action === 'player-state' && request.method === 'GET') { const p = await guest(request, request.query.code); await getPool().query('UPDATE party_players SET last_seen_at=now() WHERE id=$1', [p.id]); const state = await fetchState(p.room_id, 'player', p.id); if (Number(request.query.since || 0) === state.room.version) return response.status(204).end(); return json(response, 200, state); }
  if (action === 'join' && request.method === 'POST') {
    const input = body(request), code = cleanCode(input.code), name = cleanName(input.displayName);
    await rateLimit(`join:${request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown'}`, 20);
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code) || !name) throw new HttpError(400, 'Enter a valid room code and display name.', 'invalid_join');
    const token = guestToken();
    let player;
    try { player = await transaction(async (client) => {
      const room = (await client.query("SELECT * FROM party_rooms WHERE code=$1 AND phase IN ('lobby','picking') AND expires_at>now() FOR UPDATE", [code])).rows[0];
      if (!room) throw new HttpError(404, 'That room is unavailable.', 'room_not_found');
      const count = Number((await client.query('SELECT count(*) FROM party_players WHERE room_id=$1 AND active', [room.id])).rows[0].count);
      const limit = room.max_bracket_size / 2 - 1;
      if (count >= limit) throw new HttpError(409, 'This room has reached its player limit.', 'room_full');
      const row = (await client.query('INSERT INTO party_players(id,room_id,display_name,token_hash) VALUES($1,$2,$3,$4) RETURNING *', [uuid(), room.id, name, hashGuestToken(token)])).rows[0];
      await client.query('UPDATE party_rooms SET version=version+1,updated_at=now() WHERE id=$1', [room.id]); return row;
    }); } catch (error) { if (error.code === '23505') throw new HttpError(409, 'That display name is already in use.', 'duplicate_name'); throw error; }
    response.setHeader('Set-Cookie', cookie('party_player', token, { maxAge: 86400 })); return json(response, 201, await fetchState(player.room_id, 'player', player.id));
  }
  if (action === 'search' && request.method === 'GET') {
    const p = await guest(request, request.query.code); const query = String(request.query.q || '').trim().slice(0, 100);
    await rateLimit(`search:${p.id}`, 30);
    if (query.length < 2) throw new HttpError(400, 'Search for at least two characters.', 'invalid_search');
    const result = await spotifyFetch(p.host_user_id, `/search?type=track&limit=10&q=${encodeURIComponent(query)}`);
    return json(response, 200, { tracks: (result.tracks?.items || []).filter((t) => t.id && !t.is_local && t.is_playable !== false).map(tracks.fromSpotify) });
  }
  if (action === 'pick' && request.method === 'POST') {
    const input = body(request), p = await guest(request, input.code), track = input.track;
    if (!track?.id || !track?.uri || !track?.name) throw new HttpError(400, 'Invalid Spotify track.', 'invalid_track');
    try { await transaction(async (client) => {
      const room = (await client.query('SELECT * FROM party_rooms WHERE id=$1 FOR UPDATE', [p.room_id])).rows[0];
      if (!['lobby','picking'].includes(room.phase)) throw new HttpError(409, 'Song picking is closed.', 'picking_closed');
      const count = Number((await client.query('SELECT count(*) FROM party_songs WHERE owner_player_id=$1', [p.id])).rows[0].count);
      if (count >= 2) throw new HttpError(409, 'You already selected two songs.', 'pick_limit');
      await tracks.upsert(client, track, null, false);
      await client.query("INSERT INTO party_songs(id,room_id,track_id,owner_player_id,source) VALUES($1,$2,$3,$4,'pick')", [uuid(), room.id, track.id, p.id]);
      await client.query('UPDATE party_players SET ready=false WHERE id=$1', [p.id]);
      await client.query("UPDATE party_rooms SET phase='picking',version=version+1,updated_at=now() WHERE id=$1", [room.id]);
    }); } catch (error) { if (error.code === '23505') throw new HttpError(409, 'That song is already in this room.', 'duplicate_track'); throw error; }
    return json(response, 200, await fetchState(p.room_id, 'player', p.id));
  }
  if (action === 'unpick' && request.method === 'POST') {
    const input = body(request), p = await guest(request, input.code);
    await transaction(async (client) => { const room = (await client.query('SELECT * FROM party_rooms WHERE id=$1 FOR UPDATE', [p.room_id])).rows[0]; if (!['lobby','picking'].includes(room.phase)) throw new HttpError(409, 'Song picking is closed.', 'picking_closed'); await client.query("DELETE FROM party_songs WHERE id=$1 AND owner_player_id=$2 AND source='pick'", [input.roomSongId, p.id]); await client.query('UPDATE party_players SET ready=false WHERE id=$1', [p.id]); await client.query('UPDATE party_rooms SET version=version+1 WHERE id=$1', [room.id]); });
    return json(response, 200, await fetchState(p.room_id, 'player', p.id));
  }
  if (action === 'ready' && request.method === 'POST') {
    const input = body(request), p = await guest(request, input.code); const ready = Boolean(input.ready);
    if (ready) { const count = Number((await getPool().query('SELECT count(*) FROM party_songs WHERE owner_player_id=$1', [p.id])).rows[0].count); if (count !== 2) throw new HttpError(409, 'Select two songs before marking ready.', 'picks_incomplete'); }
    await getPool().query('UPDATE party_players SET ready=$1 WHERE id=$2', [ready, p.id]); await getPool().query('UPDATE party_rooms SET version=version+1 WHERE id=$1', [p.room_id]); return json(response, 200, await fetchState(p.room_id, 'player', p.id));
  }
  if (action === 'settings' && request.method === 'POST') { const { room } = await hostRoom(request); const cap = Number(body(request).maxBracketSize); if (![16,32].includes(cap)) throw new HttpError(400, 'Choose a 16 or 32-song bracket.', 'invalid_cap'); const players = Number((await getPool().query('SELECT count(*) FROM party_players WHERE room_id=$1 AND active', [room.id])).rows[0].count); if (players > cap / 2 - 1) throw new HttpError(409, 'Too many players for that bracket size.', 'room_full'); await getPool().query('UPDATE party_rooms SET max_bracket_size=$1,version=version+1 WHERE id=$2', [cap, room.id]); return json(response, 200, await fetchState(room.id, 'host')); }
  if (action === 'begin' && request.method === 'POST') { const { room } = await hostRoom(request); await getPool().query("UPDATE party_rooms SET phase='picking',version=version+1 WHERE id=$1 AND phase='lobby'", [room.id]); return json(response, 200, await fetchState(room.id, 'host')); }
  if (action === 'assemble' && request.method === 'POST') return assemble(request, response);
  if (action === 'active' && request.method === 'POST') { const { room } = await hostRoom(request); const input = body(request); await transaction(async (client) => { const lockedRoom = (await client.query('SELECT * FROM party_rooms WHERE id=$1 FOR UPDATE', [room.id])).rows[0]; if (input.active) { const count = Number((await client.query('SELECT count(*) FROM party_players WHERE room_id=$1 AND active', [room.id])).rows[0].count); if (count >= lockedRoom.max_bracket_size / 2 - 1) throw new HttpError(409, 'The selected bracket has no room for another active player.', 'room_full'); } await client.query('UPDATE party_players SET active=$1 WHERE id=$2 AND room_id=$3', [Boolean(input.active), input.playerId, room.id]); const match = lockedRoom.current_matchup_id ? (await client.query('SELECT * FROM party_matchups WHERE id=$1 FOR UPDATE', [lockedRoom.current_matchup_id])).rows[0] : null; await resolveVotesIfComplete(client, lockedRoom, match); await client.query('UPDATE party_rooms SET version=version+1 WHERE id=$1', [room.id]); }); return json(response, 200, await fetchState(room.id, 'host')); }
  if (action === 'start' && request.method === 'POST') { const { room } = await hostRoom(request); const changed = await getPool().query("UPDATE party_rooms SET phase='playing',version=version+1 WHERE id=$1 AND phase='reveal' RETURNING id", [room.id]); if (!changed.rowCount) throw new HttpError(409, 'The bracket cannot be started now.', 'invalid_room_phase'); return json(response, 200, await fetchState(room.id, 'host')); }
  if (action === 'played' && request.method === 'POST') { const { room } = await hostRoom(request); const side = body(request).side; if (!['a','b'].includes(side)) throw new HttpError(400, 'Invalid song side.', 'invalid_side'); await getPool().query(`UPDATE party_matchups SET played_${side}=true,status='listening' WHERE id=$1 AND status IN ('ready','listening')`, [room.current_matchup_id]); await getPool().query("UPDATE party_rooms SET phase='playing',version=version+1 WHERE id=$1", [room.id]); return json(response, 200, await fetchState(room.id, 'host')); }
  if (action === 'open-voting' && request.method === 'POST') { const { room } = await hostRoom(request); const changed = await getPool().query("UPDATE party_matchups SET status='voting' WHERE id=$1 AND played_a AND played_b AND status='listening' RETURNING id", [room.current_matchup_id]); if (!changed.rowCount) throw new HttpError(409, 'Play both songs before opening voting.', 'songs_not_played'); await getPool().query('UPDATE party_rooms SET version=version+1 WHERE id=$1', [room.id]); return json(response, 200, await fetchState(room.id, 'host')); }
  if (action === 'vote' && request.method === 'POST') return vote(request, response);
  if (action === 'tie-break' && request.method === 'POST') { const { room } = await hostRoom(request); await transaction(async (client) => { const lockedRoom = (await client.query('SELECT * FROM party_rooms WHERE id=$1 FOR UPDATE', [room.id])).rows[0]; const match = (await client.query('SELECT * FROM party_matchups WHERE id=$1 FOR UPDATE', [lockedRoom.current_matchup_id])).rows[0]; if (match.status !== 'host_tiebreak') throw new HttpError(409, 'This matchup does not need a tie-break.', 'tie_break_unavailable'); await completeMatch(client, lockedRoom, match, body(request).songId); }); return json(response, 200, await fetchState(room.id, 'host')); }
  if (action === 'advance' && request.method === 'POST') { const { room } = await hostRoom(request); const current = (await getPool().query('SELECT * FROM party_matchups WHERE id=$1', [room.current_matchup_id])).rows[0]; if (current?.status !== 'complete') throw new HttpError(409, 'Finish the current matchup first.', 'matchup_incomplete'); const next = (await getPool().query("SELECT id FROM party_matchups WHERE room_id=$1 AND status='ready' ORDER BY round,position LIMIT 1", [room.id])).rows[0]; if (!next) throw new HttpError(409, 'The next matchup is not ready.', 'next_matchup_unavailable'); await getPool().query('UPDATE party_rooms SET current_matchup_id=$1,version=version+1 WHERE id=$2', [next.id, room.id]); return json(response, 200, await fetchState(room.id, 'host')); }
  if (action === 'replace' && request.method === 'POST') { const { session, room } = await hostRoom(request); const side = body(request).side; if (!['a','b'].includes(side)) throw new HttpError(400, 'Invalid song side.', 'invalid_side'); const match = (await getPool().query('SELECT * FROM party_matchups WHERE id=$1', [room.current_matchup_id])).rows[0]; if (!['ready','listening'].includes(match.status)) throw new HttpError(409, 'This track can no longer be replaced.', 'replacement_closed'); const songId = side === 'a' ? match.song_a_id : match.song_b_id; const excluded = new Set((await getPool().query('SELECT track_id FROM party_songs WHERE room_id=$1', [room.id])).rows.map((r) => r.track_id)); const [replacement] = await randomTracks(session.spotify_user_id, 1, excluded); await transaction(async (client) => { await tracks.upsert(client, replacement, null, false); await client.query("UPDATE party_songs SET track_id=$1,source='replacement' WHERE id=$2", [replacement.id, songId]); await client.query(`UPDATE party_matchups SET played_${side}=false,status='ready' WHERE id=$1`, [match.id]); await client.query('UPDATE party_rooms SET version=version+1 WHERE id=$1', [room.id]); }); return json(response, 200, await fetchState(room.id, 'host')); }
  if (action === 'replay' && request.method === 'POST') { const { room } = await hostRoom(request); await transaction(async (client) => { await client.query('DELETE FROM party_votes WHERE room_id=$1', [room.id]); await client.query('DELETE FROM party_matchups WHERE room_id=$1', [room.id]); await client.query('DELETE FROM party_songs WHERE room_id=$1', [room.id]); await client.query('UPDATE party_players SET ready=false,active=true WHERE room_id=$1', [room.id]); await client.query("UPDATE party_rooms SET phase='picking',bracket_size=null,random_count=null,current_matchup_id=null,version=version+1,expires_at=now()+interval '24 hours' WHERE id=$1", [room.id]); }); return json(response, 200, await fetchState(room.id, 'host')); }
  if (action === 'end' && request.method === 'POST') { const { room } = await hostRoom(request); await getPool().query("UPDATE party_rooms SET phase='ended',version=version+1 WHERE id=$1", [room.id]); return json(response, 200, { ended: true }); }
  throw new HttpError(404, 'Game endpoint not found.', 'not_found');
}

module.exports = async (request, response) => {
  try { await route(request, response); }
  catch (error) { console.error(error); json(response, error.status || 500, { error: error.code || 'server_error', message: error.status ? error.message : 'The server could not complete this request.' }); }
};
