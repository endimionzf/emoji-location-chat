const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgresql://app:secure_password_here@postgres:5432/emoji_chat';

const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('[Database] Pool initialization error:', err.message);
  } else {
    console.log('[Database] Pool connected successfully to PostgreSQL:', res.rows[0].now);
  }
});

module.exports = pool;
