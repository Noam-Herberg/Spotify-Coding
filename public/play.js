import { $, $$, api, escapeHtml, show, text } from './common.js';

const code = new URLSearchParams(location.search).get('room')?.toUpperCase() || '';
let state = null, polling = false;
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
function trackMarkup(track, remove = false) { return `<div class="track"><img src="${escapeHtml(track.image)}" alt=""><div><strong>${escapeHtml(track.name)}</strong><span>${escapeHtml(track.artist)}</span></div>${remove ? `<button class="remove" data-id="${track.roomSongId}">Remove</button>` : ''}</div>`; }

function render() {
  text('#your-name', state.you?.displayName); text('#phone-code', state.room.code);
  const current = state.currentMatchup;
  if (['lobby','picking'].includes(state.room.phase)) {
    phase('phone-picks');
    $('#your-picks').innerHTML = state.picks.map((track) => trackMarkup(track, true)).join('') || '<p class="muted">No songs selected yet.</p>';
    $$('.remove').forEach((button) => button.onclick = () => mutate('unpick', { roomSongId: button.dataset.id }));
    $('#ready').disabled = state.picks.length !== 2; $('#ready').textContent = state.you?.ready ? 'Ready ✓' : 'I’m ready';
    $('#search-form').hidden = state.picks.length >= 2 || state.you?.ready;
  } else if (state.room.phase === 'results' || state.room.phase === 'ended') {
    phase('phone-results');
    const final = [...(state.bracket || [])].sort((a, b) => b.round - a.round)[0];
    const winner = final?.winnerId === final?.songA?.roomSongId ? final.songA : final?.songB;
    if (winner) { $('#phone-champion-cover').src = winner.image; text('#phone-champion', winner.name); }
    $('#phone-curators').innerHTML = (state.curators || []).map((c) => `<li><span>${escapeHtml(c.displayName)}</span><strong>${c.score}</strong></li>`).join('');
  } else if (current && ['voting','revote'].includes(current.status)) {
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
$('#search-form').addEventListener('submit', async (event) => { event.preventDefault(); const root = $('#search-results'); root.innerHTML = '<p class="muted">Searching…</p>'; try { const result = await api('search', { params: { code, q: $('#search-query').value } }); root.innerHTML = result.tracks.map((track, index) => `<button class="track result" data-index="${index}"><img src="${escapeHtml(track.image)}" alt=""><span><strong>${escapeHtml(track.name)}</strong><small>${escapeHtml(track.artist)}</small></span><b>Add</b></button>`).join(''); $$('.result', root).forEach((button) => button.onclick = () => mutate('pick', { track: result.tracks[Number(button.dataset.index)] })); } catch (error) { root.innerHTML = `<p class="status">${escapeHtml(error.message)}</p>`; } });
$('#ready').onclick = () => mutate('ready', { ready: !state.you?.ready });
$$('.vote-card').forEach((button) => button.onclick = () => { const song = button.dataset.side === 'a' ? state.currentMatchup.songA : state.currentMatchup.songB; mutate('vote', { songId: song.roomSongId }); });

await load(); setInterval(() => load(true), 2000);
