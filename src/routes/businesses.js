const express = require('express');
const { getDB } = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');

const router = express.Router();

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// GET /api/businesses/merchant/my — debe ir ANTES de /:id
router.get('/merchant/my', authRequired, async (req, res) => {
  if (req.user.role !== 'merchant') return res.status(403).json({ error: 'Solo para comerciantes' });
  try {
    const db = getDB();
    const businesses = await db.all('SELECT * FROM businesses WHERE owner_id = ?', [req.user.id]);
    res.json(businesses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses?lat=&lng=&radius=
router.get('/', authOptional, async (req, res) => {
  try {
    const db = getDB();
    const { lat, lng, radius = 10, search } = req.query;

    let businesses = await db.all(`
      SELECT b.*, u.name as owner_name,
        (SELECT COUNT(*) FROM prices p WHERE p.business_id = b.id AND p.status = 'active') as price_count
      FROM businesses b
      LEFT JOIN users u ON b.owner_id = u.id
      ORDER BY b.verified DESC, b.name
    `);

    if (search) {
      businesses = businesses.filter(b =>
        b.name.toLowerCase().includes(search.toLowerCase()) ||
        (b.address && b.address.toLowerCase().includes(search.toLowerCase()))
      );
    }

    if (lat && lng) {
      const userLat = parseFloat(lat), userLng = parseFloat(lng);
      const maxR = parseFloat(radius);
      businesses = businesses
        .map(b => ({ ...b, distance: haversine(userLat, userLng, b.lat, b.lng) }))
        .filter(b => b.distance <= maxR)
        .sort((a, b) => a.distance - b.distance);
    }

    res.json(businesses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:id
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const business = await db.get(
      'SELECT b.*, u.name as owner_name FROM businesses b LEFT JOIN users u ON b.owner_id = u.id WHERE b.id = ?',
      [req.params.id]
    );
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });

    const prices = await db.all(`
      SELECT p.*, pr.name as product_name, pr.unit, pr.category, u.name as reporter_name
      FROM prices p
      JOIN products pr ON p.product_id = pr.id
      JOIN users u ON p.reported_by = u.id
      WHERE p.business_id = ? AND p.status = 'active'
      ORDER BY pr.category, pr.name
    `, [req.params.id]);

    const comments = await db.all(`
      SELECT c.*, u.name as user_name FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.business_id = ? ORDER BY c.created_at DESC LIMIT 10
    `, [req.params.id]);

    res.json({ ...business, prices, comments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/businesses
router.post('/', authRequired, async (req, res) => {
  const { name, address, lat, lng, category } = req.body;
  if (!name || !lat || !lng) return res.status(400).json({ error: 'Faltan campos obligatorios' });

  try {
    const db = getDB();
    const existing = await db.all('SELECT * FROM businesses');
    const duplicate = existing.find(b =>
      haversine(lat, lng, b.lat, b.lng) < 0.03 &&
      b.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) return res.status(409).json({ error: 'Ya existe un negocio con ese nombre en esa ubicación', existing: duplicate });

    const isMerchant = req.user.role === 'merchant';
    const result = await db.run(
      'INSERT INTO businesses (name, address, lat, lng, owner_id, category, verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, address || null, lat, lng, isMerchant ? req.user.id : null, category || 'Comercio General', isMerchant ? 1 : 0]
    );
    const business = await db.get('SELECT * FROM businesses WHERE id = ?', [result.lastID]);
    res.status(201).json(business);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/businesses/:id — editar (requiere 50+ pts)
router.patch('/:id', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user || user.points < 50) {
      return res.status(403).json({ error: 'Necesitás al menos 50 puntos para editar negocios', required: 50, current: user ? user.points : 0 });
    }
    const biz = await db.get('SELECT * FROM businesses WHERE id = ?', [req.params.id]);
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });

    const { name, address, category } = req.body;
    await db.run(
      'UPDATE businesses SET name = ?, address = ?, category = ? WHERE id = ?',
      [name || biz.name, address !== undefined ? address : biz.address, category || biz.category, req.params.id]
    );
    const updated = await db.get('SELECT * FROM businesses WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/businesses/:id/verify — verificar (requiere 200+ pts)
router.post('/:id/verify', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user || user.points < 200) {
      return res.status(403).json({ error: 'Necesitás al menos 200 puntos para verificar negocios', required: 200, current: user ? user.points : 0 });
    }
    const biz = await db.get('SELECT * FROM businesses WHERE id = ?', [req.params.id]);
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (biz.verified) return res.status(400).json({ error: 'Este negocio ya está verificado' });

    await db.run('UPDATE businesses SET verified = 1 WHERE id = ?', [req.params.id]);
    await db.run('UPDATE users SET points = points + 15 WHERE id = ?', [req.user.id]);
    res.json({ success: true, message: '¡Negocio verificado! +15 puntos' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/businesses/:id/comment
router.post('/:id/comment', authRequired, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'El comentario no puede estar vacío' });
  try {
    const db = getDB();
    const result = await db.run(
      'INSERT INTO comments (business_id, user_id, text) VALUES (?, ?, ?)',
      [req.params.id, req.user.id, text]
    );
    const comment = await db.get(
      'SELECT c.*, u.name as user_name FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?',
      [result.lastID]
    );
    res.status(201).json(comment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
