const db = require('../config/db');

// Every request re-reads the user's current state from the database.
// The session only ever stores a user id - role and active status are
// NEVER trusted from the client or from stale session data.
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Session invalid. Please log in again.' });
  }

  if (!user.active) {
    req.session.destroy(() => {});
    return res.status(403).json({ error: 'Your account has been deactivated. Contact administrator.' });
  }

  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
