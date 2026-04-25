const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// Middleware: solo admins
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
}

router.use(authRequired, adminOnly);

// ── STATS GENERALES ───────────────────────────────
// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const db = getDB();
    const [users, businesses, products, prices, pricesHoy, reacciones] = await Promise.all([
      db.get('SELECT COUNT(*) as n FROM users'),
      db.get('SELECT COUNT(*) as n FROM businesses'),
      db.get('SELECT COUNT(*) as n FROM products'),
      db.get('SELECT COUNT(*) as n FROM prices'),
      db.get("SELECT COUNT(*) as n FROM prices WHERE created_at >= datetime('now', '-1 day')"),
      db.get('SELECT COUNT(*) as n FROM reactions'),
    ]);
    res.json({
      users: users.n,
      businesses: businesses.n,
      products: products.n,
      prices: prices.n,
      prices_hoy: pricesHoy.n,
      reacciones: reacciones.n,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── USUARIOS ──────────────────────────────────────
// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const db = getDB();
    const users = await db.all(`
      SELECT u.id, u.name, u.email, u.role, u.points, u.badge, u.blocked, u.created_at,
             COUNT(DISTINCT p.id) as prices_count,
             COUNT(DISTINCT r.id) as reactions_count
      FROM users u
      LEFT JOIN prices p ON p.reported_by = u.id
      LEFT JOIN reactions r ON r.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/users/:id
router.patch('/users/:id', async (req, res) => {
  const { name, email, role, points, badge, blocked } = req.body;
  try {
    const db = getDB();
    const user = await db.get('SELECT id FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const fields = [];
    const vals = [];
    if (name !== undefined)    { fields.push('name = ?');    vals.push(name); }
    if (email !== undefined)   { fields.push('email = ?');   vals.push(email.toLowerCase().trim()); }
    if (role !== undefined)    { fields.push('role = ?');    vals.push(role); }
    if (points !== undefined)  { fields.push('points = ?');  vals.push(parseInt(points)); }
    if (badge !== undefined)   { fields.push('badge = ?');   vals.push(badge); }
    if (blocked !== undefined) { fields.push('blocked = ?'); vals.push(blocked ? 1 : 0); }

    if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar' });
    vals.push(req.params.id);
    await db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, vals);
    const updated = await db.get('SELECT id, name, email, role, points, badge, blocked FROM users WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  try {
    const db = getDB();
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'No podés eliminarte a vos mismo' });
    }
    await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/:id/reset-password
router.post('/users/:id/reset-password', async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  try {
    const db = getDB();
    const hash = await bcrypt.hash(newPassword, 10);
    await db.run('UPDATE users SET password = ? WHERE id = ?', [hash, req.params.id]);
    res.json({ ok: true, message: 'Contraseña restaurada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ACTIVIDAD RECIENTE ────────────────────────────
// GET /api/admin/activity
router.get('/activity', async (req, res) => {
  try {
    const db = getDB();
    const prices = await db.all(`
      SELECT p.id, p.price, p.created_at, p.status, p.is_promotion,
             pr.name as product_name,
             b.name as business_name,
             u.name as user_name, u.id as user_id
      FROM prices p
      JOIN products pr ON pr.id = p.product_id
      JOIN businesses b ON b.id = p.business_id
      JOIN users u ON u.id = p.reported_by
      ORDER BY p.created_at DESC
      LIMIT 50
    `);
    res.json(prices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PRECIOS ───────────────────────────────────────
// DELETE /api/admin/prices/:id
router.delete('/prices/:id', async (req, res) => {
  try {
    const db = getDB();
    await db.run('DELETE FROM prices WHERE id = ?', [req.params.id]);
    await db.run('DELETE FROM reactions WHERE price_id = ?', [req.params.id]);
    await db.run('DELETE FROM price_history WHERE price_id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── NEGOCIOS ──────────────────────────────────────
// GET /api/admin/businesses
router.get('/businesses', async (req, res) => {
  try {
    const db = getDB();
    const bizs = await db.all(`
      SELECT b.*, u.name as owner_name,
             COUNT(p.id) as prices_count
      FROM businesses b
      LEFT JOIN users u ON u.id = b.owner_id
      LEFT JOIN prices p ON p.business_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `);
    res.json(bizs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/businesses/:id
router.delete('/businesses/:id', async (req, res) => {
  try {
    const db = getDB();
    await db.run('DELETE FROM businesses WHERE id = ?', [req.params.id]);
    await db.run('DELETE FROM prices WHERE business_id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/businesses/:id
router.patch('/businesses/:id', async (req, res) => {
  const { name, address, category, verified, status } = req.body;
  try {
    const db = getDB();
    const fields = [];
    const vals = [];
    if (name !== undefined)     { fields.push('name = ?');     vals.push(name); }
    if (address !== undefined)  { fields.push('address = ?');  vals.push(address); }
    if (category !== undefined) { fields.push('category = ?'); vals.push(category); }
    if (verified !== undefined) { fields.push('verified = ?'); vals.push(verified ? 1 : 0); }
    if (status !== undefined)   { fields.push('status = ?');   vals.push(status); }
    if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar' });
    vals.push(req.params.id);
    await db.run(`UPDATE businesses SET ${fields.join(', ')} WHERE id = ?`, vals);
    const updated = await db.get('SELECT * FROM businesses WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
