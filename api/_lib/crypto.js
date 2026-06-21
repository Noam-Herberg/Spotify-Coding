const crypto = require('node:crypto');

const b64url = (buffer) => buffer.toString('base64url');
const key = () => crypto.createHash('sha256').update(required('TOKEN_ENCRYPTION_KEY')).digest();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [b64url(iv), b64url(cipher.getAuthTag()), b64url(encrypted)].join('.');
}

function decrypt(value) {
  const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function hashSession(token) {
  return crypto.createHmac('sha256', required('SESSION_SECRET')).update(token).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { decrypt, encrypt, hashSession, required, safeEqual };
