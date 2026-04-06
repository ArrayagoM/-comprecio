// ── Selector de base de datos ────────────────────────────────
// Producción (DATABASE_URL en env) → PostgreSQL via Neon
// Desarrollo local                 → SQLite via sql.js
if (process.env.DATABASE_URL) {
  module.exports = require('./db-pg');
} else {
  module.exports = require('./db-sqlite');
}
