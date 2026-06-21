const { Pool } = require('pg');

let pool;

function getPool() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('DATABASE_URL or POSTGRES_URL is not configured.');
  if (!pool) pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 5 });
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
