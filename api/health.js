const { getPool } = require('./_lib/db');
const { requiredAppUrl } = require('./_lib/http');

module.exports = async (request, response) => {
  if (request.method !== 'GET') return response.status(405).json({ error: 'method_not_allowed' });
  const required = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'DATABASE_URL', 'SESSION_SECRET', 'TOKEN_ENCRYPTION_KEY', 'GROUP_INVITE_CODE'];
  const missing = required.filter((name) => !process.env[name]);
  let databaseReachable = false;
  let schemaReady = false;
  if (process.env.DATABASE_URL) {
    try {
      const result = await getPool().query("SELECT to_regclass('public.users') IS NOT NULL AND to_regclass('public.battles') IS NOT NULL AS ready");
      databaseReachable = true;
      schemaReady = result.rows[0].ready;
    } catch {
      databaseReachable = false;
    }
  }
  let appUrl;
  try { appUrl = requiredAppUrl(request); } catch { appUrl = null; }
  const healthy = missing.length === 0 && databaseReachable && schemaReady && Boolean(appUrl);
  response.status(healthy ? 200 : 503).setHeader('Cache-Control', 'no-store').json({
    healthy,
    appUrl,
    spotifyCallback: appUrl ? `${appUrl}/api/auth/callback` : null,
    missingEnvironmentVariables: missing,
    databaseReachable,
    schemaReady
  });
};
