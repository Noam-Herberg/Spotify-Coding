function calculateElo(winnerRating, loserRating, k = 32) {
  const expected = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
  const change = Math.round(k * (1 - expected));
  return { change, winnerAfter: winnerRating + change, loserAfter: loserRating - change };
}

module.exports = { calculateElo };
