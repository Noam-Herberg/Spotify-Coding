const loginButton = document.querySelector('#login');
const accountName = document.querySelector('#account-name');
const joinPanel = document.querySelector('#join-panel');
const joinForm = document.querySelector('#join-form');
const joinStatus = document.querySelector('#join-status');
const battleSection = document.querySelector('#battle-section');
const battleArena = document.querySelector('#battle-arena');
const battleStatus = document.querySelector('#battle-status');
const battleGenre = document.querySelector('#battle-genre');
const battleDecade = document.querySelector('#battle-decade');
const battleRanking = document.querySelector('#battle-ranking');
const battleEmpty = document.querySelector('#battle-empty');
const resetButton = document.querySelector('#battle-reset');
const playerBar = document.querySelector('#player');
const playerTrack = document.querySelector('#player-track');
const playerArtist = document.querySelector('#player-artist');
const playerCover = document.querySelector('#player-cover');
const togglePlay = document.querySelector('#toggle-play');
const seekInput = document.querySelector('#seek');
const elapsedTime = document.querySelector('#elapsed');
const durationTime = document.querySelector('#duration');
const volumeInput = document.querySelector('#volume');

let viewer;
let currentBattle;
let battleRound = 0;
let activeFilters = { genre: 'all', decade: 'all' };
let spotifyPlayer;
let playerDeviceId;
let playerLoading;
let tokenCache;
let playbackPosition = 0;
let playbackDuration = 0;
let playbackPaused = true;
let playbackUpdatedAt = Date.now();
let isSeeking = false;

await initialiseApp();

loginButton.addEventListener('click', async () => {
  if (!viewer?.authenticated) return location.assign('/api/auth/login');
  await api('/api/auth/logout', { method: 'POST' });
  location.reload();
});

joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  joinStatus.textContent = 'Joining…';
  try {
    const result = await api('/api/group/join', { method: 'POST', body: { inviteCode: document.querySelector('#invite-code').value } });
    viewer.membership = result.membership;
    showMemberApp();
  } catch (error) {
    joinStatus.textContent = error.message;
  }
});

document.querySelector('#battle-start').addEventListener('click', () => startBattle());
for (const card of document.querySelectorAll('.battle-card')) {
  const side = card.dataset.side;
  card.querySelector('.battle-play').addEventListener('click', () => currentBattle && playTrack(currentBattle[side].uri));
  card.querySelector('.battle-pick').addEventListener('click', () => chooseWinner(side));
}

resetButton.addEventListener('click', async () => {
  if (!confirm('Reset all shared ratings and vote history for everyone?')) return;
  try {
    await api('/api/standings/reset', { method: 'POST' });
    currentBattle = null;
    battleArena.hidden = true;
    battleStatus.textContent = 'Shared standings reset. Start a new battle.';
    await loadStandings();
  } catch (error) {
    battleStatus.textContent = error.message;
  }
});

togglePlay.addEventListener('click', () => spotifyPlayer?.togglePlay());
document.querySelector('#previous').addEventListener('click', () => spotifyPlayer?.previousTrack());
document.querySelector('#next').addEventListener('click', () => spotifyPlayer?.nextTrack());
document.querySelector('#back-15').addEventListener('click', () => seekRelative(-15000));
document.querySelector('#forward-15').addEventListener('click', () => seekRelative(15000));
seekInput.addEventListener('input', () => { isSeeking = true; elapsedTime.textContent = formatTime(Number(seekInput.value)); });
seekInput.addEventListener('change', async () => {
  if (!spotifyPlayer) return;
  const position = Number(seekInput.value);
  await spotifyPlayer.seek(position);
  playbackPosition = position; playbackUpdatedAt = Date.now(); isSeeking = false;
});
volumeInput.addEventListener('input', () => spotifyPlayer?.setVolume(Number(volumeInput.value) / 100));
setInterval(updateTimeline, 500);

async function initialiseApp() {
  try {
    viewer = await api('/api/me');
  } catch (error) {
    battleStatus.textContent = error.message;
    return;
  }
  if (!viewer.authenticated) {
    loginButton.textContent = 'Connect Spotify';
    return;
  }
  accountName.textContent = viewer.user.displayName;
  loginButton.textContent = 'Disconnect';
  initialisePlayer().catch(showPlaybackError);
  if (viewer.membership) showMemberApp(); else joinPanel.hidden = false;
}

function showMemberApp() {
  joinPanel.hidden = true;
  battleSection.hidden = false;
  resetButton.hidden = !viewer.membership.isOwner;
  loadStandings();
  if (!window.standingsPoll) window.standingsPoll = setInterval(loadStandings, 30000);
}

async function startBattle(previousBattleId = null) {
  const button = document.querySelector('#battle-start');
  button.disabled = true;
  if (!previousBattleId) {
    activeFilters = { genre: battleGenre.value, decade: battleDecade.value };
    battleRound = 1;
  }
  battleStatus.textContent = previousBattleId ? 'Finding a new challenger…' : 'Finding two songs…';
  try {
    const result = await api('/api/battles', { method: 'POST', body: { ...activeFilters, previousBattleId } });
    currentBattle = result.battle;
    renderBattle();
    battleArena.hidden = false;
    button.textContent = 'Restart battle';
    battleStatus.textContent = `Round ${battleRound} · ${filterLabel()}`;
  } catch (error) {
    battleStatus.textContent = error.message;
  } finally {
    button.disabled = false;
    setPickButtons(false);
  }
}

async function chooseWinner(side) {
  if (!currentBattle) return;
  const winner = currentBattle[side];
  setPickButtons(true);
  battleStatus.textContent = `Recording ${winner.name} as the winner…`;
  try {
    await api(`/api/battles/${currentBattle.id}/vote`, { method: 'POST', body: { winnerId: winner.id } });
    const previousId = currentBattle.id;
    currentBattle = null;
    battleRound += 1;
    await loadStandings();
    await startBattle(previousId);
  } catch (error) {
    battleStatus.textContent = error.message;
    setPickButtons(false);
  }
}

function renderBattle() {
  for (const side of ['left', 'right']) {
    const track = currentBattle[side];
    const card = battleArena.querySelector(`[data-side="${side}"]`);
    const image = card.querySelector('img');
    image.src = track.image; image.alt = `${track.album} cover`;
    card.querySelector('h3').textContent = track.name;
    card.querySelector('.battle-artist').textContent = track.artist;
    card.querySelector('a').href = track.url;
    card.querySelector('.battle-play').ariaLabel = `Play ${track.name}`;
    card.querySelector('.battle-pick').ariaLabel = `Pick ${track.name} as winner`;
  }
}

async function loadStandings() {
  if (!viewer?.membership) return;
  try {
    const result = await api('/api/standings');
    renderStandings(result.standings);
  } catch (error) {
    if (error.status === 401) location.reload();
  }
}

function renderStandings(standings) {
  battleRanking.replaceChildren();
  for (const song of standings) {
    const item = document.createElement('li');
    const image = Object.assign(document.createElement('img'), { src: song.image, alt: '' });
    const copy = document.createElement('div');
    const link = Object.assign(document.createElement('a'), { href: song.url, target: '_blank', rel: 'noreferrer', textContent: song.name });
    link.style.color = 'inherit';
    copy.append(link, Object.assign(document.createElement('span'), { textContent: song.artist }));
    const play = Object.assign(document.createElement('button'), { className: 'play-button', textContent: '▶', ariaLabel: `Play ${song.name}` });
    play.addEventListener('click', () => playTrack(song.uri));
    const record = document.createElement('div');
    record.className = 'battle-record';
    record.append(`${song.wins}–${song.losses}`, Object.assign(document.createElement('small'), { textContent: `${song.rating} Elo` }));
    item.append(image, copy, play, record);
    battleRanking.append(item);
  }
  battleEmpty.hidden = standings.length > 0;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.message || 'The request failed.');
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

async function playbackToken() {
  if (tokenCache?.expiresAt > Date.now() + 60000) return tokenCache.value;
  const result = await api('/api/auth/token');
  tokenCache = { value: result.accessToken, expiresAt: Date.now() + result.expiresIn * 1000 };
  return tokenCache.value;
}

async function initialisePlayer() {
  if (spotifyPlayer) return spotifyPlayer;
  if (playerLoading) return playerLoading;
  playerLoading = new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => {
      spotifyPlayer = new Spotify.Player({ name: 'Song Battle', getOAuthToken: (callback) => playbackToken().then(callback).catch(reject), volume: 0.7 });
      spotifyPlayer.addListener('ready', ({ device_id }) => { playerDeviceId = device_id; playerBar.hidden = false; resolve(spotifyPlayer); });
      spotifyPlayer.addListener('not_ready', () => { playerDeviceId = null; });
      spotifyPlayer.addListener('authentication_error', () => reject(new Error('Spotify playback authentication expired. Reconnect Spotify.')));
      spotifyPlayer.addListener('account_error', () => reject(new Error('Spotify playback requires Premium.')));
      spotifyPlayer.addListener('initialization_error', ({ message }) => reject(new Error(message)));
      spotifyPlayer.addListener('playback_error', ({ message }) => showPlaybackError(new Error(message)));
      spotifyPlayer.addListener('player_state_changed', renderPlayerState);
      spotifyPlayer.connect().then((connected) => { if (!connected) reject(new Error('Spotify could not create a browser player.')); });
    };
    if (window.Spotify) return window.onSpotifyWebPlaybackSDKReady();
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.onerror = () => reject(new Error('Spotify playback could not be loaded.'));
    document.head.append(script);
  });
  return playerLoading;
}

async function playTrack(uri) {
  try {
    await initialisePlayer();
    await spotifyPlayer.activateElement();
    if (!playerDeviceId) throw new Error('The player is not ready yet.');
    const token = await playbackToken();
    const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(playerDeviceId)}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ uris: [uri] }) });
    if (response.status === 403) throw new Error('Full playback requires Spotify Premium.');
    if (!response.ok) throw new Error('Spotify could not start this song.');
    playerBar.hidden = false;
  } catch (error) { showPlaybackError(error); }
}

function renderPlayerState(state) {
  if (!state) return;
  const track = state.track_window.current_track;
  playerTrack.textContent = track?.name || 'Ready to play';
  playerArtist.textContent = track?.artists.map((artist) => artist.name).join(', ') || 'Choose a song';
  playerCover.src = track?.album.images[0]?.url || '';
  togglePlay.textContent = state.paused ? '▶' : 'Ⅱ';
  playbackPosition = state.position; playbackDuration = state.duration; playbackPaused = state.paused; playbackUpdatedAt = Date.now();
  updateTimeline(); playerBar.hidden = false;
}

async function seekRelative(change) {
  if (!spotifyPlayer) return;
  const state = await spotifyPlayer.getCurrentState();
  if (!state) return;
  const position = Math.max(0, Math.min(state.duration, state.position + change));
  await spotifyPlayer.seek(position);
  playbackPosition = position; playbackDuration = state.duration; playbackUpdatedAt = Date.now(); updateTimeline();
}

function updateTimeline() {
  const position = Math.min(playbackPosition + (playbackPaused ? 0 : Date.now() - playbackUpdatedAt), playbackDuration);
  if (!isSeeking) { seekInput.value = String(position); elapsedTime.textContent = formatTime(position); }
  seekInput.max = String(Math.max(playbackDuration, 1)); durationTime.textContent = formatTime(playbackDuration);
}

function formatTime(milliseconds) { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function filterLabel() {
  const genre = Array.from(battleGenre.options).find((option) => option.value === activeFilters.genre)?.text || activeFilters.genre;
  const decade = Array.from(battleDecade.options).find((option) => option.value === activeFilters.decade)?.text || activeFilters.decade;
  return `${genre} · ${decade}`;
}
function setPickButtons(disabled) { for (const button of battleArena.querySelectorAll('.battle-pick')) button.disabled = disabled; }
function showPlaybackError(error) { battleStatus.textContent = error.message || 'Spotify playback failed.'; }
