const { getSession } = require('./_lib/auth');
const { handler, json } = require('./_lib/http');

module.exports = handler('GET', async (request, response) => {
  const session = await getSession(request, { required: false });
  json(response, 200, session ? {
    authenticated: true,
    user: { id: session.spotify_user_id, displayName: session.display_name },
    membership: session.group_id ? { groupId: session.group_id, isOwner: session.is_owner } : null
  } : { authenticated: false, user: null, membership: null });
});
