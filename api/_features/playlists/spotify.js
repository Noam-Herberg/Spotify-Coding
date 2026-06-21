const { getSession } = require('../_lib/auth');
const { handler, json } = require('../_lib/http');
const { spotifyFetch } = require('../_lib/spotify');

module.exports = handler('GET', async (request, response) => {
  const session = await getSession(request, { member: true });
  const items = [];
  let path = '/me/playlists?limit=50';
  while (path && items.length < 200) {
    const page = await spotifyFetch(session.spotify_user_id, path);
    items.push(...page.items.map((item) => ({ id: item.id, name: item.name, image: item.images?.[0]?.url || '', tracks: item.tracks?.total || 0, owner: item.owner?.display_name || '' })));
    path = page.next ? new URL(page.next).pathname + new URL(page.next).search : null;
  }
  json(response, 200, { playlists: items });
});
