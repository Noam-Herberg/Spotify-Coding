const { HttpError } = require('./errors');

function json(response, status, body) {
  response.status(status).setHeader('Cache-Control', 'no-store').json(body);
}

function handler(method, work) {
  return async (request, response) => {
    try {
      if (request.method !== method) {
        response.setHeader('Allow', method);
        throw new HttpError(405, 'Method not allowed.', 'method_not_allowed');
      }
      if (method !== 'GET') validateOrigin(request);
      await work(request, response);
    } catch (error) {
      console.error(error);
      json(response, error.status || 500, { error: error.code || 'server_error', message: error.status ? error.message : 'The server could not complete this request.' });
    }
  };
}

function validateOrigin(request) {
  const expected = new URL(requiredAppUrl(request)).origin;
  const origin = request.headers.origin;
  if (origin !== expected) throw new HttpError(403, 'Invalid request origin.', 'invalid_origin');
}

function requiredAppUrl(request) {
  if (process.env.APP_URL) {
    try {
      return new URL(process.env.APP_URL).origin;
    } catch {
      throw new HttpError(503, 'APP_URL must be a complete URL such as https://spotifycoding.vercel.app.', 'server_configuration');
    }
  }
  // In production, never trust the forwarded host header to build OAuth/redirect URLs.
  if (process.env.VERCEL_ENV === 'production') throw new HttpError(503, 'APP_URL must be configured in production.', 'server_configuration');
  const host = request?.headers?.['x-forwarded-host'] || request?.headers?.host;
  const protocol = request?.headers?.['x-forwarded-proto'] || (process.env.VERCEL ? 'https' : 'http');
  if (host) return `${protocol}://${host}`;
  throw new HttpError(503, 'APP_URL is not configured for this deployment.', 'server_configuration');
}

function validateFetchSite(request) {
  // Browsers send Sec-Fetch-Site on fetch requests; reject anything not same-origin.
  const site = request.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Invalid request origin.', 'invalid_origin');
}

function cookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }));
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (process.env.VERCEL || process.env.APP_URL?.startsWith('https://')) parts.push('Secure');
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join('; ');
}

module.exports = { cookie, cookies, handler, json, requiredAppUrl, validateFetchSite, validateOrigin };
