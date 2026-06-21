const GENRES = ['all', 'alternative', 'ambient', 'blues', 'classical', 'country', 'dance', 'disco', 'electronic', 'folk', 'funk', 'hip-hop', 'house', 'indie', 'jazz', 'latin', 'metal', 'pop', 'punk', 'r-n-b', 'reggae', 'rock', 'soul', 'techno', 'world'];
const DECADES = ['all', '1960', '1970', '1980', '1990', '2000', '2010', '2020'];
const WORDS = ['after', 'blue', 'city', 'dance', 'dream', 'fire', 'gold', 'heart', 'home', 'light', 'love', 'midnight', 'moon', 'night', 'rain', 'river', 'run', 'summer', 'time', 'wild'];

function validateFilters(genre, decade) {
  if (!GENRES.includes(genre) || !DECADES.includes(decade)) return false;
  return true;
}

function randomSearch(genre, decade, random = Math.random) {
  const randomYear = 1960 + Math.floor(random() * 67);
  const start = decade === 'all' ? randomYear : Number(decade);
  const end = decade === 'all' ? Math.min(start + 5, 2026) : Math.min(start + 9, 2026);
  const selectedGenre = genre === 'all' ? GENRES[1 + Math.floor(random() * (GENRES.length - 1))] : genre;
  const query = genre !== 'all' || random() < 0.75
    ? `genre:${selectedGenre} year:${start}-${end}`
    : `${WORDS[Math.floor(random() * WORDS.length)]} year:${start}-${end}`;
  return { query, offset: Math.floor(random() * 5) * 10 };
}

module.exports = { DECADES, GENRES, randomSearch, validateFilters };
