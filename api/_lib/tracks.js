function fromSpotify(track) {
  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artist: (track.artists || []).map((artist) => artist.name).join(', '),
    album: track.album?.name || '',
    image: track.album?.images?.[0]?.url || '',
    url: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`
  };
}

function fromRow(row, prefix = '') {
  const value = (name) => row[`${prefix}${name}`];
  return { id: value('spotify_id'), uri: value('uri'), name: value('name'), artist: value('artist'), album: value('album'), image: value('image_url'), url: value('spotify_url') };
}

async function upsert(client, track, groupId, ensureRating = true) {
  await client.query(`INSERT INTO tracks (spotify_id,uri,name,artist,album,image_url,spotify_url) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (spotify_id) DO UPDATE SET uri=EXCLUDED.uri,name=EXCLUDED.name,artist=EXCLUDED.artist,album=EXCLUDED.album,
    image_url=EXCLUDED.image_url,spotify_url=EXCLUDED.spotify_url,updated_at=now()`,
    [track.id, track.uri, track.name, track.artist, track.album, track.image, track.url]);
  if (ensureRating) await client.query('INSERT INTO group_track_ratings (group_id,track_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [groupId, track.id]);
}

module.exports = { fromRow, fromSpotify, upsert };
