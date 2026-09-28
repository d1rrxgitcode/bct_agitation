const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, EDIT_ROSTER_ROLES } = require('../middleware/auth');

const router = express.Router();

// Проверка видимости категории для текущего пользователя
function canSeeCategory(cat, user, userUnitId) {
  if (['commander', 'deputy'].includes(user.role)) return true; // командование видит всё
  switch (cat.visibility) {
    case 'all': return true;
    case 'command_mod': return ['commander', 'deputy', 'moderator'].includes(user.role);
    case 'unit': return cat.visible_unit_id && cat.visible_unit_id === userUnitId;
    case 'custom': return (cat.visible_roles || []).includes(user.role);
    default: return false;
  }
}

router.get('/categories', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM doc_categories ORDER BY sort_order, name');
  let userUnitId = null;
  if (req.session.user.personnel_id) {
    const p = await db.query('SELECT unit_id FROM personnel WHERE id=$1', [req.session.user.personnel_id]);
    userUnitId = p.rows[0]?.unit_id || null;
  }
  const visible = rows.filter((c) => canSeeCategory(c, req.session.user, userUnitId));
  res.json(visible);
});

router.post('/categories', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
  const { name, parent_id, visibility = 'all', visible_unit_id, visible_roles, sort_order = 0 } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название категории' });
  const { rows } = await db.query(
    `INSERT INTO doc_categories (name, parent_id, visibility, visible_unit_id, visible_roles, sort_order, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name.trim(), parent_id || null, visibility, visible_unit_id || null, visible_roles || null, sort_order, req.session.user.id]
  );
  res.status(201).json(rows[0]);
});

router.put('/categories/:id', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
  const { name, parent_id, visibility, visible_unit_id, visible_roles, sort_order } = req.body;
  const { rows } = await db.query(
    `UPDATE doc_categories SET
       name=COALESCE($1,name), parent_id=$2, visibility=COALESCE($3,visibility),
       visible_unit_id=$4, visible_roles=$5, sort_order=COALESCE($6,sort_order)
     WHERE id=$7 RETURNING *`,
    [name, parent_id || null, visibility, visible_unit_id || null, visible_roles || null, sort_order, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
  res.json(rows[0]);
});

router.delete('/categories/:id', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
  await db.query('DELETE FROM doc_categories WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

router.get('/categories/:id/documents', requireAuth, async (req, res) => {
  const cat = await db.query('SELECT * FROM doc_categories WHERE id=$1', [req.params.id]);
  if (!cat.rows[0]) return res.status(404).json({ error: 'Категория не найдена' });

  let userUnitId = null;
  if (req.session.user.personnel_id) {
    const p = await db.query('SELECT unit_id FROM personnel WHERE id=$1', [req.session.user.personnel_id]);
    userUnitId = p.rows[0]?.unit_id || null;
  }
  if (!canSeeCategory(cat.rows[0], req.session.user, userUnitId)) {
    return res.status(403).json({ error: 'Нет доступа к этой категории' });
  }

  const { rows } = await db.query(
    'SELECT * FROM documents WHERE category_id=$1 ORDER BY created_at DESC',
    [req.params.id]
  );
  res.json(rows);
});

router.get('/documents/:id', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM documents WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
  res.json(rows[0]);
});

router.post('/categories/:catId/documents', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
  const { title, content = '' } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Укажите заголовок' });
  const { rows } = await db.query(
    `INSERT INTO documents (category_id, title, content, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.catId, title.trim(), content, req.session.user.id]
  );
  res.status(201).json(rows[0]);
});

router.put('/documents/:id', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
  const { title, content } = req.body;
  const { rows } = await db.query(
    `UPDATE documents SET title=COALESCE($1,title), content=COALESCE($2,content), updated_at=now()
     WHERE id=$3 RETURNING *`,
    [title, content, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
  res.json(rows[0]);
});

router.delete('/documents/:id', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
  await db.query('DELETE FROM documents WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
