import { $, api, text } from './common.js';
const preset = new URLSearchParams(location.search).get('room');
if (preset) $('#room-code').value = preset.toUpperCase();
$('#room-code').addEventListener('input', (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, ''); });
$('#join-form').addEventListener('submit', async (event) => {
  event.preventDefault(); text('#join-status', 'Joining…');
  try { const code = $('#room-code').value; await api('join', { method: 'POST', body: { code, displayName: $('#display-name').value } }); location.href = `/play?room=${encodeURIComponent(code)}`; }
  catch (error) { text('#join-status', error.message); }
});
