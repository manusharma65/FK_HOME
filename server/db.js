// FK Home — Postgres connection pool
const { Pool } = require('pg');

let pool = null;

async function initDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
  });
  await pool.query('SELECT 1');
  return pool;
}

function getPool() {
  if (!pool) throw new Error('Pool not initialised');
  return pool;
}

const db = {
  query: (text, params) => getPool().query(text, params),
  getClient: () => getPool().connect(),
};

module.exports = { initDb, getPool, db };
