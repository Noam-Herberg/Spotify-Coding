const { Pool } = require('pg');

let pool;

function getPool() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('DATABASE_URL or POSTGRES_URL is not configured.');
  // Verify the server certificate by default; opt out only for providers with self-signed certs.
  const ssl = process.env.DATABASE_SSL_NO_VERIFY === 'true' ? { rejectUnauthorized: false } : { rejectUnauthorized: true };
  if (!pool) pool = new Pool({ connectionString, ssl, max: 5 });
  return pool;
}

async function transaction(work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { getPool, transaction };
