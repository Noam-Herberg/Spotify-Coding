const crypto = require('node:crypto');
const { getSession } = require('../_lib/auth');
const { transaction } = require('../_lib/db');
const { required, safeEqual } = require('../_lib/crypto');
const { handler, json } = require('../_lib/http');
const { HttpError } = require('../_lib/errors');

module.exports = handler('POST', async (request, response) => {
  const session = await getSession(request);
  if (!safeEqual(request.body?.inviteCode || '', required('GROUP_INVITE_CODE'))) throw new HttpError(403, 'That invite code is not valid.', 'invalid_invite_code');
  const membership = await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(72419031)');
    let group = (await client.query('SELECT * FROM groups LIMIT 1 FOR UPDATE')).rows[0];
    if (!group) {
      group = (await client.query('INSERT INTO groups (id,name,owner_user_id) VALUES ($1,$2,$3) RETURNING *', [crypto.randomUUID(), 'Song Battle', session.spotify_user_id])).rows[0];
    }
    await client.query('INSERT INTO group_members (group_id,spotify_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [group.id, session.spotify_user_id]);
    return { groupId: group.id, isOwner: group.owner_user_id === session.spotify_user_id };
  });
  json(response, 200, { membership });
});
