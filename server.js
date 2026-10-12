// RIO BOX — single-file server (phone-friendly edition).
// Upload these 5 files to a GitHub repo root: server.js, package.json,
// index.html, app.js, styles.css — then deploy the repo on Railway/Render.
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const AVATAR_DIR = path.join(UPLOAD_DIR, 'avatars');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(AVATAR_DIR, { recursive: true });

// ---------------- Database (SQLite, zero-config) ----------------
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'rio-box.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  bio           TEXT DEFAULT '',
  avatar_path   TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  tags        TEXT DEFAULT '',
  media_path  TEXT NOT NULL,
  media_type  TEXT NOT NULL DEFAULT 'image',
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS likes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pin_id     INTEGER NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(pin_id, user_id)
);
CREATE TABLE IF NOT EXISTS boards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS board_pins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  pin_id     INTEGER NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(board_id, pin_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pin_id     INTEGER NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pins_created ON pins(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_pins_user    ON pins(user_id);
CREATE INDEX IF NOT EXISTS idx_likes_pin    ON likes(pin_id);
CREATE INDEX IF NOT EXISTS idx_bp_board     ON board_pins(board_id);
CREATE INDEX IF NOT EXISTS idx_comments_pin ON comments(pin_id);
`);

// ---------------- Helpers ----------------
function currentUser(req) {
  if (!req.session || !req.session.userId) return null;
  return (
    db
      .prepare('SELECT id, username, bio, avatar_path, created_at FROM users WHERE id = ?')
      .get(req.session.userId) || null
  );
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    bio: u.bio || '',
    avatar: u.avatar_path ? '/uploads/' + u.avatar_path : null,
    created_at: u.created_at,
  };
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in first.' });
  req.user = user;
  next();
}

function attachUser(req, res, next) {
  req.user = currentUser(req);
  next();
}

function pinList(where, params, viewerId, limit = 60, offset = 0) {
  const sql = `
    SELECT p.id, p.title, p.description, p.tags, p.media_path, p.media_type, p.created_at,
           u.id AS user_id, u.username, u.avatar_path,
           (SELECT COUNT(*) FROM likes l WHERE l.pin_id = p.id) AS like_count,
           (SELECT COUNT(*) FROM likes l2 WHERE l2.pin_id = p.id AND l2.user_id = ?) AS liked
    FROM pins p
    JOIN users u ON u.id = p.user_id
    ${where ? 'WHERE ' + where : ''}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(viewerId || -1, ...params, limit, offset);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    tags: r.tags,
    media: '/uploads/' + r.media_path,
    media_type: r.media_type,
    created_at: r.created_at,
    like_count: r.like_count,
    liked: !!r.liked,
    user: {
      id: r.user_id,
      username: r.username,
      avatar: r.avatar_path ? '/uploads/' + r.avatar_path : null,
    },
  }));
}

function boardWithCover(b) {
  const cover = db
    .prepare(
      `SELECT p.media_path, p.media_type FROM board_pins bp
       JOIN pins p ON p.id = bp.pin_id
       WHERE bp.board_id = ? ORDER BY bp.created_at DESC LIMIT 1`
    )
    .get(b.id);
  return {
    id: b.id,
    name: b.name,
    description: b.description || '',
    created_at: b.created_at,
    pin_count: b.pin_count || 0,
    cover: cover ? '/uploads/' + cover.media_path : null,
    cover_type: cover ? cover.media_type : null,
  };
}

// ---------------- App setup ----------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);
app.use(
  session({
    name: 'riobox.sid',
    secret: process.env.SESSION_SECRET || 'rio-box-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  })
);

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', fallthrough: true }));

// Frontend files live next to server.js in this edition
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, 'styles.css')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
app.get('/sw.js', (req, res) => res.type('application/javascript').sendFile(path.join(__dirname, 'sw.js')));
app.get('/icon-192.png', (req, res) => res.sendFile(path.join(__dirname, 'icon-192.png')));
app.get('/icon-512.png', (req, res) => res.sendFile(path.join(__dirname, 'icon-512.png')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ---------------- Auth ----------------
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

app.post('/api/auth/signup', (req, res) => {
  const { username, password, bio } = req.body || {};
  if (!username || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, underscore.' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(username);
  if (exists) return res.status(409).json({ error: 'That username is taken.' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, bio) VALUES (?, ?, ?)')
    .run(username, hash, (bio || '').slice(0, 500));

  req.session.userId = info.lastInsertRowid;
  const user = db
    .prepare('SELECT id, username, bio, avatar_path, created_at FROM users WHERE id = ?')
    .get(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  req.session.userId = user.id;
  const pub = db
    .prepare('SELECT id, username, bio, avatar_path, created_at FROM users WHERE id = ?')
    .get(user.id);
  res.json({ user: publicUser(pub) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('riobox.sid');
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ user: publicUser(user) });
});

// ---------------- Users ----------------
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATAR_DIR),
    filename: (req, file, cb) =>
      cb(null, `avatar-${req.user.id}-${Date.now()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Avatar must be a JPG, PNG, WEBP or GIF image.'));
  },
});

app.put('/api/users/me', requireAuth, (req, res) => {
  const { bio } = req.body || {};
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run((bio || '').slice(0, 500), req.user.id);
  const user = db
    .prepare('SELECT id, username, bio, avatar_path, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/users/me/avatar', requireAuth, (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const old = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(req.user.id);
    if (old && old.avatar_path) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, old.avatar_path)); } catch (e) {}
    }
    const rel = 'avatars/' + req.file.filename;
    db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(rel, req.user.id);
    res.json({ avatar: '/uploads/' + rel });
  });
});

app.get('/api/users/:username', (req, res) => {
  const user = db
    .prepare('SELECT id, username, bio, avatar_path, created_at FROM users WHERE lower(username) = lower(?)')
    .get(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const viewerId = req.session && req.session.userId ? req.session.userId : null;
  const pins = pinList('p.user_id = ?', [user.id], viewerId, 100, 0);
  const boards = db
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM board_pins bp WHERE bp.board_id = b.id) AS pin_count
       FROM boards b WHERE b.user_id = ? ORDER BY b.created_at DESC`
    )
    .all(user.id);
  res.json({ user: publicUser(user), pins, boards });
});

// ---------------- Pins ----------------
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];

const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.bin';
      cb(null, `pin-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES.includes(file.mimetype) || VIDEO_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP, GIF images and MP4, WEBM videos are allowed.'));
  },
});

app.post('/api/pins', requireAuth, (req, res) => {
  mediaUpload.single('media')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Please choose a photo or video to upload.' });
    const title = (req.body.title || '').trim().slice(0, 120);
    if (!title) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: 'Please give your pin a title.' });
    }
    const mediaType = VIDEO_TYPES.includes(req.file.mimetype) ? 'video' : 'image';
    const info = db
      .prepare('INSERT INTO pins (user_id, title, description, tags, media_path, media_type) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, title, (req.body.description || '').slice(0, 2000), (req.body.tags || '').slice(0, 300), req.file.filename, mediaType);
    res.status(201).json({ pin: pinList('p.id = ?', [info.lastInsertRowid], req.user.id, 1, 0)[0] });
  });
});

app.get('/api/pins', attachUser, (req, res) => {
  const q = (req.query.search || '').trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 60, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const viewerId = req.user ? req.user.id : null;
  if (q) {
    const like = `%${q}%`;
    const pins = pinList('(p.title LIKE ? OR p.description LIKE ? OR p.tags LIKE ?)', [like, like, like], viewerId, limit, offset);
    return res.json({ pins, search: q });
  }
  res.json({ pins: pinList(null, [], viewerId, limit, offset) });
});

app.get('/api/pins/:id', attachUser, (req, res) => {
  const viewerId = req.user ? req.user.id : null;
  const pins = pinList('p.id = ?', [req.params.id], viewerId, 1, 0);
  if (!pins.length) return res.status(404).json({ error: 'Pin not found.' });
  const pin = pins[0];
  const comments = db
    .prepare(
      `SELECT c.id, c.text, c.created_at, u.username, u.avatar_path
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.pin_id = ? ORDER BY c.created_at ASC, c.id ASC`
    )
    .all(pin.id)
    .map((c) => ({
      id: c.id, text: c.text, created_at: c.created_at,
      user: { username: c.username, avatar: c.avatar_path ? '/uploads/' + c.avatar_path : null },
    }));
  res.json({ pin, comments });
});

app.delete('/api/pins/:id', requireAuth, (req, res) => {
  const pin = db.prepare('SELECT * FROM pins WHERE id = ?').get(req.params.id);
  if (!pin) return res.status(404).json({ error: 'Pin not found.' });
  if (pin.user_id !== req.user.id) return res.status(403).json({ error: 'Not your pin.' });
  db.prepare('DELETE FROM pins WHERE id = ?').run(pin.id);
  try { fs.unlinkSync(path.join(UPLOAD_DIR, pin.media_path)); } catch (e) {}
  res.json({ ok: true });
});

app.post('/api/pins/:id/like', requireAuth, (req, res) => {
  const pin = db.prepare('SELECT id FROM pins WHERE id = ?').get(req.params.id);
  if (!pin) return res.status(404).json({ error: 'Pin not found.' });
  db.prepare('INSERT OR IGNORE INTO likes (pin_id, user_id) VALUES (?, ?)').run(pin.id, req.user.id);
  const count = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE pin_id = ?').get(pin.id).c;
  res.json({ liked: true, like_count: count });
});

app.delete('/api/pins/:id/like', requireAuth, (req, res) => {
  const pin = db.prepare('SELECT id FROM pins WHERE id = ?').get(req.params.id);
  if (!pin) return res.status(404).json({ error: 'Pin not found.' });
  db.prepare('DELETE FROM likes WHERE pin_id = ? AND user_id = ?').run(pin.id, req.user.id);
  const count = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE pin_id = ?').get(pin.id).c;
  res.json({ liked: false, like_count: count });
});

app.post('/api/pins/:id/comments', requireAuth, (req, res) => {
  const pin = db.prepare('SELECT id FROM pins WHERE id = ?').get(req.params.id);
  if (!pin) return res.status(404).json({ error: 'Pin not found.' });
  const text = (req.body.text || '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty.' });
  const info = db.prepare('INSERT INTO comments (pin_id, user_id, text) VALUES (?, ?, ?)').run(pin.id, req.user.id, text);
  res.status(201).json({
    comment: {
      id: info.lastInsertRowid, text, created_at: new Date().toISOString(),
      user: { username: req.user.username, avatar: publicUser(req.user).avatar },
    },
  });
});

app.get('/api/pins/:id/download', (req, res) => {
  const pin = db.prepare('SELECT * FROM pins WHERE id = ?').get(req.params.id);
  if (!pin) return res.status(404).json({ error: 'Pin not found.' });
  const filePath = path.join(UPLOAD_DIR, pin.media_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing.' });
  const safeName = (pin.title || 'rio-box-pin').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60);
  res.download(filePath, `riobox-${pin.id}-${safeName}${path.extname(pin.media_path)}`);
});

// ---------------- Boards ----------------
app.post('/api/boards', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Board needs a name.' });
  const info = db
    .prepare('INSERT INTO boards (user_id, name, description) VALUES (?, ?, ?)')
    .run(req.user.id, name, (req.body.description || '').slice(0, 500));
  const b = db.prepare('SELECT * FROM boards WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ board: boardWithCover({ ...b, pin_count: 0 }) });
});

app.get('/api/boards/mine', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM board_pins bp WHERE bp.board_id = b.id) AS pin_count
       FROM boards b WHERE b.user_id = ? ORDER BY b.created_at DESC`
    )
    .all(req.user.id);
  res.json({ boards: rows.map(boardWithCover) });
});

app.get('/api/boards/:id', (req, res) => {
  const b = db
    .prepare(
      `SELECT b.*, u.username,
              (SELECT COUNT(*) FROM board_pins bp WHERE bp.board_id = b.id) AS pin_count
       FROM boards b JOIN users u ON u.id = b.user_id WHERE b.id = ?`
    )
    .get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Board not found.' });
  const viewerId = req.session && req.session.userId ? req.session.userId : null;
  const pins = pinList('p.id IN (SELECT pin_id FROM board_pins WHERE board_id = ?)', [b.id], viewerId, 100, 0);
  res.json({ board: { ...boardWithCover(b), owner: b.username }, pins });
});

app.post('/api/boards/:id/pins', requireAuth, (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found.' });
  if (board.user_id !== req.user.id) return res.status(403).json({ error: 'Not your board.' });
  const pin = db.prepare('SELECT id FROM pins WHERE id = ?').get(req.body.pin_id);
  if (!pin) return res.status(404).json({ error: 'Pin not found.' });
  db.prepare('INSERT OR IGNORE INTO board_pins (board_id, pin_id) VALUES (?, ?)').run(board.id, pin.id);
  res.status(201).json({ ok: true });
});

app.delete('/api/boards/:id/pins/:pinId', requireAuth, (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found.' });
  if (board.user_id !== req.user.id) return res.status(403).json({ error: 'Not your board.' });
  db.prepare('DELETE FROM board_pins WHERE board_id = ? AND pin_id = ?').run(board.id, req.params.pinId);
  res.json({ ok: true });
});

app.delete('/api/boards/:id', requireAuth, (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found.' });
  if (board.user_id !== req.user.id) return res.status(403).json({ error: 'Not your board.' });
  db.prepare('DELETE FROM boards WHERE id = ?').run(board.id);
  res.json({ ok: true });
});

// ---------------- Health, 404, SPA fallback ----------------
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'RIO BOX' }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
  console.log(`RIO BOX is running at http://localhost:${PORT}`);
});
