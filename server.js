require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./src/db');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth',       require('./src/routes/auth'));
app.use('/api/products',   require('./src/routes/products'));
app.use('/api/businesses', require('./src/routes/businesses'));
app.use('/api/prices',     require('./src/routes/prices'));
app.use('/api/ranking',    require('./src/routes/ranking'));
app.use('/api/admin',      require('./src/routes/admin'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Para desarrollo local: init DB y levantar servidor
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  initDB().then(() => {
    app.listen(PORT, () => {
      console.log(`\n🟢 Comprecio corriendo en http://localhost:${PORT}\n`);
    });
  }).catch(err => {
    console.error('Error iniciando DB:', err);
    process.exit(1);
  });
}

// Para Vercel: exportar app después de init DB
let ready = false;
const appWithInit = async (req, res) => {
  if (!ready) {
    await initDB();
    ready = true;
  }
  app(req, res);
};

module.exports = appWithInit;
