// ── SQLite via sql.js (pure JS, no native build required) ──
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Resolve DB path relative to server.js location (process.cwd()), not src/
const DB_FILE = path.resolve(process.cwd(), 'comprecio.sqlite');
let sqlDb = null;

// ── Persistence helpers ──────────────────────────────────
function saveDb() {
  if (!sqlDb) return;
  try {
    const data = sqlDb.export();
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, Buffer.from(data));
  } catch (err) {
    console.error('⚠️  No se pudo guardar la DB:', err.message);
  }
}

// Convierte sintaxis PostgreSQL → SQLite para dev local
function toSqlite(sql) {
  // CURRENT_TIMESTAMP - INTERVAL 'N unit' → datetime('now', '-N unit')
  sql = sql.replace(/CURRENT_TIMESTAMP\s*-\s*INTERVAL\s*'(\d+)\s+(\w+)'/gi,
    (_, n, unit) => `datetime('now', '-${n} ${unit}')`);
  // NOW() → CURRENT_TIMESTAMP
  sql = sql.replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP');
  // SERIAL PRIMARY KEY → INTEGER PRIMARY KEY AUTOINCREMENT
  sql = sql.replace(/SERIAL\s+PRIMARY\s+KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
  // INSERT INTO ... ON CONFLICT DO NOTHING → INSERT OR IGNORE INTO
  sql = sql.replace(/INSERT\s+INTO\s+(\w+)/gi, 'INSERT OR IGNORE INTO $1');
  sql = sql.replace(/ON\s+CONFLICT\s+DO\s+NOTHING/gi, '');
  // HAVING COUNT(p.id) > 0 — SQLite soporta HAVING pero necesita alias
  return sql;
}

// ── Wrapper async (misma API que db-pg.js) ───────────────────
function createWrapper() {
  function sqliteAll(sql, params = []) {
    const stmt = sqlDb.prepare(sql);
    stmt.bind(params.flat());
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  }
  function sqliteGet(sql, params = []) {
    const stmt = sqlDb.prepare(sql);
    stmt.bind(params.flat());
    let result = null;
    if (stmt.step()) result = stmt.getAsObject();
    stmt.free();
    return result;
  }
  function sqliteRun(sql, params = []) {
    sqlDb.run(sql, params.flat());
    const rowid = sqlDb.exec('SELECT last_insert_rowid()');
    const lastID = rowid[0] ? rowid[0].values[0][0] : 0;
    saveDb();
    return { lastID, lastInsertRowid: lastID };
  }

  return {
    // API async (compatible con db-pg.js)
    async all(sql, params = [])  { return sqliteAll(toSqlite(sql), params); },
    async get(sql, params = [])  { return sqliteGet(toSqlite(sql), params); },
    async run(sql, params = [])  { return sqliteRun(toSqlite(sql), params); },
    async exec(sql)              { sqlDb.exec(toSqlite(sql)); saveDb(); },
    // Mantener prepare() para compatibilidad con código viejo (rutas no migradas)
    prepare(sql) {
      return {
        run:  (...args) => sqliteRun(sql, args),
        get:  (...args) => sqliteGet(sql, args),
        all:  (...args) => sqliteAll(sql, args),
      };
    }
  };
}

let dbWrapper = null;

function getDB() {
  if (!dbWrapper) throw new Error('Base de datos no inicializada');
  return dbWrapper;
}

async function initDB() {
  console.log('📂 Base de datos en:', DB_FILE);
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    const fileData = fs.readFileSync(DB_FILE);
    sqlDb = new SQL.Database(fileData);
    console.log('✅ Base de datos cargada');
  } else {
    sqlDb = new SQL.Database();
    console.log('✅ Base de datos nueva creada');
  }
  dbWrapper = createWrapper();
  createSchema();
  seedIfEmpty();
}

function createSchema() {
  sqlDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'consumer',
      points INTEGER DEFAULT 0,
      badge TEXT DEFAULT 'Nuevo Explorador',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      owner_id INTEGER,
      category TEXT DEFAULT 'Comercio General',
      verified INTEGER DEFAULT 0,
      status TEXT DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      brand TEXT,
      unit TEXT DEFAULT 'unidad',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price_id INTEGER NOT NULL,
      old_price REAL NOT NULL,
      new_price REAL NOT NULL,
      changed_by INTEGER NOT NULL,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      reaction_type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(price_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  saveDb();
}

function seedIfEmpty() {
  const stmt = sqlDb.prepare('SELECT COUNT(*) as c FROM products');
  stmt.step();
  const count = stmt.getAsObject().c;
  stmt.free();
  if (count > 0) return;

  const products = [
    ['Azúcar', 'azucar', 'Almacén', null, 'kg'],
    ['Aceite de girasol', 'aceite de girasol', 'Almacén', null, 'lt'],
    ['Arroz', 'arroz', 'Almacén', null, 'kg'],
    ['Leche entera', 'leche entera', 'Lácteos', null, 'lt'],
    ['Pan lactal', 'pan lactal', 'Panadería', null, 'unidad'],
    ['Yerba mate', 'yerba mate', 'Almacén', null, 'kg'],
    ['Harina 000', 'harina 000', 'Almacén', null, 'kg'],
    ['Fideos spaghetti', 'fideos spaghetti', 'Almacén', null, '500g'],
    ['Sal fina', 'sal fina', 'Almacén', null, 'kg'],
    ['Coca-Cola 1.5L', 'coca cola 1.5l', 'Bebidas', 'Coca-Cola', 'lt'],
    ['Agua mineral 2L', 'agua mineral 2l', 'Bebidas', null, 'lt'],
    ['Jabón en polvo', 'jabon en polvo', 'Limpieza', null, 'kg'],
    ['Papel higiénico x4', 'papel higienico x4', 'Higiene', null, 'pack'],
    ['Aceite de oliva', 'aceite de oliva', 'Almacén', null, '500ml'],
    ['Detergente', 'detergente', 'Limpieza', null, '750ml'],
  ];

  const businesses = [
    ['Almacén Don Carlos', 'Av. Corrientes 1200', -34.6037, -58.3816, null, 'Almacén', 1],
    ['Supermercado El Sol', 'Av. Santa Fe 3400', -34.5965, -58.4106, null, 'Supermercado', 1],
    ['Kiosco La Esquina', 'Av. Rivadavia 5000', -34.6158, -58.4333, null, 'Kiosco', 0],
    ['Verdulería Rosario', 'Av. Callao 450', -34.6097, -58.3927, null, 'Verdulería', 1],
    ['Minimarket 24hs', 'Av. Cabildo 2100', -34.5713, -58.4571, null, 'Minimarket', 1],
  ];

  // Seed users (contraseña: demo1234 para todos)
  const demoPass = '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'; // "password" bcrypt hash as placeholder
  sqlDb.run(`INSERT OR IGNORE INTO users (name, email, password, role, points, badge) VALUES
    ('María González', 'maria@comprecio.com', '${demoPass}', 'consumer', 340, 'Cazador Experto'),
    ('Carlos Fernández', 'carlos@comprecio.com', '${demoPass}', 'consumer', 185, 'Cazador de Precios'),
    ('Ana Martínez', 'ana@comprecio.com', '${demoPass}', 'consumer', 72, 'Reportero Activo'),
    ('Luis Rodríguez', 'luis@comprecio.com', '${demoPass}', 'consumer', 31, 'Colaborador'),
    ('Demo User', 'demo@comprecio.com', '${demoPass}', 'consumer', 50, 'Reportero Activo')
  `);

  products.forEach(p => sqlDb.run('INSERT INTO products (name, name_normalized, category, brand, unit) VALUES (?, ?, ?, ?, ?)', p));
  businesses.forEach(b => sqlDb.run('INSERT INTO businesses (name, address, lat, lng, owner_id, category, verified) VALUES (?, ?, ?, ?, ?, ?, ?)', b));

  // Seed some prices
  const demoUserId = 1;
  sqlDb.run("INSERT INTO prices (product_id, business_id, reported_by, price, confirmed_count, updated_at) VALUES (1, 1, ?, 1850.00, 3, datetime('now', '-1 hour'))", [demoUserId]);
  sqlDb.run("INSERT INTO prices (product_id, business_id, reported_by, price, confirmed_count, updated_at) VALUES (1, 2, ?, 1790.00, 5, datetime('now', '-2 hours'))", [demoUserId]);
  sqlDb.run("INSERT INTO prices (product_id, business_id, reported_by, price, confirmed_count, updated_at) VALUES (2, 1, ?, 2100.00, 2, datetime('now', '-30 minutes'))", [demoUserId]);
  sqlDb.run("INSERT INTO prices (product_id, business_id, reported_by, price, confirmed_count, updated_at) VALUES (2, 2, ?, 1950.00, 7, datetime('now', '-5 hours'))", [demoUserId]);
  sqlDb.run("INSERT INTO prices (product_id, business_id, reported_by, price, confirmed_count, updated_at) VALUES (3, 3, ?, 1200.00, 1, datetime('now', '-1 day'))", [demoUserId]);
  sqlDb.run("INSERT INTO prices (product_id, business_id, reported_by, price, is_promotion, confirmed_count, updated_at) VALUES (4, 2, ?, 1450.00, 1, 4, datetime('now', '-3 hours'))", [demoUserId]);
  sqlDb.run("INSERT INTO prices (product_id, business_id, reported_by, price, confirmed_count, updated_at) VALUES (5, 1, ?, 980.00, 2, datetime('now', '-2 days'))", [demoUserId]);
  sqlDb.run("INSERT INTO prices (product_id, business_id, reported_by, price, confirmed_count, updated_at) VALUES (6, 4, ?, 3200.00, 6, datetime('now', '-4 hours'))", [demoUserId]);

  saveDb();
  console.log('🌱 Datos de ejemplo cargados');
}

module.exports = { getDB, initDB };
