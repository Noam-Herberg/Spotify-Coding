const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

for (const filename of ['.env.local', '.env']) {
  const file = path.join(__dirname, '..', filename);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('POSTGRES_URL_NON_POOLING, DATABASE_URL_UNPOOLED, DATABASE_URL, or POSTGRES_URL is required.');
  process.exit(1);
}

const ssl = process.env.DATABASE_SSL_NO_VERIFY === 'true' ? { rejectUnauthorized: false } : { rejectUnauthorized: true };
const pool = new Pool({ connectionString, ssl });

async function main() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await pool.query('SELECT filename FROM schema_migrations')).rows.map((row) => row.filename));
  const directory = path.join(__dirname, '..', 'db', 'migrations');
  const files = fs.readdirSync(directory).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) { console.log(`Skipping ${file} (already applied)`); continue; }
    console.log(`Applying ${file}`);
    await pool.query(fs.readFileSync(path.join(directory, file), 'utf8'));
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
  }
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
