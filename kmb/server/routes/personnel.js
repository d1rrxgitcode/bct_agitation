const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, EDIT_ROSTER_ROLES, isRosterEditor } = require('../middleware/auth');

const router = express.Router();

const FORMATION_DEFAULT = '91-й разведывательный корпус';

const SORTABLE = {
  idn: 'p.idn',
  position: 'pos.sort_order',
  activity: 'p.activity',
  unit: 'u.name',
  mercenary: 'p.mercenary',
  rank: 'r.sort_order',
  callsign: 'p.callsign',
};

const BASE_SELECT = `
  SELECT p.*, r.name AS rank_name, pos.name AS position_name, u.name AS unit_name
  FROM personnel p
  LEFT JOIN ranks r ON r.id = p.rank_id
  LEFT JOIN positions pos ON pos.id = p.position_id
  LEFT JOIN units u ON u.id = p.unit_id
`;

async function loadPerson(id) {
  const { rows } = await db.query(`${BASE_SELECT} WHERE p.id=$1`, [id]);
  if (!rows[0]) return null;
  const history = await db.query(
    `SELECT rh.*, r.name AS rank_name FROM rank_history rh
     JOIN ranks r ON r.id = rh.rank_id WHERE rh.personnel_id=$1 ORDER BY rh.awarded_at ASC, rh.id ASC`,
    [id]
  );
  return { ...rows[0], rank_history: history.rows };
}

router.get('/', requireAuth, async (req, res) => {
  const { sort = 'idn', dir = 'asc', unit_id, position_id, mercenary, activity, q } = req.query;
  const sortCol = SORTABLE[sort] || SORTABLE.idn;
  const sortDir = dir.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const where = [];
  const params = [];

  if (unit_id) { params.push(unit_id); where.push(`p.unit_id = $${params.length}`); }
  if (position_id) { params.push(position_id); where.push(`p.position_id = $${params.length}`); }
  if (mercenary === 'true' || mercenary === 'false') {
    params.push(mercenary === 'true'); where.push(`p.mercenary = $${params.length}`);
  }
  if (activity) { params.push(`%${activity}%`); where.push(`p.activity ILIKE $${params.length}`); }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(p.callsign ILIKE $${params.length} OR p.idn ILIKE $${params.length} OR p.discord ILIKE $${params.length})`);
  }

  const sql = `${BASE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${sortCol} ${sortDir}`;
  const { rows } = await db.query(sql, params);
  res.json(rows);
});

router.get('/me', requireAuth, async (req, res) => {
  const pid = req.session.user.personnel_id;
  if (!pid) return res.status(404).json({ error: 'Аккаунт не привязан к личному делу' });
  const person = await loadPerson(pid);
  if (!person) return res.status(404).json({ error: 'Не найдено' });
  res.json(person);
});

router.get('/:id', requireAuth, async (req, res) => {
  const person = await loadPerson(req.params.id);
  if (!person) return res.status(404).json({ error: 'Не найдено' });
  res.json(person);
});

router.post('/', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
  const b = req.body;
  if (!b.idn || !/^\d{4}$/.test(b.idn)) {
    return res.status(400).json({ error: 'IDN должен состоять из 4 цифр' });
  }
  if (!b.callsign || !b.callsign.trim()) {
    return res.status(400).json({ error: 'Укажите позывной' });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO personnel
        (idn, callsign, rank_id, position_id, unit_id, steam_id, discord, activity, mercenary,
         status, affiliation, subordination, formation, specialization, awards,
         service_date, corps_join_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        b.idn, b.callsign.trim(), b.rank_id || null, b.position_id || null, b.unit_id || null,
        b.steam_id || null, b.discord || null, b.activity || null, !!b.mercenary,
        b.status || 'АКТИВЕН', b.affiliation || 'ГАЛАКТИЧЕСКАЯ РЕСПУБЛИКА',
        b.subordination || 'ВЕЛИКАЯ АРМИЯ РЕСПУБЛИКИ',
        b.formation || FORMATION_DEFAULT,
        b.specialization || null, b.awards || [], b.service_date || null,
        b.corps_join_date || null, b.notes || null,
      ]
    );
    const p = rows[0];
    if (b.rank_id) {
      await db.query(
        'INSERT INTO rank_history (personnel_id, rank_id, awarded_at) VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE))',
        [p.id, b.rank_id, b.rank_awarded_at || null]
      );
    }
    res.status(201).json(p);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Такой IDN уже используется' });
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.put('/:id', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
  const b = req.body;
  const id = req.params.id;

  const current = await db.query('SELECT rank_id FROM personnel WHERE id=$1', [id]);
  if (!current.rows[0]) return res.status(404).json({ error: 'Не найдено' });

  try {
    const { rows } = await db.query(
      `UPDATE personnel SET
        idn=COALESCE($1,idn), callsign=COALESCE($2,callsign), rank_id=$3, position_id=$4,
        unit_id=$5, steam_id=COALESCE($6,steam_id), discord=COALESCE($7,discord), activity=COALESCE($8,activity), mercenary=COALESCE($9,mercenary),
        status=COALESCE($10,status), affiliation=COALESCE($11,affiliation),
        subordination=COALESCE($12,subordination), formation=COALESCE($13,formation), specialization=COALESCE($14,specialization),
        awards=COALESCE($15,awards), service_date=COALESCE($16,service_date), corps_join_date=COALESCE($17,corps_join_date), notes=COALESCE($18,notes),
        updated_at=now()
       WHERE id=$19 RETURNING *`,
      [
        b.idn, b.callsign, b.rank_id || null, b.position_id || null, b.unit_id || null,
        b.steam_id === undefined ? null : b.steam_id,
        b.discord === undefined ? null : b.discord,
        b.activity === undefined ? null : b.activity,
        b.mercenary === undefined ? null : !!b.mercenary,
        b.status ?? null, b.affiliation ?? null, b.subordination ?? null,
        b.formation === undefined ? null : (b.formation || FORMATION_DEFAULT),
        b.specialization === undefined ? null : b.specialization,
        b.awards === undefined ? null : b.awards,
        b.service_date === undefined ? null : (b.service_date || null),
        b.corps_join_date === undefined ? null : (b.corps_join_date || null),
        b.notes === undefined ? null : b.notes, id,
      ]
    );

    if (b.rank_id && Number(b.rank_id) !== Number(current.rows[0].rank_id)) {
      await db.query(
        'INSERT INTO rank_history (personnel_id, rank_id, awarded_at) VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE))',
        [id, b.rank_id, b.rank_awarded_at || null]
      );
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Такой IDN уже используется' });
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/:id/rank-history', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
  const { rank_id, awarded_at, set_current } = req.body;
  if (!rank_id) return res.status(400).json({ error: 'Укажите звание' });
  const exists = await db.query('SELECT id FROM personnel WHERE id=$1', [req.params.id]);
  if (!exists.rows[0]) return res.status(404).json({ error: 'Не найдено' });
  const { rows } = await db.query(
    `INSERT INTO rank_history (personnel_id, rank_id, awarded_at)
     VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE)) RETURNING *`,
    [req.params.id, rank_id, awarded_at || null]
  );
  if (set_current) {
    await db.query('UPDATE personnel SET rank_id=$1, updated_at=now() WHERE id=$2', [rank_id, req.params.id]);
  }
  res.status(201).json(rows[0]);
});

router.put('/:id/rank-history/:hid', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
  const { rank_id, awarded_at } = req.body;
  const { rows } = await db.query(
    `UPDATE rank_history SET
       rank_id=COALESCE($1, rank_id),
       awarded_at=COALESCE($2::date, awarded_at)
     WHERE id=$3 AND personnel_id=$4 RETURNING *`,
    [rank_id || null, awarded_at || null, req.params.hid, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
  res.json(rows[0]);
});

router.delete('/:id/rank-history/:hid', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
  const { rowCount } = await db.query(
    'DELETE FROM rank_history WHERE id=$1 AND personnel_id=$2',
    [req.params.hid, req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

router.delete('/:id', requireRole(...EDIT_ROSTER_ROLES), async (req, res) => {
  await db.query('DELETE FROM personnel WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
