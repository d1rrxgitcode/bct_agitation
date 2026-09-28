const express = require('express');
const db = require('../db');
const { requireAuth, EDIT_ROSTER_ROLES, isRosterEditor } = require('../middleware/auth');

const router = express.Router();

const TYPES = ['agitation', 'training', 'recon', 'combat'];
const LABELS = { agitation: 'Агитации', training: 'Тренировки', recon: 'Разведки', combat: 'Боевые действия' };

router.get('/', requireAuth, async (req, res) => {
  const { type, from, to, personnel_id, mine } = req.query;
  const where = [];
  const params = [];
  if (type) { params.push(type); where.push(`a.type=$${params.length}`); }
  if (from) { params.push(from); where.push(`a.activity_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`a.activity_date <= $${params.length}`); }
  if (personnel_id) {
    params.push(personnel_id);
    where.push(`a.personnel_id = $${params.length}`);
  }
  if (mine === 'true') {
    params.push(req.session.user.id);
    where.push(`a.conducted_by = $${params.length}`);
  }
  const sql = `SELECT a.*, u.username AS conducted_by_name, p.callsign AS personnel_callsign
               FROM activities a
               LEFT JOIN users u ON u.id = a.conducted_by
               LEFT JOIN personnel p ON p.id = a.personnel_id
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY a.activity_date DESC, a.id DESC`;
  const { rows } = await db.query(sql, params);
  res.json(rows);
});

router.post('/', requireAuth, async (req, res) => {
  const { type, title, activity_date, notes, personnel_id } = req.body;
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'Некорректный тип активности' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'Укажите название' });

  let pid = personnel_id || req.session.user.personnel_id || null;
  if (personnel_id && !isRosterEditor(req.session.user)
      && String(personnel_id) !== String(req.session.user.personnel_id)) {
    return res.status(403).json({ error: 'Можно записывать только свою активность' });
  }

  const { rows } = await db.query(
    `INSERT INTO activities (type, title, activity_date, conducted_by, personnel_id, notes)
     VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6) RETURNING *`,
    [type, title.trim(), activity_date || null, req.session.user.id, pid, notes || null]
  );
  res.status(201).json(rows[0]);
});

router.get('/summary/counts', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT type, COUNT(*)::int AS count FROM activities GROUP BY type`
  );
  const result = {};
  TYPES.forEach((t) => { result[t] = { label: LABELS[t], count: 0 }; });
  rows.forEach((r) => { if (result[r.type]) result[r.type].count = r.count; });

  const totalPersonnel = await db.query('SELECT COUNT(*)::int AS c FROM personnel');
  const mercCount = await db.query('SELECT COUNT(*)::int AS c FROM personnel WHERE mercenary=TRUE');
  const byUnit = await db.query(
    `SELECT COALESCE(u.name, 'Без подразделения') AS name, COUNT(*)::int AS count
     FROM personnel p LEFT JOIN units u ON u.id = p.unit_id
     GROUP BY u.name ORDER BY count DESC`
  );

  res.json({
    activities: result,
    total_personnel: totalPersonnel.rows[0].c,
    mercenaries: mercCount.rows[0].c,
    by_unit: byUnit.rows,
  });
});

router.get('/summary/series', requireAuth, async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 180);
  const { rows } = await db.query(
    `SELECT activity_date::text AS date, type, COUNT(*)::int AS count
     FROM activities
     WHERE activity_date >= (CURRENT_DATE - $1::int)
     GROUP BY activity_date, type
     ORDER BY activity_date`,
    [days]
  );
  res.json({ days, types: TYPES, labels: LABELS, points: rows });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT conducted_by FROM activities WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
  const own = String(rows[0].conducted_by) === String(req.session.user.id);
  if (!own && !isRosterEditor(req.session.user)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  await db.query('DELETE FROM activities WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
