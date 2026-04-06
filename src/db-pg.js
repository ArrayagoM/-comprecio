// ── PostgreSQL adapter (producción / Vercel + Neon) ──────────
const { Pool } = require('pg');

let pool = null;

// Convierte ? a $1, $2, $3... (PostgreSQL usa numerados)
function toPg(sql) {
  let i = 0;
  // INSERT OR IGNORE → ON CONFLICT DO NOTHING
  sql = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  // datetime('now', ...) → NOW() - INTERVAL ...
  sql = sql.replace(/datetime\('now',\s*'([^']+)'\)/gi, (_, interval) => {
    const clean = interval.trim().replace(/^-/, '').replace(/^'|'$/g, '');
    return `(NOW() - INTERVAL '${clean}')`;
  });
  sql = sql.replace(/datetime\('now'\)/gi, 'NOW()');
  // ? → $N
  sql = sql.replace(/\?/g, () => `$${++i}`);
  return sql;
}

// Detecta si es INSERT para agregar RETURNING id
function addReturning(sql) {
  const trimmed = sql.trim().toUpperCase();
  if (trimmed.startsWith('INSERT') && !trimmed.includes('RETURNING')) {
    return sql.trimEnd() + ' RETURNING id';
  }
  return sql;
}

// API pública: db.all(sql, params), db.get(sql, params), db.run(sql, params)
function createPgWrapper() {
  return {
    async all(sql, params = []) {
      const { rows } = await pool.query(toPg(sql), params.flat());
      return rows;
    },
    async get(sql, params = []) {
      const { rows } = await pool.query(toPg(sql), params.flat());
      return rows[0] || null;
    },
    async run(sql, params = []) {
      const pgSql = toPg(addReturning(sql));
      const result = await pool.query(pgSql, params.flat());
      const lastID = result.rows[0]?.id ?? null;
      return { lastID, lastInsertRowid: lastID, rowCount: result.rowCount };
    },
    async exec(sql) {
      // Ejecuta múltiples statements separados por ;
      const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        try { await pool.query(toPg(stmt)); } catch (e) { /* ignore schema errors */ }
      }
    }
  };
}

let dbWrapper = null;

function getDB() {
  if (!dbWrapper) throw new Error('Base de datos no inicializada');
  return dbWrapper;
}

async function initDB() {
  console.log('🐘 Conectando a PostgreSQL (Neon)...');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // Test connection
  const client = await pool.connect();
  client.release();
  console.log('✅ PostgreSQL conectado');

  dbWrapper = createPgWrapper();
  await createSchema();
  await seedIfEmpty();
}

async function createSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'consumer',
      points INTEGER DEFAULT 0,
      badge TEXT DEFAULT 'Nuevo Explorador',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      owner_id INTEGER,
      category TEXT DEFAULT 'Comercio General',
      verified INTEGER DEFAULT 0,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      brand TEXT,
      unit TEXT DEFAULT 'unidad',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS prices (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL,
      business_id INTEGER NOT NULL,
      reported_by INTEGER NOT NULL,
      price REAL NOT NULL,
      currency TEXT DEFAULT 'ARS',
      is_promotion INTEGER DEFAULT 0,
      promotion_ends TEXT,
      confirmed_count INTEGER DEFAULT 0,
      disputed_count INTEGER DEFAULT 0,
      out_of_stock INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS price_history (
      id SERIAL PRIMARY KEY,
      price_id INTEGER NOT NULL,
      old_price REAL NOT NULL,
      new_price REAL NOT NULL,
      changed_by INTEGER NOT NULL,
      changed_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS reactions (
      id SERIAL PRIMARY KEY,
      price_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      reaction_type TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(price_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function seedIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*) as c FROM products');
  if (parseInt(rows[0].c) > 0) return;

  const demoPass = '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

  await pool.query(`
    INSERT INTO users (name, email, password, role, points, badge) VALUES
    ('María González',  'maria@comprecio.com',  '${demoPass}', 'consumer', 340, 'Cazador Experto'),
    ('Carlos Fernández','carlos@comprecio.com', '${demoPass}', 'consumer', 185, 'Cazador de Precios'),
    ('Ana Martínez',    'ana@comprecio.com',    '${demoPass}', 'consumer', 72,  'Reportero Activo'),
    ('Luis Rodríguez',  'luis@comprecio.com',   '${demoPass}', 'consumer', 31,  'Colaborador'),
    ('Demo User',       'demo@comprecio.com',   '${demoPass}', 'consumer', 50,  'Reportero Activo')
    ON CONFLICT (email) DO NOTHING
  `);

  await pool.query(`
    INSERT INTO products (name, name_normalized, category, brand, unit) VALUES
    ('Azúcar',           'azucar',            'Almacén',   NULL,       'kg'),
    ('Aceite de girasol','aceite de girasol', 'Almacén',   NULL,       'lt'),
    ('Arroz',            'arroz',             'Almacén',   NULL,       'kg'),
    ('Leche entera',     'leche entera',      'Lácteos',   NULL,       'lt'),
    ('Pan lactal',       'pan lactal',        'Panadería', NULL,       'unidad'),
    ('Yerba mate',       'yerba mate',        'Almacén',   NULL,       'kg'),
    ('Harina 000',       'harina 000',        'Almacén',   NULL,       'kg'),
    ('Fideos spaghetti', 'fideos spaghetti',  'Almacén',   NULL,       '500g'),
    ('Sal fina',         'sal fina',          'Almacén',   NULL,       'kg'),
    ('Coca-Cola 1.5L',   'coca cola 1.5l',    'Bebidas',   'Coca-Cola','lt'),
    ('Agua mineral 2L',  'agua mineral 2l',   'Bebidas',   NULL,       'lt'),
    ('Jabón en polvo',   'jabon en polvo',    'Limpieza',  NULL,       'kg'),
    ('Papel higiénico x4','papel higienico x4','Higiene',  NULL,       'pack'),
    ('Aceite de oliva',  'aceite de oliva',   'Almacén',   NULL,       '500ml'),
    ('Detergente',       'detergente',        'Limpieza',  NULL,       '750ml')
  `);

  await pool.query(`
    INSERT INTO businesses (name, address, lat, lng, owner_id, category, verified) VALUES
    ('Almacén Don Carlos',    'Av. Corrientes 1200', -34.6037, -58.3816, NULL, 'Almacén',      1),
    ('Supermercado El Sol',   'Av. Santa Fe 3400',   -34.5965, -58.4106, NULL, 'Supermercado', 1),
    ('Kiosco La Esquina',     'Av. Rivadavia 5000',  -34.6158, -58.4333, NULL, 'Kiosco',       0),
    ('Verdulería Rosario',    'Av. Callao 450',      -34.6097, -58.3927, NULL, 'Verdulería',   1),
    ('Minimarket 24hs',       'Av. Cabildo 2100',    -34.5713, -58.4571, NULL, 'Minimarket',   1)
  `);

  await pool.query(`
    INSERT INTO prices (product_id, business_id, reported_by, price, confirmed_count, updated_at) VALUES
    (1, 1, 1, 1850.00, 3, NOW() - INTERVAL '1 hour'),
    (1, 2, 1, 1790.00, 5, NOW() - INTERVAL '2 hours'),
    (2, 1, 2, 2100.00, 2, NOW() - INTERVAL '30 minutes'),
    (2, 2, 2, 1950.00, 7, NOW() - INTERVAL '5 hours'),
    (3, 3, 3, 1200.00, 1, NOW() - INTERVAL '1 day'),
    (4, 2, 1, 1450.00, 4, NOW() - INTERVAL '3 hours'),
    (5, 1, 4, 980.00,  2, NOW() - INTERVAL '2 days'),
    (6, 4, 5, 3200.00, 6, NOW() - INTERVAL '4 hours')
  `);

  console.log('🌱 Datos de ejemplo cargados en PostgreSQL');
}

module.exports = { getDB, initDB };
