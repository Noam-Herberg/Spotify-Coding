const { deleteSession } = require('../_lib/auth');
const { cookie, handler } = require('../_lib/http');

module.exports = handler('POST', async (request, response) => {
  await deleteSession(request);
  response.setHeader('Set-Cookie', cookie('song_battle_session', '', { maxAge: 0 }));
  response.status(204).end();
});
