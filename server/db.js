// FK Home — Postgres connection pool
const { Pool, types } = require('pg');

// node-postgres returns DATE columns (oid 1082) as JS Date objects by default,
// but the codebase treats dates as 'YYYY-MM-DD' strings throughout (e.g.
// String(hire_date).slice(0,10), monthsBetween('YYYY-MM-DD')). Force DATE to
// come back as the raw string so that assumption holds everywhere — this also
// fixes leave accrual miscomputing when a Date object slipped through.
types.setTypeParser(1082, (v) => v);

let pool = null;

async function initDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  const url = process.env.DATABASE_URL;
  // SSL is on for the external Railway URL, but OFF for Railway-internal networking
  // and for local / CI Postgres (localhost / 127.0.0.1 / sslmode=disable), which
  // don't speak SSL. This is what lets the test suite run locally and in CI.
  const noSsl = url.includes('railway.internal') || url.includes('localhost')
    || url.includes('127.0.0.1') || /sslmode=disable/.test(url);
  pool = new Pool({
    connectionString: url,
    ssl: noSsl ? false : { rejectUnauthorized: false },
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
