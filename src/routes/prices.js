const express = require('express');
const { getDB } = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');

const router = express.Router();

async function updateBadge(db, userId) {
  const user = await db.get('SELECT points FROM users WHERE id = ?', [userId]);
  let badge = 'Nuevo Explorador';
  if (user.points >= 500)      badge = 'Maestro de Precios';
  else if (user.points >= 200) badge = 'Cazador Experto';
  else if (user.points >= 100) badge = 'Cazador de Precios';
  else if (user.points >= 50)  badge = 'Reportero Activo';
  else if (user.points >= 20)  badge = 'Colaborador';
  await db.run('UPDATE users SET badge = ? WHERE id = ?', [badge, userId]);
}

// GET /api/prices?product_id=&business_id=
router.get('/', authOptional, async (req, res) => {
  try {
    const db = getDB();
    const { product_id, business_id } = req.query;

    let sql = `
      SELECT p.*, pr.name as product_name, pr.unit, pr.category, pr.brand,
        b.name as business_name, b.address, b.lat, b.lng, b.verified,
        u.name as reporter_name, u.badge as reporter_badge, u.points as reporter_points
      FROM prices p
      JOIN products pr ON p.product_id = pr.id
      JOIN businesses b ON p.business_id = b.id
      JOIN users u ON p.reported_by = u.id
      WHERE p.status = 'active'
    `;
    const params = [];
    if (product_id)  { sql += ' AND p.product_id = ?';  params.push(product_id); }
    if (business_id) { sql += ' AND p.business_id = ?'; params.push(business_id); }
    sql += ' ORDER BY p.price ASC';

    const prices = await db.all(sql, params);

    if (req.user) {
      const userId = req.user.id;
      const withReactions = await Promise.all(prices.map(async p => {
        const reaction = await db.get(
          'SELECT reaction_type FROM reactions WHERE price_id = ? AND user_id = ?',
          [p.id, userId]
        );
        return { ...p, my_reaction: reaction ? reaction.reaction_type : null };
      }));
      return res.json(withReactions);
    }

    res.json(prices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prices — crear o actualizar con deduplicación
router.post('/', authRequired, async (req, res) => {
  const { product_id, business_id, price, is_promotion, promotion_ends } = req.body;
  if (!product_id || !business_id || price === undefined) {
    return res.status(400).json({ error: 'Faltan campos: product_id, business_id, price' });
  }

  try {
    const db = getDB();
    const existing = await db.get(
      'SELECT * FROM prices WHERE product_id = ? AND business_id = ?',
      [product_id, business_id]
    );

    if (!existing) {
      // NUEVO precio
      const result = await db.run(
        'INSERT INTO prices (product_id, business_id, reported_by, price, is_promotion, promotion_ends) VALUES (?, ?, ?, ?, ?, ?)',
        [product_id, business_id, req.user.id, price, is_promotion ? 1 : 0, promotion_ends || null]
      );
      await db.run('UPDATE users SET points = points + 10 WHERE id = ?', [req.user.id]);
      await updateBadge(db, req.user.id);

      const newPrice = await db.get(`
        SELECT p.*, pr.name as product_name, pr.unit, b.name as business_name
        FROM prices p JOIN products pr ON p.product_id = pr.id JOIN businesses b ON p.business_id = b.id
        WHERE p.id = ?
      `, [result.lastID]);

      return res.status(201).json({ action: 'created', price: newPrice, points_earned: 10 });
    }

    const existingPrice = parseFloat(existing.price);
    const newPriceVal  = parseFloat(price);

    if (Math.abs(existingPrice - newPriceVal) < 0.01) {
      // MISMO precio — confirmar
      await db.run('UPDATE prices SET confirmed_count = confirmed_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [existing.id]);

      const existingReaction = await db.get('SELECT id FROM reactions WHERE price_id = ? AND user_id = ?', [existing.id, req.user.id]);
      if (existingReaction) {
        await db.run("UPDATE reactions SET reaction_type = 'confirmed', created_at = CURRENT_TIMESTAMP WHERE price_id = ? AND user_id = ?", [existing.id, req.user.id]);
      } else {
        await db.run("INSERT INTO reactions (price_id, user_id, reaction_type) VALUES (?, ?, 'confirmed')", [existing.id, req.user.id]);
      }
      await db.run('UPDATE users SET points = points + 3 WHERE id = ?', [req.user.id]);
      await updateBadge(db, req.user.id);

      return res.json({ action: 'confirmed', message: 'Precio confirmado. ¡Gracias!', points_earned: 3 });
    }

    // PRECIO DISTINTO — actualizar con historial
    await db.run('INSERT INTO price_history (price_id, old_price, new_price, changed_by) VALUES (?, ?, ?, ?)', [existing.id, existing.price, price, req.user.id]);

    const trend = newPriceVal > existingPrice ? 'up' : 'down';
    await db.run(`
      UPDATE prices SET price = ?, is_promotion = ?, promotion_ends = ?,
        reported_by = ?, updated_at = CURRENT_TIMESTAMP, status = 'active',
        confirmed_count = 0, disputed_count = 0
      WHERE id = ?
    `, [price, is_promotion ? 1 : 0, promotion_ends || null, req.user.id, existing.id]);

    await db.run('UPDATE users SET points = points + 8 WHERE id = ?', [req.user.id]);
    await updateBadge(db, req.user.id);

    const updated = await db.get(`
      SELECT p.*, pr.name as product_name, pr.unit, b.name as business_name
      FROM prices p JOIN products pr ON p.product_id = pr.id JOIN businesses b ON p.business_id = b.id
      WHERE p.id = ?
    `, [existing.id]);

    return res.json({ action: 'updated', trend, old_price: existingPrice, price: updated, points_earned: 8, message: `Precio ${trend === 'up' ? 'subió' : 'bajó'} de $${existingPrice} a $${price}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prices/:id/react
router.post('/:id/react', authRequired, async (req, res) => {
  const { reaction_type } = req.body;
  const validReactions = ['confirmed', 'disputed', 'out_of_stock', 'on_promotion', 'store_closed'];
  if (!validReactions.includes(reaction_type)) return res.status(400).json({ error: 'Reacción inválida' });

  try {
    const db = getDB();
    const price = await db.get('SELECT * FROM prices WHERE id = ?', [req.params.id]);
    if (!price) return res.status(404).json({ error: 'Precio no encontrado' });

    const existingR = await db.get('SELECT id FROM reactions WHERE price_id = ? AND user_id = ?', [price.id, req.user.id]);
    if (existingR) {
      await db.run('UPDATE reactions SET reaction_type = ?, created_at = CURRENT_TIMESTAMP WHERE price_id = ? AND user_id = ?', [reaction_type, price.id, req.user.id]);
    } else {
      await db.run('INSERT INTO reactions (price_id, user_id, reaction_type) VALUES (?, ?, ?)', [price.id, req.user.id, reaction_type]);
    }

    const confirmed  = (await db.get("SELECT COUNT(*) as c FROM reactions WHERE price_id = ? AND reaction_type = 'confirmed'",  [price.id])).c;
    const disputed   = (await db.get("SELECT COUNT(*) as c FROM reactions WHERE price_id = ? AND reaction_type = 'disputed'",   [price.id])).c;
    const outOfStock = (await db.get("SELECT COUNT(*) as c FROM reactions WHERE price_id = ? AND reaction_type = 'out_of_stock'",[price.id])).c;

    let status = 'active';
    if (parseInt(outOfStock) >= 3) status = 'out_of_stock';
    else if (parseInt(disputed) > parseInt(confirmed) && parseInt(disputed) >= 3) status = 'unverified';

    await db.run('UPDATE prices SET confirmed_count = ?, disputed_count = ?, out_of_stock = ?, status = ? WHERE id = ?',
      [confirmed, disputed, outOfStock > 0 ? 1 : 0, status, price.id]);

    if (reaction_type === 'confirmed' || reaction_type === 'disputed') {
      await db.run('UPDATE users SET points = points + 2 WHERE id = ?', [req.user.id]);
      await updateBadge(db, req.user.id);
    }

    res.json({ success: true, reaction_type, confirmed, disputed, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/prices/:id/history
router.get('/:id/history', async (req, res) => {
  try {
    const db = getDB();
    const history = await db.all(
      'SELECT * FROM price_history WHERE price_id = ? ORDER BY changed_at DESC LIMIT 10',
      [req.params.id]
    );
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
