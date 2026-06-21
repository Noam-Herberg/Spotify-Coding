const test = require('node:test');
const assert = require('node:assert/strict');
const { fromRow, fromSpotify } = require('../api/_lib/tracks');

test('normalizes Spotify tracks for every curated source', () => {
  const track = fromSpotify({ id: 'abc', uri: 'spotify:track:abc', name: 'Song', artists: [{ name: 'Artist' }], album: { name: 'Album', images: [{ url: 'cover' }] }, external_urls: { spotify: 'url' } });
  assert.deepEqual(track, { id: 'abc', uri: 'spotify:track:abc', name: 'Song', artist: 'Artist', album: 'Album', image: 'cover', url: 'url' });
});

test('normalizes stored tracks for battles and tournaments', () => {
  assert.deepEqual(fromRow({ spotify_id: 'abc', uri: 'uri', name: 'Song', artist: 'Artist', album: 'Album', image_url: 'cover', spotify_url: 'url' }),
    { id: 'abc', uri: 'uri', name: 'Song', artist: 'Artist', album: 'Album', image: 'cover', url: 'url' });
});
