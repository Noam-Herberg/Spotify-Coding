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

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const directory = path.join(__dirname, '..', 'db', 'migrations');
  const files = fs.readdirSync(directory).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    console.log(`Applying ${file}`);
    await pool.query(fs.readFileSync(path.join(directory, file), 'utf8'));
  }
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
