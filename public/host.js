import { $, $$, api, escapeHtml, formatTime, show, text } from './common.js';

let state = null, spotifyPlayer = null, deviceId = null, playerPromise = null, tokenCache = null, championTrack = null;
let position = 0, duration = 0, paused = true, updatedAt = Date.now(), seeking = false, polling = false;

async function checkAuth() {
  const response = await fetch('/api/me'); const me = await response.json();
  if (!me.authenticated) { show('#connect', true); text('#host-status', 'Connect the Spotify Premium account that will play the music.'); return; }
  text('#host-name', me.user.displayName); show('#connect', false); show('#create', true);
  await load(false).catch(() => {});
}

async function load(silent = true) {
  if (polling) return; polling = true;
  try { const next = await api('host-state', { params: { since: silent && state ? state.room.version : 0 } }); if (next) { state = next; render(); } }
  catch (error) { if (!silent) text('#host-status', error.message); }
  finally { polling = false; }
}

function activePhase(id) { $$('.phase').forEach((node) => { node.hidden = node.id !== id; }); }
function people(target) { $(target).innerHTML = state.players.map((p) => `<div class="person ${p.active ? '' : 'inactive'}"><span class="avatar">${escapeHtml(p.displayName[0])}</span><div><strong>${escapeHtml(p.displayName)}</strong><small>${p.pickCount}/2 picks ${p.ready ? '· Ready' : ''}</small></div><button class="ghost active-toggle" data-id="${p.id}" data-active="${p.active}">${p.active ? 'Mark absent' : 'Make active'}</button></div>`).join('') || '<p class="muted">Waiting for players to join…</p>'; $$('.active-toggle', $(target)).forEach((button) => button.onclick = () => mutate('active', { playerId: button.dataset.id, active: button.dataset.active !== 'true' })); }
function songCard(side, track) { const card = $(`.song-card[data-side="${side}"]`); $('img', card).src = track?.image || ''; $('h2', card).textContent = track?.name || ''; $('.artist', card).textContent = track?.artist || ''; $('a', card).href = track?.url || '#'; $('.play', card).disabled = !track; }

function render() {
  show('#host-intro', false); show('#board', true); show('#end', true); text('#code', state.room.code); text('#phase-pill', state.room.phase.toUpperCase()); text('#player-count', `${state.players.filter((p) => p.active).length} active players`);
  const phase = state.room.phase;
  if (phase === 'lobby') { activePhase('lobby'); people('#lobby-players'); $$('input[name="cap"]').forEach((radio) => { radio.checked = Number(radio.value) === state.room.maxBracketSize; }); }
  else if (phase === 'picking') { activePhase('picking'); people('#pick-players'); }
  else if (phase === 'reveal') { activePhase('reveal'); text('#bracket-size', state.room.bracketSize); }
  else if (phase === 'playing') { activePhase('match'); renderMatch(); }
  else if (phase === 'results' || phase === 'ended') { activePhase('results'); renderResults(); }
}

function renderMatch() {
  const m = state.currentMatchup; if (!m) return;
  songCard('a', m.songA); songCard('b', m.songB); text('#round-label', `Round ${m.round} · Match ${m.position + 1}`); text('#vote-progress', `${m.votes.voted}/${m.votes.eligible} voted`);
  $$('.song-card').forEach((card) => card.classList.toggle('winner', m.status === 'complete' && m.winnerId === (card.dataset.side === 'a' ? m.songA.roomSongId : m.songB.roomSongId)));
  $$('.song-card .play').forEach((button) => { const side = button.closest('.song-card').dataset.side; button.textContent = `${side === 'a' ? (m.playedA ? 'Replay' : 'Play A') : (m.playedB ? 'Replay' : 'Play B')}`; });
  show('#open-voting', ['ready','listening'].includes(m.status)); $('#open-voting').disabled = !(m.playedA && m.playedB);
  show('#advance', m.status === 'complete' && state.room.phase !== 'results');
  text('#match-message', m.status === 'voting' ? 'Voting is open on player phones.' : m.status === 'revote' ? 'It’s tied. Players are voting once more.' : m.status === 'host_tiebreak' ? 'Still tied. Choose the advancing song.' : m.status === 'complete' ? 'Winner locked in.' : 'Play both songs, then open voting.');
  $$('.song-card').forEach((card) => { let tie = $('.tie', card); if (tie) tie.remove(); if (m.status === 'host_tiebreak') { tie = document.createElement('button'); tie.className = 'tie'; tie.textContent = 'Advance this song'; tie.onclick = () => mutate('tie-break', { songId: card.dataset.side === 'a' ? m.songA.roomSongId : m.songB.roomSongId }); card.append(tie); } });
}

function renderResults() {
  const final = [...(state.bracket || [])].sort((a, b) => b.round - a.round)[0]; const winner = final?.winnerId === final?.songA?.roomSongId ? final.songA : final?.songB;
  championTrack = winner;
  if (winner) { $('#champion-cover').src = winner.image; text('#champion-name', winner.name); text('#champion-artist', winner.artist); }
  const best = state.curators?.[0]?.score; $('#curators').innerHTML = (state.curators || []).map((c) => `<li class="${c.score === best ? 'best' : ''}"><span>${escapeHtml(c.displayName)}</span><strong>${c.score} win${c.score === 1 ? '' : 's'}</strong></li>`).join('');
  const overallBest = state.overallCurators?.[0]?.score; text('#overall-title', `Overall · ${state.room.roundsPlayed} round${state.room.roundsPlayed === 1 ? '' : 's'}`); $('#overall-curators').innerHTML = (state.overallCurators || []).map((c) => `<li class="${c.score === overallBest ? 'best' : ''}"><span>${escapeHtml(c.displayName)}</span><strong>${c.score} win${c.score === 1 ? '' : 's'}</strong></li>`).join('');
  const rounds = Map.groupBy ? Map.groupBy(state.bracket || [], (m) => m.round) : (state.bracket || []).reduce((map, m) => map.set(m.round, [...(map.get(m.round) || []), m]), new Map());
  $('#bracket').innerHTML = [...rounds].map(([round, matches]) => `<div class="bracket-round"><h3>Round ${round}</h3>${matches.map((m) => `<div class="bracket-match"><span>${escapeHtml(m.songA?.name || 'TBD')} <small>${escapeHtml(m.ownerA || 'Surprise')}</small></span><span>${escapeHtml(m.songB?.name || 'TBD')} <small>${escapeHtml(m.ownerB || 'Surprise')}</small></span></div>`).join('')}</div>`).join('');
}

async function mutate(action, body = {}) { try { const next = await api(action, { method: 'POST', body }); if (next?.room) { state = next; render(); } } catch (error) { text('#host-status', error.message); text('#match-message', error.message); } }
async function playbackToken() { if (tokenCache && tokenCache.expires > Date.now()) return tokenCache.value; const response = await fetch('/api/auth/token'); const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Reconnect Spotify.'); tokenCache = { value: data.accessToken, expires: Date.now() + 240000 }; return data.accessToken; }
async function initialisePlayer() { if (spotifyPlayer) return spotifyPlayer; if (playerPromise) return playerPromise; playerPromise = new Promise((resolve, reject) => { window.onSpotifyWebPlaybackSDKReady = () => { spotifyPlayer = new Spotify.Player({ name: 'Song Battle Party', getOAuthToken: (cb) => playbackToken().then(cb).catch(reject), volume: .7 }); spotifyPlayer.addListener('ready', ({ device_id }) => { deviceId = device_id; show('#player', true); resolve(spotifyPlayer); }); spotifyPlayer.addListener('not_ready', () => { deviceId = null; }); spotifyPlayer.addListener('account_error', () => reject(new Error('Spotify Premium is required.'))); spotifyPlayer.addListener('authentication_error', () => reject(new Error('Reconnect Spotify.'))); spotifyPlayer.addListener('player_state_changed', renderPlayer); spotifyPlayer.connect().then((ok) => { if (!ok) reject(new Error('Could not start Spotify playback.')); }); }; if (window.Spotify) window.onSpotifyWebPlaybackSDKReady(); else { const script = document.createElement('script'); script.src = 'https://sdk.scdn.co/spotify-player.js'; script.onerror = () => reject(new Error('Spotify playback could not load.')); document.head.append(script); } }); return playerPromise; }
async function startTrack(track) { await initialisePlayer(); await spotifyPlayer.activateElement(); const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, { method: 'PUT', headers: { Authorization: `Bearer ${await playbackToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ uris: [track.uri] }) }); if (!response.ok) throw new Error(response.status === 403 ? 'Spotify Premium is required.' : 'Spotify could not play this track.'); }
async function play(side) { const track = side === 'a' ? state.currentMatchup.songA : state.currentMatchup.songB; try { await startTrack(track); await mutate('played', { side }); } catch (error) { text('#match-message', `${error.message} Use Open in Spotify or replace the track.`); } }
async function playChampion() { if (!championTrack) return; try { text('#results-status', 'Starting champion…'); await startTrack(championTrack); text('#results-status', ''); } catch (error) { text('#results-status', error.message); } }
function renderPlayer(playerState) { if (!playerState) return; const track = playerState.track_window.current_track; $('#player-cover').src = track?.album.images[0]?.url || ''; text('#player-track', track?.name || 'Ready'); text('#player-artist', track?.artists.map((a) => a.name).join(', ') || ''); position = playerState.position; duration = playerState.duration; paused = playerState.paused; updatedAt = Date.now(); text('#toggle-play', paused ? '▶' : 'Ⅱ'); updateTimeline(); }
async function seek(change = null) { if (!spotifyPlayer) return; const current = await spotifyPlayer.getCurrentState(); const next = change === null ? Number($('#seek').value) : Math.max(0, Math.min(current?.duration || duration, (current?.position ?? position) + change)); await spotifyPlayer.seek(next); position = next; updatedAt = Date.now(); }
function updateTimeline() { const current = Math.min(duration, position + (paused ? 0 : Date.now() - updatedAt)); if (!seeking) { $('#seek').value = current; text('#elapsed', formatTime(current)); } $('#seek').max = Math.max(duration, 1); text('#duration', formatTime(duration)); }

$('#connect').onclick = () => { location.href = '/api/auth/login'; }; $('#create').onclick = async () => { text('#host-status', 'Creating room…'); try { state = await api('create', { method: 'POST' }); render(); } catch (error) { text('#host-status', error.message); } };
$$('input[name="cap"]').forEach((radio) => radio.onchange = () => mutate('settings', { maxBracketSize: Number(radio.value) })); $('#begin').onclick = () => mutate('begin'); $('#assemble').onclick = () => mutate('assemble'); $('#start-matches').onclick = () => mutate('start');
$$('.song-card .play').forEach((button) => button.onclick = () => play(button.closest('.song-card').dataset.side)); $$('.song-card .replace').forEach((button) => button.onclick = () => mutate('replace', { side: button.closest('.song-card').dataset.side }));
$$('.song-card .heard').forEach((button) => button.onclick = () => mutate('played', { side: button.closest('.song-card').dataset.side }));
$('#open-voting').onclick = () => mutate('open-voting'); $('#advance').onclick = () => mutate('advance'); $('#replay').onclick = () => mutate('replay'); $('#end').onclick = () => { if (confirm('End this room?')) mutate('end').then(() => location.href = '/'); };
$('#play-champion').onclick = playChampion;
$('#toggle-play').onclick = () => spotifyPlayer?.togglePlay(); $('#back-15').onclick = () => seek(-15000); $('#forward-15').onclick = () => seek(15000); $('#seek').oninput = () => { seeking = true; text('#elapsed', formatTime(Number($('#seek').value))); }; $('#seek').onchange = () => seek().finally(() => { seeking = false; });

await checkAuth(); setInterval(() => load(true), 2000); setInterval(updateTimeline, 500);
