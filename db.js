const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const dbPath = path.join(__dirname, 'chat.sqlite');
const db = new sqlite3.Database(dbPath);

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

async function init() {
  await exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`);
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      recovery_question TEXT,
      recovery_answer_hash TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(owner_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      key TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      message_type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_id);
    CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
    CREATE TABLE IF NOT EXISTS conversation_last_seen (
      conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS group_join_requests (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL, -- pending/approved/rejected
      requested_at INTEGER NOT NULL,
      decided_at INTEGER,
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  await ensureColumn('users', 'avatar_url', 'TEXT');
  await ensureColumn('users', 'bio', 'TEXT');
  await ensureColumn('users', 'status', "TEXT NOT NULL DEFAULT 'online'");
  await ensureColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('users', 'approval_status', "TEXT NOT NULL DEFAULT 'approved'");
  await ensureColumn('users', 'approval_note', 'TEXT');
  await ensureColumn('users', 'approval_checked_by', 'INTEGER');
  await ensureColumn('users', 'approval_checked_at', 'INTEGER');
  await ensureColumn('groups', 'announcement', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('messages', 'extra', 'TEXT');
  await run("UPDATE users SET approval_status = 'approved' WHERE approval_status IS NULL OR approval_status = ''");
  await run('UPDATE users SET is_admin = 0 WHERE is_admin IS NULL');
  const adminCount = await get('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1');
  if (!adminCount || adminCount.c === 0) {
    const adminName = process.env.DEFAULT_ADMIN_USER || 'admin';
    const adminPass = process.env.DEFAULT_ADMIN_PASS || 'xsm@chatroom';
    const exists = await get('SELECT id FROM users WHERE username = ?', [adminName]);
    if (!exists) {
      const hash = bcrypt.hashSync(adminPass, 10);
      await run(
        'INSERT INTO users (username, password_hash, created_at, status, is_admin, approval_status) VALUES (?, ?, ?, ?, 1, ?)',
        [adminName, hash, now(), 'online', 'approved']
      );
    } else {
      await run('UPDATE users SET is_admin = 1, approval_status = ? WHERE id = ?', ['approved', exists.id]);
    }
  }
  const passphraseSetting = await get('SELECT key FROM app_settings WHERE key = ?', ['register_passphrase_hash']);
  if (!passphraseSetting) {
    await run('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)', ['register_passphrase_hash', '', now()]);
  }
}

async function ensureColumn(table, column, definition) {
  const rows = await all(`PRAGMA table_info(${table})`);
  if (rows.some((row) => row.name === column)) return;
  await exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function now() {
  return Date.now();
}

async function getOrCreatePrivateConversation(userA, userB) {
  const minId = Math.min(userA, userB);
  const maxId = Math.max(userA, userB);
  const key = `${minId}:${maxId}`;
  const existing = await get('SELECT * FROM conversations WHERE key = ?', [key]);
  if (existing) return existing;
  const info = await run('INSERT INTO conversations (type, key, created_at) VALUES (?, ?, ?)', ['private', key, now()]);
  return await get('SELECT * FROM conversations WHERE id = ?', [info.lastID]);
}

async function getOrCreateGroupConversation(groupId) {
  const key = `group:${groupId}`;
  const existing = await get('SELECT * FROM conversations WHERE key = ?', [key]);
  if (existing) return existing;
  const info = await run('INSERT INTO conversations (type, key, created_at) VALUES (?, ?, ?)', ['group', key, now()]);
  return await get('SELECT * FROM conversations WHERE id = ?', [info.lastID]);
}

module.exports = {
  db,
  exec,
  get,
  all,
  run,
  init,
  now,
  getOrCreatePrivateConversation,
  getOrCreateGroupConversation,
};
