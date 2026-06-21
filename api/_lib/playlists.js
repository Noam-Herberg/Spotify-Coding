const crypto = require('node:crypto');
const { spotifyFetch } = require('./spotify');
const tracks = require('./tracks');
const { HttpError } = require('./errors');

async function playlistTracks(userId, spotifyId) {
  const items = [];
  let path = `/playlists/${encodeURIComponent(spotifyId)}/items?limit=100&market=from_token`;
  while (path && items.length < 200) {
    const page = await spotifyFetch(userId, path);
    for (const wrapper of page.items || []) {
      const track = wrapper.track || wrapper.item;
      if (track?.type === 'track' && !track.is_local && !items.some((item) => item.id === track.id)) items.push(tracks.fromSpotify(track));
      if (items.length === 200) break;
    }
    path = page.next ? new URL(page.next).pathname + new URL(page.next).search : null;
  }
  return items;
}

async function saveSnapshot(client, session, spotifyId, existingId = null) {
  const metadata = await spotifyFetch(session.spotify_user_id, `/playlists/${encodeURIComponent(spotifyId)}`);
  const list = await playlistTracks(session.spotify_user_id, spotifyId);
  if (list.length < 2) throw new HttpError(409, 'That playlist needs at least two playable tracks.', 'playlist_too_small');
  const id = existingId || crypto.randomUUID();
  if (existingId) {
    await client.query('UPDATE imported_playlists SET name=$1,image_url=$2,spotify_url=$3,refreshed_at=now() WHERE id=$4', [metadata.name, metadata.images?.[0]?.url || '', metadata.external_urls?.spotify || '', id]);
    await client.query('DELETE FROM imported_playlist_tracks WHERE playlist_id=$1', [id]);
  } else {
    await client.query(`INSERT INTO imported_playlists (id,group_id,spotify_playlist_id,name,image_url,spotify_url,imported_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, session.group_id, spotifyId, metadata.name, metadata.images?.[0]?.url || '', metadata.external_urls?.spotify || '', session.spotify_user_id]);
  }
  for (let index = 0; index < list.length; index += 1) {
    await tracks.upsert(client, list[index], session.group_id, false);
    await client.query('INSERT INTO imported_playlist_tracks (playlist_id,track_id,position) VALUES ($1,$2,$3)', [id, list[index].id, index]);
  }
  return { id, name: metadata.name, trackCount: list.length };
}

module.exports = { playlistTracks, saveSnapshot };
