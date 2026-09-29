const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, isRosterEditor } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const EXT_BY_MIME = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', gif: 'gif' };

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function parseDataUrl(data) {
  if (typeof data !== 'string') return null;
  const m = data.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
  return { ext: EXT_BY_MIME[m[1]] || 'png', buf };
}

async function loadActivity(id) {
  const { rows } = await db.query(
    `SELECT a.*, t.name AS type_name, u.username AS conducted_by_name,
            cp.callsign AS conductor_name
     FROM activities a
     LEFT JOIN activity_types t ON t.id = a.type_id
     LEFT JOIN users u ON u.id = a.conducted_by
     LEFT JOIN personnel cp ON cp.id = a.conductor_id
     WHERE a.id=$1`, [id]
  );
  return rows[0] || null;
}

async function attachCollections(ids) {
  if (!ids.length) return { participants: {}, images: {} };
  const p = await db.query(
    `SELECT ap.activity_id, p.id, p.callsign, p.idn
     FROM activity_participants ap
     JOIN personnel p ON p.id = ap.personnel_id
     WHERE ap.activity_id = ANY($1::int[])
     ORDER BY p.callsign`, [ids]
  );
  const im = await db.query(
    `SELECT id, activity_id, path FROM activity_images
     WHERE activity_id = ANY($1::int[]) ORDER BY id`, [ids]
  );
  const participants = {};
  const images = {};
  p.rows.forEach(r => {
    (participants[r.activity_id] = participants[r.activity_id] || []).push({ id: r.id, callsign: r.callsign, idn: r.idn });
  });
  im.rows.forEach(r => {
    (images[r.activity_id] = images[r.activity_id] || []).push({ id: r.id, path: r.path });
  });
  return { participants, images };
}

router.get('/', requireAuth, async (req, res) => {
  const { type_id, personnel_id, from, to, mine } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const where = [];
  const params = [];
  if (type_id) { params.push(type_id); where.push(`a.type_id = $${params.length}`); }
  if (from) { params.push(from); where.push(`a.activity_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`a.activity_date <= $${params.length}`); }
  if (mine === 'true') { params.push(req.session.user.id); where.push(`a.conducted_by = $${params.length}`); }
  if (personnel_id) {
    params.push(personnel_id);
    where.push(`EXISTS (SELECT 1 FROM activity_participants ap
                         WHERE ap.activity_id = a.id AND ap.personnel_id = $${params.length})`);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const count = await db.query(`SELECT COUNT(*)::int AS c FROM activities a ${whereSql}`, params);
  const total = count.rows[0].c;
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, pages);

  const { rows } = await db.query(
    `SELECT a.*, t.name AS type_name, u.username AS conducted_by_name,
            cp.callsign AS conductor_name
     FROM activities a
     LEFT JOIN activity_types t ON t.id = a.type_id
     LEFT JOIN users u ON u.id = a.conducted_by
     LEFT JOIN personnel cp ON cp.id = a.conductor_id
     ${whereSql}
     ORDER BY a.activity_date DESC, a.id DESC
     LIMIT ${limit} OFFSET ${(safePage - 1) * limit}`, params
  );
  const { participants, images } = await attachCollections(rows.map(r => r.id));
  res.json({
    items: rows.map(r => ({ ...r, participants: participants[r.id] || [], images: images[r.id] || [] })),
    total, page: safePage, pages, limit,
  });
});

router.post('/', requireAuth, async (req, res) => {
  const { type_id, title, activity_date, notes, participant_ids, conductor_id } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Укажите название' });

  const ids = Array.isArray(participant_ids)
    ? [...new Set(participant_ids.map(Number).filter(n => Number.isInteger(n) && n > 0))]
    : [];
  const conductor = Number(conductor_id);
  const conductorVal = Number.isInteger(conductor) && conductor > 0 ? conductor : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO activities (type_id, title, activity_date, conducted_by, conductor_id, notes)
       VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6) RETURNING *`,
      [type_id || null, title.trim(), activity_date || null, req.session.user.id, conductorVal, notes || null]
    );
    const activity = rows[0];
    for (const pid of ids) {
      await client.query(
        'INSERT INTO activity_participants (activity_id, personnel_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [activity.id, pid]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(await loadActivity(activity.id));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  const activity = await loadActivity(req.params.id);
  if (!activity) return res.status(404).json({ error: 'Не найдено' });
  const own = String(activity.conducted_by) === String(req.session.user.id);
  if (!own && !isRosterEditor(req.session.user)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }

  const { type_id, title, activity_date, notes, participant_ids, conductor_id } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Укажите название' });

  const ids = Array.isArray(participant_ids)
    ? [...new Set(participant_ids.map(Number).filter(n => Number.isInteger(n) && n > 0))]
    : [];
  const conductor = Number(conductor_id);
  const conductorVal = Number.isInteger(conductor) && conductor > 0 ? conductor : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE activities
       SET type_id=$1, title=$2, activity_date=COALESCE($3, activity_date), conductor_id=$4, notes=$5
       WHERE id=$6`,
      [type_id || null, title.trim(), activity_date || null, conductorVal, notes || null, activity.id]
    );
    await client.query('DELETE FROM activity_participants WHERE activity_id=$1', [activity.id]);
    for (const pid of ids) {
      await client.query(
        'INSERT INTO activity_participants (activity_id, personnel_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [activity.id, pid]
      );
    }
    await client.query('COMMIT');
    res.json(await loadActivity(activity.id));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

router.get('/summary/counts', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT t.id AS type_id, t.name, t.sort_order, COUNT(a.id)::int AS count
     FROM activity_types t
     LEFT JOIN activities a ON a.type_id = t.id
     GROUP BY t.id, t.name, t.sort_order
     ORDER BY t.sort_order, t.name`
  );
  const uncategorized = await db.query(
    'SELECT COUNT(*)::int AS c FROM activities WHERE type_id IS NULL'
  );

  const totalPersonnel = await db.query('SELECT COUNT(*)::int AS c FROM personnel');
  const mercCount = await db.query('SELECT COUNT(*)::int AS c FROM personnel WHERE mercenary=TRUE');
  const byUnit = await db.query(
    `SELECT COALESCE(u.name, 'Без подразделения') AS name, COUNT(*)::int AS count
     FROM personnel p LEFT JOIN units u ON u.id = p.unit_id
     GROUP BY u.name ORDER BY count DESC`
  );

  res.json({
    activities: rows,
    uncategorized: uncategorized.rows[0].c,
    total_personnel: totalPersonnel.rows[0].c,
    mercenaries: mercCount.rows[0].c,
    by_unit: byUnit.rows,
  });
});

router.get('/summary/series', requireAuth, async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 180);
  const { rows } = await db.query(
    `SELECT activity_date::text AS date, type_id, COUNT(*)::int AS count
     FROM activities
     WHERE activity_date >= (CURRENT_DATE - $1::int)
     GROUP BY activity_date, type_id
     ORDER BY activity_date`,
    [days]
  );
  const types = await db.query('SELECT id, name FROM activity_types ORDER BY sort_order, name');
  res.json({ days, types: types.rows, points: rows });
});

router.post('/:id/images', requireAuth, async (req, res) => {
  const activity = await loadActivity(req.params.id);
  if (!activity) return res.status(404).json({ error: 'Не найдено' });
  const own = String(activity.conducted_by) === String(req.session.user.id);
  if (!own && !isRosterEditor(req.session.user)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }

  const parsed = parseDataUrl(req.body && req.body.data);
  if (!parsed) {
    return res.status(400).json({ error: 'Некорректное изображение (допустимы PNG/JPEG/WebP/GIF до 4 МБ)' });
  }
  const name = `act-${activity.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${parsed.ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), parsed.buf);
  try {
    const { rows } = await db.query(
      'INSERT INTO activity_images (activity_id, path) VALUES ($1,$2) RETURNING id, activity_id, path',
      [activity.id, `/uploads/${name}`]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    fs.unlinkSync(path.join(UPLOAD_DIR, name));
    throw err;
  }
});

router.delete('/:id/images/:imgId', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT i.*, a.conducted_by FROM activity_images i
     JOIN activities a ON a.id = i.activity_id
     WHERE i.id=$1 AND i.activity_id=$2`, [req.params.imgId, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
  const own = String(rows[0].conducted_by) === String(req.session.user.id);
  if (!own && !isRosterEditor(req.session.user)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  await db.query('DELETE FROM activity_images WHERE id=$1', [req.params.imgId]);
  const file = path.join(UPLOAD_DIR, path.basename(rows[0].path));
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT conducted_by FROM activities WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
  const own = String(rows[0].conducted_by) === String(req.session.user.id);
  if (!own && !isRosterEditor(req.session.user)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  const imgs = await db.query('SELECT path FROM activity_images WHERE activity_id=$1', [req.params.id]);
  await db.query('DELETE FROM activities WHERE id=$1', [req.params.id]);
  imgs.rows.forEach(r => {
    const file = path.join(UPLOAD_DIR, path.basename(r.path));
    if (fs.existsSync(file)) fs.unlinkSync(file);
  });
  res.json({ ok: true });
});

module.exports = router;
