const crypto = require('node:crypto');
const { getSession } = require('../_lib/auth');
const { getPool } = require('../_lib/db');
const { handler, json } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request, { member: true });
  const name = String(request.body?.name || '').trim();
  const size = Number(request.body?.size);
  if (name.length < 2 || name.length > 80 || ![8, 16].includes(size)) throw new HttpError(400, 'Enter a name and choose 8 or 16 songs.', 'invalid_tournament');
  const id = crypto.randomUUID();
  await getPool().query('INSERT INTO tournaments (id,group_id,name,size,created_by) VALUES ($1,$2,$3,$4,$5)', [id, session.group_id, name, size, session.spotify_user_id]);
  json(response, 201, { id });
});
