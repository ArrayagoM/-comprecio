const express = require('express');
const { getDB } = require('../db');

const router = express.Router();

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// GET /api/ranking?product_id=&category=&limit=&lat=&lng=&radius=
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const { product_id, category, limit = 20, lat, lng, radius = 5 } = req.query;

    let sql = `
      SELECT p.id, p.price, p.currency, p.is_promotion, p.promotion_ends,
        p.confirmed_count, p.disputed_count, p.out_of_stock, p.status, p.updated_at,
        pr.name as product_name, pr.unit, pr.category, pr.brand,
        b.id as business_id, b.name as business_name, b.address,
        b.lat, b.lng, b.verified, b.category as business_category,
        u.name as reporter_name,
        CASE WHEN p.updated_at > CURRENT_TIMESTAMP - INTERVAL '24 hours' THEN 'fresh'
             WHEN p.updated_at > CURRENT_TIMESTAMP - INTERVAL '72 hours' THEN 'recent'
             ELSE 'old' END as freshness
      FROM prices p
      JOIN products pr ON p.product_id = pr.id
      JOIN businesses b ON p.business_id = b.id
      JOIN users u ON p.reported_by = u.id
      WHERE p.status = 'active'
    `;
    const params = [];
    if (product_id) { sql += ' AND p.product_id = ?'; params.push(product_id); }
    if (category)   { sql += ' AND pr.category = ?';  params.push(category); }
    sql += ' ORDER BY pr.name, p.price ASC LIMIT ?';
    params.push(parseInt(limit));

    let prices = await db.all(sql, params);

    if (lat && lng) {
      const uLat = parseFloat(lat), uLng = parseFloat(lng), maxKm = parseFloat(radius);
      prices = prices.filter(p => p.lat && p.lng && haversineKm(uLat, uLng, p.lat, p.lng) <= maxKm);
    }

    res.json(prices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ranking/users — top usuarios
router.get('/users', async (req, res) => {
  try {
    const db = getDB();
    const users = await db.all(`
      SELECT id, name, role, points, badge,
        (SELECT COUNT(*) FROM prices WHERE reported_by = users.id) as reports_count
      FROM users ORDER BY points DESC LIMIT 10
    `);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ranking/businesses
router.get('/businesses', async (req, res) => {
  try {
    const db = getDB();
    const businesses = await db.all(`
      SELECT b.*,
        COUNT(p.id) as product_count,
        AVG(p.price) as avg_price,
        SUM(p.confirmed_count) as total_confirmations
      FROM businesses b
      LEFT JOIN prices p ON p.business_id = b.id AND p.status = 'active'
      GROUP BY b.id, b.name, b.address, b.lat, b.lng, b.owner_id, b.category, b.verified, b.status, b.created_at
      HAVING COUNT(p.id) > 0
      ORDER BY total_confirmations DESC, product_count DESC
      LIMIT 10
    `);
    res.json(businesses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
