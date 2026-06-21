const { getSession } = require('../_lib/auth');
const { issueBattle } = require('../_lib/battles');
const { validateFilters } = require('../_lib/discovery');
const { HttpError } = require('../_lib/errors');
const { handler, json } = require('../_lib/http');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  const genre = request.body?.genre || 'all';
  const decade = request.body?.decade || 'all';
  if (!validateFilters(genre, decade)) throw new HttpError(400, 'Invalid battle filters.', 'invalid_filters');
  const previousBattleId = request.body?.previousBattleId || null;
  if (previousBattleId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previousBattleId)) throw new HttpError(400, 'Invalid previous battle ID.', 'invalid_previous_battle');
  const sourceMode = request.body?.sourceMode || 'random';
  const curatedSourceType = request.body?.curatedSourceType || null;
  const playlistId = request.body?.playlistId || null;
  if (playlistId && !/^[0-9a-f-]{36}$/i.test(playlistId)) throw new HttpError(400, 'Invalid playlist.', 'invalid_playlist');
  const battle = await issueBattle(session, genre, decade, previousBattleId, { sourceMode, curatedSourceType, playlistId });
  json(response, 201, { battle });
});
