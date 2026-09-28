// Роли, которым разрешено редактировать таблицу состава / документацию командования
const EDIT_ROSTER_ROLES = ['commander', 'deputy', 'moderator'];
// Роли, которым разрешён доступ к админ-панели (пользователи/привилегии)
const ADMIN_ROLES = ['commander', 'deputy'];

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    next();
  };
}

function isRosterEditor(user) {
  return !!(user && EDIT_ROSTER_ROLES.includes(user.role));
}

function isOwnPersonnel(user, personnelId) {
  return !!(user && user.personnel_id && String(user.personnel_id) === String(personnelId));
}

module.exports = {
  requireAuth, requireRole, EDIT_ROSTER_ROLES, ADMIN_ROLES, isRosterEditor, isOwnPersonnel,
};
