const express = require('express');
const { getDB } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// GET /api/products/categories — debe ir ANTES de /:id
router.get('/categories', async (req, res) => {
  try {
    const db = getDB();
    const cats = await db.all('SELECT DISTINCT category FROM products ORDER BY category');
    res.json(cats.map(c => c.category));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products?search=azucar
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const { search } = req.query;
    let products;
    if (search) {
      const q = `%${search.toLowerCase()}%`;
      products = await db.all(
        'SELECT * FROM products WHERE name_normalized LIKE ? OR name LIKE ? ORDER BY name',
        [q, q]
      );
    } else {
      products = await db.all('SELECT * FROM products ORDER BY category, name');
    }
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products
router.post('/', authRequired, async (req, res) => {
  const { name, category, brand, unit } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es requerido' });

  try {
    const db = getDB();
    const normalized = name.toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const existing = await db.get('SELECT * FROM products WHERE name_normalized = ?', [normalized]);
    if (existing) return res.json({ ...existing, already_existed: true });

    const result = await db.run(
      'INSERT INTO products (name, name_normalized, category, brand, unit) VALUES (?, ?, ?, ?, ?)',
      [name.trim(), normalized, category || 'General', brand || null, unit || 'unidad']
    );
    const product = await db.get('SELECT * FROM products WHERE id = ?', [result.lastID]);
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
