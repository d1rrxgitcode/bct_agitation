const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireRole, ADMIN_ROLES } = require('../middleware/auth');

const router = express.Router();
const ROLES = ['commander', 'deputy', 'moderator', 'member'];

router.get('/users', requireRole(...ADMIN_ROLES), async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.role, u.is_active, u.created_at, u.personnel_id,
            p.callsign AS personnel_callsign
     FROM users u LEFT JOIN personnel p ON p.id = u.personnel_id
     ORDER BY u.created_at DESC`
  );
  res.json(rows);
});

router.post('/users', requireRole(...ADMIN_ROLES), async (req, res) => {
  const { username, password, role, personnel_id } = req.body;
  if (!username || !password || !ROLES.includes(role)) {
    return res.status(400).json({ error: 'Заполните логин, пароль и корректную привилегию' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, role, personnel_id) VALUES ($1,$2,$3,$4)
       RETURNING id, username, role, is_active, created_at, personnel_id`,
      [username.trim(), hash, role, personnel_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Такой логин уже занят' });
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.put('/users/:id', requireRole(...ADMIN_ROLES), async (req, res) => {
  const { role, is_active, personnel_id, password } = req.body;
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Некорректная привилегия' });

  let hash = null;
  if (password) hash = await bcrypt.hash(password, 10);

  const { rows } = await db.query(
    `UPDATE users SET
       role=COALESCE($1,role),
       is_active=COALESCE($2,is_active),
       personnel_id=$3,
       password_hash=COALESCE($4,password_hash)
     WHERE id=$5
     RETURNING id, username, role, is_active, created_at, personnel_id`,
    [role, is_active, personnel_id === undefined ? null : personnel_id, hash, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
  res.json(rows[0]);
});

router.delete('/users/:id', requireRole(...ADMIN_ROLES), async (req, res) => {
  if (String(req.session.user.id) === String(req.params.id)) {
    return res.status(400).json({ error: 'Нельзя удалить самого себя' });
  }
  await db.query('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
