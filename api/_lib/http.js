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
  const expected = new URL(requiredAppUrl()).origin;
  const origin = request.headers.origin;
  if (origin !== expected) throw new HttpError(403, 'Invalid request origin.', 'invalid_origin');
}

function requiredAppUrl() {
  if (!process.env.APP_URL) throw new Error('APP_URL is not configured.');
  return process.env.APP_URL.replace(/\/$/, '');
}

function cookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }));
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (requiredAppUrl().startsWith('https://')) parts.push('Secure');
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join('; ');
}

module.exports = { cookie, cookies, handler, json, requiredAppUrl };
