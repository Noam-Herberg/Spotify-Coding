const { getSession } = require('../_lib/auth');
const { handler, json } = require('../_lib/http');
const { detail } = require('../_lib/tournaments');

module.exports = handler('GET', async (request, response) => {
  const session = await getSession(request, { member: true });
  json(response, 200, { tournament: await detail(session, request.query.id) });
});
