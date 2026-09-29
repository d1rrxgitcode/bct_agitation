const { Pool, types } = require('pg');

// DATE из БД отдаём строкой, иначе pg превращает его в Date
// и день съезжает из-за часового пояса сервера/браузера
types.setTypeParser(1082, (v) => v);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
