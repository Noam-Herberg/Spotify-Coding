const { getSession } = require('../_lib/auth');
const { handler, json } = require('../_lib/http');
const { vote } = require('../_lib/tournaments');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  json(response, 200, await vote(session, request.body?.matchupId, request.body?.winnerId));
});
