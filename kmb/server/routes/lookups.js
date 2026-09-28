const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, EDIT_ROSTER_ROLES } = require('../middleware/auth');

const router = express.Router();

// Фабрика простого CRUD для справочной таблицы (ranks / positions / units)
function crudFor(table) {
  const r = express.Router();

  r.get('/', requireAuth, async (req, res) => {
    const { rows } = await db.query(`SELECT * FROM ${table} ORDER BY sort_order, name`);
    res.json(rows);
  });

  r.post('/', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
    const { name, sort_order = 0 } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название' });
    try {
      const { rows } = await db.query(
        `INSERT INTO ${table} (name, sort_order) VALUES ($1,$2) RETURNING *`,
        [name.trim(), sort_order]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Такое значение уже существует' });
      console.error(err);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  r.put('/:id', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
    const { name, sort_order } = req.body;
    const { rows } = await db.query(
      `UPDATE ${table} SET name=COALESCE($1,name), sort_order=COALESCE($2,sort_order) WHERE id=$3 RETURNING *`,
      [name, sort_order, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  });

  r.delete('/:id', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
    await db.query(`DELETE FROM ${table} WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  });

  return r;
}

router.use('/ranks', crudFor('ranks'));
router.use('/positions', crudFor('positions'));
router.use('/units', crudFor('units'));

module.exports = router;
