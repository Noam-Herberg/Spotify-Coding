import { $, $$, api, escapeHtml, show, text } from './common.js';

const code = new URLSearchParams(location.search).get('room')?.toUpperCase() || '';
if (new URLSearchParams(location.search).get('embedded') === '1') document.body.classList.add('embedded');
let state = null, polling = false;
// Optimistic overrides — null means fall back to server state.
let localPicks = null, pendingReady = null;
text('#phone-code', code);

async function load(silent = false) {
  if (polling) return;
  polling = true;
  try {
    const next = await api('player-state', { params: { code, since: silent && state ? state.room.version : 0 } });
    if (next) { state = next; render(); }
    show('#rejoin', false); show('#phone-app', true);
  } catch (error) {
    if (!silent) { show('#rejoin', true); show('#phone-app', false); text('#phone-status', error.message); }
  } finally { polling = false; }
}

function phase(name) { $$('.phone-phase').forEach((node) => { node.hidden = node.id !== name; }); }

function trackMarkup(track, remove = false) {
  return `<div class="track${track._pending ? ' pending' : ''}"><img src="${escapeHtml(track.image)}" alt=""><div><strong>${escapeHtml(track.name)}</strong><span>${escapeHtml(track.artist)}</span></div>${remove ? `<button class="remove" data-id="${track.roomSongId}">Remove</button>` : track._pending ? '<span class="muted">Adding…</span>' : ''}</div>`;
}

function displayPicks() { return localPicks ?? state?.picks ?? []; }
function displayReady() { return pendingReady !== null ? pendingReady : Boolean(state?.you?.ready); }

function renderPicks() {
  const picks = displayPicks();
  const hasPending = picks.some((p) => p._pending);
  const ready = displayReady();
  $('#your-picks').innerHTML = picks.map((t) => trackMarkup(t, !t._pending && !!t.roomSongId)).join('')
    || '<p class="muted">No songs selected yet.</p>';
  $$('.remove', $('#your-picks')).forEach((b) => { b.onclick = () => removePick(b.dataset.id); });
  $('#ready').disabled = picks.length !== 2 || hasPending;
  $('#ready').textContent = ready ? 'Ready ✓' : 'I\'m ready';
  $('#search-form').hidden = picks.length >= 2 || ready;
  if (picks.length >= 2 && !hasPending) $('#search-results').innerHTML = '';
}

async function addPick(track, button) {
  if (displayPicks().filter((p) => !p._pending).length >= 2) return;
  button.disabled = true;
  localPicks = [...displayPicks(), { ...track, _pending: true }];
  renderPicks();
  text('#phone-status', '');
  try {
    const next = await api('pick', { method: 'POST', body: { code, track } });
    localPicks = null;
    if (next) { state = next; render(); }
  } catch (error) {
    localPicks = null;
    button.disabled = false;
    renderPicks();
    text('#phone-status', error.message);
  }
}

async function removePick(roomSongId) {
  localPicks = displayPicks().filter((p) => p.roomSongId !== roomSongId);
  renderPicks();
  text('#phone-status', '');
  try {
    const next = await api('unpick', { method: 'POST', body: { code, roomSongId } });
    localPicks = null;
    if (next) { state = next; render(); }
  } catch (error) {
    localPicks = null;
    renderPicks();
    text('#phone-status', error.message);
  }
}

function render() {
  if (!['lobby', 'picking'].includes(state.room.phase)) { localPicks = null; pendingReady = null; }
  text('#your-name', state.you?.displayName); text('#phone-code', state.room.code);
  const current = state.currentMatchup;
  if (['lobby', 'picking'].includes(state.room.phase)) {
    phase('phone-picks');
    renderPicks();
  } else if (state.room.phase === 'results' || state.room.phase === 'ended') {
    phase('phone-results');
    const final = [...(state.bracket || [])].sort((a, b) => b.round - a.round)[0];
    const winner = final?.winnerId === final?.songA?.roomSongId ? final.songA : final?.songB;
    if (winner) { $('#phone-champion-cover').src = winner.image; text('#phone-champion', winner.name); }
    $('#phone-curators').innerHTML = (state.curators || []).map((c) => `<li><span>${escapeHtml(c.displayName)}</span><strong>${c.score}</strong></li>`).join('');
    text('#phone-overall-title', `Overall · ${state.room.roundsPlayed} round${state.room.roundsPlayed === 1 ? '' : 's'}`);
    $('#phone-overall-curators').innerHTML = (state.overallCurators || []).map((c) => `<li><span>${escapeHtml(c.displayName)}</span><strong>${c.score}</strong></li>`).join('');
  } else if (current && ['voting', 'revote'].includes(current.status)) {
    phase('phone-vote');
    const cards = $$('.vote-card'); [current.songA, current.songB].forEach((track, i) => { $('img', cards[i]).src = track.image; $('strong', cards[i]).textContent = track.name; $('span', cards[i]).textContent = track.artist; cards[i].disabled = Boolean(state.yourVote); cards[i].classList.toggle('selected', state.yourVote === track.roomSongId); });
    text('#vote-note', state.yourVote ? 'Vote locked in. Waiting for everyone else…' : current.status === 'revote' ? 'Still tied — vote once more.' : 'The submitters stay secret. Trust your ears.');
  } else {
    phase('phone-wait');
    const winner = current?.winnerId === current?.songA?.roomSongId ? current.songA : current?.winnerId === current?.songB?.roomSongId ? current.songB : null;
    text('#wait-title', current?.status === 'host_tiebreak' ? 'The Host is breaking the tie' : winner ? `${winner.name} wins` : 'Listen on the big screen');
    text('#wait-copy', `${current?.votes?.voted || 0}/${current?.votes?.eligible || state.players.filter((p) => p.active).length} active players have voted.`);
  }
  text('#phone-status', '');
}

async function mutate(action, extra = {}) { try { const next = await api(action, { method: 'POST', body: { code, ...extra } }); if (next) { state = next; render(); } } catch (error) { text('#phone-status', error.message); } }

$('#rejoin-form').addEventListener('submit', async (event) => { event.preventDefault(); try { state = await api('join', { method: 'POST', body: { code, displayName: $('#rejoin-name').value } }); show('#rejoin', false); show('#phone-app', true); render(); } catch (error) { text('#phone-status', error.message); } });
$('#search-form').addEventListener('submit', async (event) => { event.preventDefault(); const root = $('#search-results'); root.innerHTML = '<p class="muted">Searching…</p>'; try { const result = await api('search', { params: { code, q: $('#search-query').value } }); root.innerHTML = result.tracks.map((track, index) => `<button class="track result" data-index="${index}"><img src="${escapeHtml(track.image)}" alt=""><span><strong>${escapeHtml(track.name)}</strong><small>${escapeHtml(track.artist)}</small></span><b>Add</b></button>`).join(''); $$('.result', root).forEach((button) => button.onclick = () => addPick(result.tracks[Number(button.dataset.index)], button)); } catch (error) { root.innerHTML = `<p class="status">${escapeHtml(error.message)}</p>`; } });
$('#ready').onclick = async () => { const newReady = !displayReady(); pendingReady = newReady; renderPicks(); try { const next = await api('ready', { method: 'POST', body: { code, ready: newReady } }); pendingReady = null; if (next) { state = next; render(); } } catch (error) { pendingReady = null; renderPicks(); text('#phone-status', error.message); } };
$$('.vote-card').forEach((button) => button.onclick = () => { const song = button.dataset.side === 'a' ? state.currentMatchup.songA : state.currentMatchup.songB; mutate('vote', { songId: song.roomSongId }); });

await load(); setInterval(() => load(true), 2000);
