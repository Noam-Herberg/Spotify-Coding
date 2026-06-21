const { getSession } = require('../../_lib/auth');
const { vote } = require('../../_lib/battles');
const { handler, json } = require('../../_lib/http');
const { HttpError } = require('../../_lib/errors');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.query.id || '')) throw new HttpError(400, 'Invalid battle ID.', 'battle_not_found');
  if (!request.body?.winnerId) throw new HttpError(400, 'winnerId is required.', 'invalid_winner');
  const result = await vote(session, request.query.id, request.body.winnerId);
  json(response, 200, { result });
});
