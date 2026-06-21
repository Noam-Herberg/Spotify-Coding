const routes = {
  search: require('./_features/search'),
  stats: require('./_features/stats'),
  nominations: require('./_features/nominations'),
  'nominations/add': require('./_features/nominations/add'),
  'nominations/remove': require('./_features/nominations/remove'),
  playlists: require('./_features/playlists'),
  'playlists/spotify': require('./_features/playlists/spotify'),
  'playlists/import': require('./_features/playlists/import'),
  'playlists/refresh': require('./_features/playlists/refresh'),
  'playlists/remove': require('./_features/playlists/remove'),
  'playlists/export': require('./_features/playlists/export'),
  tournaments: require('./_features/tournaments'),
  'tournaments/detail': require('./_features/tournaments/detail'),
  'tournaments/create': require('./_features/tournaments/create'),
  'tournaments/add': require('./_features/tournaments/add'),
  'tournaments/remove': require('./_features/tournaments/remove'),
  'tournaments/fill': require('./_features/tournaments/fill'),
  'tournaments/start': require('./_features/tournaments/start'),
  'tournaments/vote': require('./_features/tournaments/vote'),
  'tournaments/close': require('./_features/tournaments/close'),
  'tournaments/cancel': require('./_features/tournaments/cancel')
};

module.exports = async (request, response) => {
  const route = String(request.query.route || '').replace(/^\/+|\/+$/g, '');
  const endpoint = routes[route];
  if (!endpoint) return response.status(404).setHeader('Cache-Control', 'no-store').json({ error: 'not_found', message: 'Feature endpoint not found.' });
  return endpoint(request, response);
};
