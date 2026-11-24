const session = require('express-session');
const db = require('./db');

// store de sessao simples gravando no proprio sqlite
class SqliteStore extends session.Store {
  get(sid, cb) {
    try {
      const row = db.get('SELECT dados, expira FROM sessoes WHERE sid = ?', sid);
      if (!row || row.expira < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.dados));
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try {
      const expira = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 86400000;
      db.run(`INSERT INTO sessoes (sid, dados, expira) VALUES (?,?,?)
              ON CONFLICT(sid) DO UPDATE SET dados = excluded.dados, expira = excluded.expira`,
        sid, JSON.stringify(sess), expira);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }

  destroy(sid, cb) {
    try {
      db.run('DELETE FROM sessoes WHERE sid = ?', sid);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

setInterval(() => {
  try { db.run('DELETE FROM sessoes WHERE expira < ?', Date.now()); } catch (e) {}
}, 3600000).unref();

module.exports = SqliteStore;
