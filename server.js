const express = require('express');
const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const { Server } = require('socket.io');
const { get, all, run, init, now, getOrCreatePrivateConversation, getOrCreateGroupConversation } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-light-chat-secret';
const MAX_GROUP_SIZE = 50;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
});
init();
const onlineUsers = new Map();

app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/assets', express.static(path.join(__dirname, 'public', 'app', 'assets')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app', 'index.html'));
});
app.get('/legacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/m', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app', 'index.html'));
});
app.use('/', express.static(path.join(__dirname, 'public')));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: '未授权' });
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: '令牌无效' });
  }
}

async function adminMiddleware(req, res, next) {
  const user = await get('SELECT id, is_admin FROM users WHERE id = ?', [req.user.user_id]);
  if (!user || !user.is_admin) return fail(res, 403, '仅管理员可操作');
  next();
}

function ok(res, data = {}, message = 'ok') {
  return res.json({ ok: true, message, data });
}

function fail(res, status, message) {
  return res.status(status).json({ ok: false, message });
}

function safeJsonParse(raw, fallback = {}) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function mapMessage(row) {
  return {
    id: row.id,
    threadType: 'room',
    roomId: Number((row.key || '').split(':')[1]),
    senderId: row.sender_id,
    senderName: row.sender_name || '',
    senderAvatar: row.sender_avatar || '',
    type: row.message_type,
    content: row.content,
    extra: safeJsonParse(row.extra, {}),
    createdAt: row.created_at,
    deletedAt: row.deleted_at || null,
  };
}

function mapDirectMessage(row, currentUserId) {
  const [a, b] = (row.key || '').split(':').map(Number);
  const peerId = a === currentUserId ? b : a;
  return {
    id: row.id,
    threadType: 'direct',
    peerId,
    senderId: row.sender_id,
    senderName: row.sender_name || '',
    senderAvatar: row.sender_avatar || '',
    type: row.message_type,
    content: row.content,
    extra: safeJsonParse(row.extra, {}),
    createdAt: row.created_at,
    deletedAt: row.deleted_at || null,
  };
}

async function getRoomById(roomId) {
  return await get('SELECT id, name, owner_id, announcement, created_at FROM groups WHERE id = ?', [roomId]);
}

async function isRoomMember(roomId, userId) {
  const member = await get('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?', [roomId, userId]);
  return member;
}

app.post('/api/v2/auth/register', async (req, res) => {
  const { username, password, register_passphrase } = req.body || {};
  if (!username || !password) return fail(res, 400, '缺少用户名或密码');
  const passphraseCfg = await get('SELECT value FROM app_settings WHERE key = ?', ['register_passphrase_hash']);
  if (passphraseCfg && passphraseCfg.value) {
    if (!register_passphrase) return fail(res, 400, '缺少注册口令');
    const matched = bcrypt.compareSync(register_passphrase, passphraseCfg.value);
    if (!matched) return fail(res, 403, '注册口令错误');
  }
  const exists = await get('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) return fail(res, 409, '用户名已存在');
  const password_hash = bcrypt.hashSync(password, 10);
  await run(
    'INSERT INTO users (username, password_hash, created_at, status, is_admin, approval_status) VALUES (?, ?, ?, ?, 0, ?)',
    [username, password_hash, now(), 'online', 'pending']
  );
  return ok(res, { needApproval: true }, '注册申请已提交，等待管理员审批');
});

app.post('/api/v2/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return fail(res, 400, '缺少用户名或密码');
  const user = await get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return fail(res, 401, '用户名或密码错误');
  if (user.approval_status === 'pending') return fail(res, 403, '账号待管理员审批');
  if (user.approval_status === 'rejected') return fail(res, 403, '账号审批未通过');
  const token = jwt.sign({ user_id: user.id, username: user.username, is_admin: !!user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
  return ok(
    res,
    {
      token,
      user: {
        id: user.id,
        username: user.username,
        avatar_url: user.avatar_url,
        bio: user.bio,
        status: user.status || 'online',
        isAdmin: !!user.is_admin,
        approvalStatus: user.approval_status || 'approved',
      },
    },
    '登录成功'
  );
});

app.get('/api/v2/me', authMiddleware, async (req, res) => {
  const user = await get('SELECT id, username, avatar_url, bio, status, is_admin, approval_status FROM users WHERE id = ?', [req.user.user_id]);
  if (!user) return ok(res, {});
  user.isAdmin = !!user.is_admin;
  user.approvalStatus = user.approval_status || 'approved';
  delete user.is_admin;
  delete user.approval_status;
  return ok(res, user || {});
});

app.patch('/api/v2/me', authMiddleware, async (req, res) => {
  const { username, avatar_url, bio, status } = req.body || {};
  if (username) {
    const exists = await get('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.user.user_id]);
    if (exists) return fail(res, 409, '用户名已被占用');
  }
  await run(
    'UPDATE users SET username = COALESCE(?, username), avatar_url = COALESCE(?, avatar_url), bio = COALESCE(?, bio), status = COALESCE(?, status) WHERE id = ?',
    [username || null, avatar_url || null, bio || null, status || null, req.user.user_id]
  );
  const user = await get('SELECT id, username, avatar_url, bio, status FROM users WHERE id = ?', [req.user.user_id]);
  io.emit('presence_sync', { userId: req.user.user_id, status: user.status || 'online' });
  return ok(res, user, '资料已更新');
});

app.get('/api/v2/rooms', authMiddleware, async (req, res) => {
  const userId = req.user.user_id;
  const rows = await all(
    `SELECT g.id, g.name, g.owner_id, g.announcement, g.created_at
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = ?
     ORDER BY g.created_at DESC`,
    [userId]
  );
  const data = [];
  for (const room of rows) {
    const conv = await get('SELECT id FROM conversations WHERE key = ?', [`group:${room.id}`]);
    const ls = conv ? await get('SELECT last_seen_at FROM conversation_last_seen WHERE conversation_id = ? AND user_id = ?', [conv.id, userId]) : null;
    const unreadRow = conv
      ? await get(
          ls
            ? 'SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND created_at > ? AND sender_id != ?'
            : 'SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND sender_id != ?',
          ls ? [conv.id, ls.last_seen_at, userId] : [conv.id, userId]
        )
      : { c: 0 };
    const members = await all('SELECT user_id FROM group_members WHERE group_id = ?', [room.id]);
    const onlineCount = members.filter((m) => onlineUsers.has(m.user_id)).length;
    data.push({
      id: room.id,
      name: room.name,
      ownerId: room.owner_id,
      announcement: room.announcement || '',
      onlineCount,
      unread: unreadRow ? unreadRow.c : 0,
    });
  }
  return ok(res, data);
});

app.get('/api/v2/rooms/discover', authMiddleware, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const rows = q
    ? await all('SELECT id, name, owner_id, announcement FROM groups WHERE name LIKE ? ORDER BY created_at DESC LIMIT 50', [`%${q}%`])
    : await all('SELECT id, name, owner_id, announcement FROM groups ORDER BY created_at DESC LIMIT 50');
  return ok(res, rows);
});

app.get('/api/v2/users/discover', authMiddleware, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const rows = q
    ? await all(
        "SELECT id, username, avatar_url, bio, status FROM users WHERE id != ? AND approval_status = 'approved' AND username LIKE ? ORDER BY username LIMIT 50",
        [req.user.user_id, `%${q}%`]
      )
    : await all("SELECT id, username, avatar_url, bio, status FROM users WHERE id != ? AND approval_status = 'approved' ORDER BY username LIMIT 50", [req.user.user_id]);
  return ok(res, rows);
});

app.get('/api/v2/directs', authMiddleware, async (req, res) => {
  const userId = req.user.user_id;
  const convs = await all('SELECT id, key FROM conversations WHERE type = ?', ['private']);
  const related = convs.filter((c) => {
    const [a, b] = c.key.split(':').map(Number);
    return a === userId || b === userId;
  });
  const data = [];
  for (const conv of related) {
    const [a, b] = conv.key.split(':').map(Number);
    const peerId = a === userId ? b : a;
    const user = await get('SELECT id, username, avatar_url, bio, status FROM users WHERE id = ?', [peerId]);
    if (!user) continue;
    const ls = await get('SELECT last_seen_at FROM conversation_last_seen WHERE conversation_id = ? AND user_id = ?', [conv.id, userId]);
    const unreadRow = await get(
      ls
        ? 'SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND created_at > ? AND sender_id != ?'
        : 'SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND sender_id != ?',
      ls ? [conv.id, ls.last_seen_at, userId] : [conv.id, userId]
    );
    data.push({
      peerId: user.id,
      peerName: user.username,
      peerAvatar: user.avatar_url || '',
      peerStatus: user.status || 'online',
      unread: unreadRow ? unreadRow.c : 0,
    });
  }
  return ok(res, data);
});

app.get('/api/v2/directs/:peerId/messages', authMiddleware, async (req, res) => {
  const userId = req.user.user_id;
  const peerId = Number(req.params.peerId);
  if (!peerId || peerId === userId) return fail(res, 400, '无效的私聊对象');
  const peer = await get('SELECT id FROM users WHERE id = ?', [peerId]);
  if (!peer) return fail(res, 404, '用户不存在');
  const conv = await getOrCreatePrivateConversation(userId, peerId);
  const cursor = Number(req.query.cursor || 0);
  const keyword = (req.query.keyword || '').toString().trim();
  const params = [conv.id];
  let sql = `SELECT m.*, c.key, u.username AS sender_name, COALESCE(u.avatar_url, '') AS sender_avatar
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             JOIN users u ON u.id = m.sender_id
             WHERE m.conversation_id = ?`;
  if (cursor) {
    sql += ' AND m.created_at < ?';
    params.push(cursor);
  }
  if (keyword) {
    sql += ' AND m.content LIKE ?';
    params.push(`%${keyword}%`);
  }
  sql += ' ORDER BY m.created_at DESC LIMIT 40';
  const rows = await all(sql, params);
  const items = rows.reverse().map((row) => mapDirectMessage(row, userId));
  return ok(res, { items, nextCursor: rows.length ? rows[rows.length - 1].created_at : null });
});

app.post('/api/v2/directs/:peerId/read', authMiddleware, async (req, res) => {
  const userId = req.user.user_id;
  const peerId = Number(req.params.peerId);
  if (!peerId || peerId === userId) return fail(res, 400, '无效的私聊对象');
  const conv = await getOrCreatePrivateConversation(userId, peerId);
  const at = Number(req.body?.at || now());
  const existing = await get('SELECT conversation_id FROM conversation_last_seen WHERE conversation_id = ? AND user_id = ?', [conv.id, userId]);
  if (existing) {
    await run('UPDATE conversation_last_seen SET last_seen_at = ? WHERE conversation_id = ? AND user_id = ?', [at, conv.id, userId]);
  } else {
    await run('INSERT INTO conversation_last_seen (conversation_id, user_id, last_seen_at) VALUES (?, ?, ?)', [conv.id, userId, at]);
  }
  const peerSocketIds = onlineUsers.get(peerId);
  if (peerSocketIds) {
    for (const sid of peerSocketIds) io.to(sid).emit('direct_read', { peerId: userId, at });
  }
  return ok(res, { at }, '已标记已读');
});

app.post('/api/v2/rooms', authMiddleware, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return fail(res, 400, '缺少房间名称');
  const info = await run('INSERT INTO groups (name, owner_id, announcement, created_at) VALUES (?, ?, ?, ?)', [name, req.user.user_id, '', now()]);
  await run('INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', [info.lastID, req.user.user_id, 'owner', now()]);
  const conv = await getOrCreateGroupConversation(info.lastID);
  return ok(res, { id: info.lastID, name, conversationId: conv.id }, '房间已创建');
});

app.post('/api/v2/rooms/:id/join', authMiddleware, async (req, res) => {
  const roomId = Number(req.params.id);
  const room = await getRoomById(roomId);
  if (!room) return fail(res, 404, '房间不存在');
  const member = await isRoomMember(roomId, req.user.user_id);
  if (!member) {
    await run('INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', [roomId, req.user.user_id, 'member', now()]);
  }
  await getOrCreateGroupConversation(roomId);
  return ok(res, { roomId }, '加入成功');
});

app.post('/api/v2/rooms/:id/leave', authMiddleware, async (req, res) => {
  const roomId = Number(req.params.id);
  const room = await getRoomById(roomId);
  if (!room) return fail(res, 404, '房间不存在');
  if (room.owner_id === req.user.user_id) return fail(res, 400, '房主不能直接退出，请先转让或解散');
  await run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [roomId, req.user.user_id]);
  return ok(res, { roomId }, '已退出房间');
});

app.patch('/api/v2/rooms/:id', authMiddleware, async (req, res) => {
  const roomId = Number(req.params.id);
  const room = await getRoomById(roomId);
  if (!room) return fail(res, 404, '房间不存在');
  if (room.owner_id !== req.user.user_id) return fail(res, 403, '仅房主可修改');
  const { name, announcement } = req.body || {};
  await run('UPDATE groups SET name = COALESCE(?, name), announcement = COALESCE(?, announcement) WHERE id = ?', [name || null, announcement || null, roomId]);
  const next = await getRoomById(roomId);
  return ok(res, next, '房间已更新');
});

app.delete('/api/v2/rooms/:id', authMiddleware, async (req, res) => {
  const roomId = Number(req.params.id);
  const room = await getRoomById(roomId);
  if (!room) return fail(res, 404, '房间不存在');
  if (room.owner_id !== req.user.user_id) return fail(res, 403, '仅房主可解散房间');
  await run('DELETE FROM conversations WHERE key = ?', [`group:${roomId}`]);
  await run('DELETE FROM groups WHERE id = ?', [roomId]);
  io.to(`group:${roomId}`).emit('room_dissolved', { roomId });
  return ok(res, { roomId }, '房间已解散');
});

app.get('/api/v2/rooms/:id/members', authMiddleware, async (req, res) => {
  const roomId = Number(req.params.id);
  const room = await getRoomById(roomId);
  if (!room) return fail(res, 404, '房间不存在');
  const member = await isRoomMember(roomId, req.user.user_id);
  if (!member) return fail(res, 403, '未加入该房间');
  const rows = await all(
    `SELECT gm.user_id AS id, u.username, COALESCE(u.avatar_url, '') AS avatar_url, gm.role, gm.joined_at
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ?
     ORDER BY CASE WHEN gm.role = 'owner' THEN 0 ELSE 1 END, u.username`,
    [roomId]
  );
  return ok(res, rows);
});

app.get('/api/v2/admin/settings', authMiddleware, adminMiddleware, async (req, res) => {
  const setting = await get('SELECT value FROM app_settings WHERE key = ?', ['register_passphrase_hash']);
  return ok(res, { registerPassphraseSet: Boolean(setting && setting.value) });
});

app.patch('/api/v2/admin/settings', authMiddleware, adminMiddleware, async (req, res) => {
  const { registerPassphrase } = req.body || {};
  if (typeof registerPassphrase !== 'string') return fail(res, 400, '缺少注册口令');
  const hash = registerPassphrase.trim() ? bcrypt.hashSync(registerPassphrase.trim(), 10) : '';
  const exists = await get('SELECT key FROM app_settings WHERE key = ?', ['register_passphrase_hash']);
  if (exists) {
    await run('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?', [hash, now(), 'register_passphrase_hash']);
  } else {
    await run('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)', ['register_passphrase_hash', hash, now()]);
  }
  return ok(res, { registerPassphraseSet: Boolean(hash) }, '设置已更新');
});

app.get('/api/v2/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  const status = (req.query.status || 'pending').toString();
  const q = (req.query.q || '').toString().trim();
  const params = [];
  let sql =
    "SELECT id, username, created_at, is_admin, approval_status, COALESCE(approval_note, '') AS approval_note, approval_checked_at FROM users WHERE 1=1";
  if (status && status !== 'all') {
    sql += ' AND approval_status = ?';
    params.push(status);
  }
  if (q) {
    sql += ' AND username LIKE ?';
    params.push(`%${q}%`);
  }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  const rows = await all(sql, params);
  const data = rows.map((v) => ({ ...v, isAdmin: !!v.is_admin }));
  return ok(res, data);
});

app.patch('/api/v2/admin/users/:id/review', authMiddleware, adminMiddleware, async (req, res) => {
  const userId = Number(req.params.id);
  const { status, note } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) return fail(res, 400, '审批状态无效');
  const target = await get('SELECT id, is_admin FROM users WHERE id = ?', [userId]);
  if (!target) return fail(res, 404, '用户不存在');
  if (target.is_admin) return fail(res, 400, '管理员账号不可审批');
  await run(
    'UPDATE users SET approval_status = ?, approval_note = ?, approval_checked_by = ?, approval_checked_at = ? WHERE id = ?',
    [status, note || '', req.user.user_id, now(), userId]
  );
  return ok(res, { id: userId, status }, status === 'approved' ? '审批通过' : '已拒绝');
});

app.patch('/api/v2/admin/users/:id/role', authMiddleware, adminMiddleware, async (req, res) => {
  const userId = Number(req.params.id);
  const { isAdmin } = req.body || {};
  if (typeof isAdmin !== 'boolean') return fail(res, 400, '角色参数无效');
  if (userId === req.user.user_id && !isAdmin) return fail(res, 400, '不能移除自己的管理员权限');
  const target = await get('SELECT id FROM users WHERE id = ?', [userId]);
  if (!target) return fail(res, 404, '用户不存在');
  await run('UPDATE users SET is_admin = ? WHERE id = ?', [isAdmin ? 1 : 0, userId]);
  return ok(res, { id: userId, isAdmin }, '角色已更新');
});

app.get('/api/v2/rooms/:id/messages', authMiddleware, async (req, res) => {
  const roomId = Number(req.params.id);
  const room = await getRoomById(roomId);
  if (!room) return fail(res, 404, '房间不存在');
  const member = await isRoomMember(roomId, req.user.user_id);
  if (!member) return fail(res, 403, '未加入该房间');
  const conv = await getOrCreateGroupConversation(roomId);
  const cursor = Number(req.query.cursor || 0);
  const keyword = (req.query.keyword || '').toString().trim();
  const params = [conv.id];
  let sql = `SELECT m.*, c.key, u.username AS sender_name, COALESCE(u.avatar_url, '') AS sender_avatar
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             JOIN users u ON u.id = m.sender_id
             WHERE m.conversation_id = ?`;
  if (cursor) {
    sql += ' AND m.created_at < ?';
    params.push(cursor);
  }
  if (keyword) {
    sql += ' AND m.content LIKE ?';
    params.push(`%${keyword}%`);
  }
  sql += ' ORDER BY m.created_at DESC LIMIT 40';
  const rows = await all(sql, params);
  const messages = rows.reverse().map(mapMessage);
  return ok(res, { items: messages, nextCursor: rows.length ? rows[rows.length - 1].created_at : null });
});

app.post('/api/v2/rooms/:id/read', authMiddleware, async (req, res) => {
  const roomId = Number(req.params.id);
  const room = await getRoomById(roomId);
  if (!room) return fail(res, 404, '房间不存在');
  const member = await isRoomMember(roomId, req.user.user_id);
  if (!member) return fail(res, 403, '未加入该房间');
  const conv = await getOrCreateGroupConversation(roomId);
  const at = Number(req.body?.at || now());
  const existing = await get('SELECT conversation_id FROM conversation_last_seen WHERE conversation_id = ? AND user_id = ?', [conv.id, req.user.user_id]);
  if (existing) {
    await run('UPDATE conversation_last_seen SET last_seen_at = ? WHERE conversation_id = ? AND user_id = ?', [at, conv.id, req.user.user_id]);
  } else {
    await run('INSERT INTO conversation_last_seen (conversation_id, user_id, last_seen_at) VALUES (?, ?, ?)', [conv.id, req.user.user_id, at]);
  }
  io.to(`group:${roomId}`).emit('message_read', { roomId, userId: req.user.user_id, at });
  return ok(res, { at }, '已标记已读');
});

app.post('/api/v2/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return fail(res, 400, '未选择文件');
  const ext = path.extname(req.file.originalname).toLowerCase();
  const safeName = `${req.file.filename}${ext}`;
  const target = path.join(UPLOAD_DIR, safeName);
  fs.renameSync(req.file.path, target);
  const mime = req.file.mimetype || 'application/octet-stream';
  const file = { url: `/uploads/${safeName}`, name: req.file.originalname, size: req.file.size, mime };
  return ok(res, file, '上传成功');
});

// Users
app.post('/api/register', async (req, res) => {
  const { username, password, recovery_question, recovery_answer } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '缺少用户名或密码' });
  const exists = await get('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) return res.status(409).json({ error: '用户名已存在' });
  const password_hash = bcrypt.hashSync(password, 10);
  let recovery_answer_hash = null;
  if (recovery_question && recovery_answer) {
    recovery_answer_hash = bcrypt.hashSync(String(recovery_answer), 10);
  }
  const info = await run(
    'INSERT INTO users (username, password_hash, recovery_question, recovery_answer_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    [username, password_hash, recovery_question || null, recovery_answer_hash, now()]
  );
  return res.json({ ok: true, user_id: info.lastID });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '缺少用户名或密码' });
  const user = await get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: '用户名或密码错误' });
  const token = jwt.sign({ user_id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username: user.username } });
});

app.get('/api/users', authMiddleware, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const rows = q
    ? await all('SELECT id, username FROM users WHERE username LIKE ? ORDER BY username LIMIT 50', [`%${q}%`])
    : await all('SELECT id, username FROM users ORDER BY username LIMIT 50');
  res.json(rows);
});

// Password reset via recovery question
app.post('/api/password-reset', async (req, res) => {
  const { username, recovery_answer, new_password } = req.body || {};
  if (!username || !recovery_answer || !new_password) return res.status(400).json({ error: '参数不完整' });
  const user = await get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !user.recovery_answer_hash) return res.status(400).json({ error: '未设置找回问题或用户不存在' });
  const ok = bcrypt.compareSync(String(recovery_answer), user.recovery_answer_hash);
  if (!ok) return res.status(401).json({ error: '找回答案错误' });
  const password_hash = bcrypt.hashSync(new_password, 10);
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, user.id]);
  res.json({ ok: true });
});

// Groups
app.post('/api/groups', authMiddleware, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: '缺少群名称' });
  const info = await run('INSERT INTO groups (name, owner_id, created_at) VALUES (?, ?, ?)', [name, req.user.user_id, now()]);
  const groupId = info.lastID;
  await run('INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', [groupId, req.user.user_id, 'owner', now()]);
  await getOrCreateGroupConversation(groupId);
  res.json({ id: groupId, name });
});

// Request to join group
app.post('/api/groups/:id/request', authMiddleware, async (req, res) => {
  const groupId = Number(req.params.id);
  const group = await get('SELECT * FROM groups WHERE id = ?', [groupId]);
  if (!group) return res.status(404).json({ error: '群不存在' });
  const existingMember = await get('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, req.user.user_id]);
  if (existingMember) return res.json({ ok: true, status: 'member' });
  const reqRow = await get('SELECT * FROM group_join_requests WHERE group_id = ? AND user_id = ?', [groupId, req.user.user_id]);
  if (reqRow && reqRow.status === 'pending') return res.json({ ok: true, status: 'pending' });
  await run('INSERT OR REPLACE INTO group_join_requests (group_id, user_id, status, requested_at, decided_at) VALUES (?, ?, ?, ?, ?)', [groupId, req.user.user_id, 'pending', now(), null]);
  res.json({ ok: true, status: 'pending' });
});

// List pending requests (owner only)
app.get('/api/groups/:id/requests', authMiddleware, async (req, res) => {
  const groupId = Number(req.params.id);
  const group = await get('SELECT id, owner_id FROM groups WHERE id = ?', [groupId]);
  if (!group) return res.status(404).json({ error: '群不存在' });
  if (group.owner_id !== req.user.user_id) return res.status(403).json({ error: '仅群主可查看申请' });
  const rows = await all(`SELECT r.user_id AS id, u.username, r.requested_at FROM group_join_requests r JOIN users u ON u.id = r.user_id WHERE r.group_id = ? AND r.status = 'pending' ORDER BY r.requested_at`, [groupId]);
  res.json(rows);
});

// Approve join request (owner only)
app.post('/api/groups/:id/requests/:user_id/approve', authMiddleware, async (req, res) => {
  const groupId = Number(req.params.id);
  const targetUserId = Number(req.params.user_id);
  const group = await get('SELECT id, owner_id FROM groups WHERE id = ?', [groupId]);
  if (!group) return res.status(404).json({ error: '群不存在' });
  if (group.owner_id !== req.user.user_id) return res.status(403).json({ error: '仅群主可操作' });
  const count = await get('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?', [groupId]);
  if (count.c >= MAX_GROUP_SIZE) return res.status(400).json({ error: '群人数已达上限' });
  await run('UPDATE group_join_requests SET status = ?, decided_at = ? WHERE group_id = ? AND user_id = ?', ['approved', now(), groupId, targetUserId]);
  const existing = await get('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, targetUserId]);
  if (!existing) await run('INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', [groupId, targetUserId, 'member', now()]);
  await getOrCreateGroupConversation(groupId);
  res.json({ ok: true });
});

// Reject join request (owner only)
app.post('/api/groups/:id/requests/:user_id/reject', authMiddleware, async (req, res) => {
  const groupId = Number(req.params.id);
  const targetUserId = Number(req.params.user_id);
  const group = await get('SELECT id, owner_id FROM groups WHERE id = ?', [groupId]);
  if (!group) return res.status(404).json({ error: '群不存在' });
  if (group.owner_id !== req.user.user_id) return res.status(403).json({ error: '仅群主可操作' });
  await run('UPDATE group_join_requests SET status = ?, decided_at = ? WHERE group_id = ? AND user_id = ?', ['rejected', now(), groupId, targetUserId]);
  res.json({ ok: true });
});

// Join group (requires approved request or owner)
app.post('/api/groups/:id/join', authMiddleware, async (req, res) => {
  const groupId = Number(req.params.id);
  const group = await get('SELECT * FROM groups WHERE id = ?', [groupId]);
  if (!group) return res.status(404).json({ error: '群不存在' });
  const count = await get('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?', [groupId]);
  if (count.c >= MAX_GROUP_SIZE) return res.status(400).json({ error: '群人数已达上限' });
  const existing = await get('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, req.user.user_id]);
  if (existing) return res.json({ ok: true });
  if (group.owner_id !== req.user.user_id) {
    const reqRow = await get('SELECT status FROM group_join_requests WHERE group_id = ? AND user_id = ?', [groupId, req.user.user_id]);
    if (!reqRow || reqRow.status !== 'approved') return res.status(403).json({ error: '需要群主同意' });
  }
  await run('INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', [groupId, req.user.user_id, 'member', now()]);
  await getOrCreateGroupConversation(groupId);
  res.json({ ok: true });
});

// Current user info
app.get('/api/me', authMiddleware, async (req, res) => {
  const user = await get('SELECT id, username FROM users WHERE id = ?', [req.user.user_id]);
  res.json(user);
});

// Search groups
app.get('/api/groups', authMiddleware, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const rows = q
    ? await all('SELECT id, name FROM groups WHERE name LIKE ? ORDER BY name LIMIT 50', [`%${q}%`])
    : await all('SELECT id, name FROM groups ORDER BY id DESC LIMIT 50');
  res.json(rows);
});

// Group members
app.get('/api/groups/:id/members', authMiddleware, async (req, res) => {
  const groupId = Number(req.params.id);
  const exists = await get('SELECT id FROM groups WHERE id = ?', [groupId]);
  if (!exists) return res.status(404).json({ error: '群不存在' });
  const rows = await all(
    `SELECT gm.user_id AS id, u.username, gm.role, gm.joined_at
     FROM group_members gm JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ? ORDER BY u.username`,
    [groupId]
  );
  res.json(rows);
});

// Group info
app.get('/api/groups/:id', authMiddleware, async (req, res) => {
  const groupId = Number(req.params.id);
  const row = await get('SELECT id, name, owner_id FROM groups WHERE id = ?', [groupId]);
  if (!row) return res.status(404).json({ error: '群不存在' });
  res.json(row);
});

// Rename group (owner only)
app.put('/api/groups/:id', authMiddleware, async (req, res) => {
  const groupId = Number(req.params.id);
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: '缺少群名称' });
  const group = await get('SELECT id, owner_id FROM groups WHERE id = ?', [groupId]);
  if (!group) return res.status(404).json({ error: '群不存在' });
  if (group.owner_id !== req.user.user_id) return res.status(403).json({ error: '仅群主可修改群名' });
  await run('UPDATE groups SET name = ? WHERE id = ?', [name, groupId]);
  res.json({ ok: true });
});

// Dissolve group (owner only) and delete conversation/messages
app.delete('/api/groups/:id', authMiddleware, async (req, res) => {
  const groupId = Number(req.params.id);
  const group = await get('SELECT id, owner_id FROM groups WHERE id = ?', [groupId]);
  if (!group) return res.status(404).json({ error: '群不存在' });
  if (group.owner_id !== req.user.user_id) return res.status(403).json({ error: '仅群主可解散群聊' });
  await run('DELETE FROM conversations WHERE key = ?', [`group:${groupId}`]);
  await run('DELETE FROM groups WHERE id = ?', [groupId]); // cascades group_members via FK
  res.json({ ok: true });
});

// List conversations for current user with unread counts
app.get('/api/conversations', authMiddleware, async (req, res) => {
  const userId = req.user.user_id;
  const allPriv = await all('SELECT key, id FROM conversations WHERE type = ?', ['private']);
  const privateKeys = allPriv.filter((c) => {
    const [a, b] = c.key.split(':').map(Number);
    return a === userId || b === userId;
  });
  const groupMemberships = await all('SELECT group_id FROM group_members WHERE user_id = ?', [userId]);
  const groupKeys = [];
  for (const gm of groupMemberships) {
    const row = await get('SELECT id, key FROM conversations WHERE key = ?', [`group:${gm.group_id}`]);
    const grp = await get('SELECT name, owner_id FROM groups WHERE id = ?', [gm.group_id]);
    if (row && grp) {
      let pending = 0;
      if (grp.owner_id === userId) {
        const p = await get('SELECT COUNT(*) AS c FROM group_join_requests WHERE group_id = ? AND status = ?', [gm.group_id, 'pending']);
        pending = p ? p.c : 0;
      }
      groupKeys.push({ ...row, name: grp.name, pending });
    } else if (row) {
      groupKeys.push({ ...row, name: `群聊 ${gm.group_id}`, pending: 0 });
    }
  }
  async function unreadFor(conv) {
    const ls = await get('SELECT last_seen_at FROM conversation_last_seen WHERE conversation_id = ? AND user_id = ?', [conv.id, userId]);
    if (!ls) {
      const cnt = await get('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND sender_id != ?', [conv.id, userId]);
      return cnt.c;
    }
    const cnt = await get('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND created_at > ? AND sender_id != ?', [conv.id, ls.last_seen_at, userId]);
    return cnt.c;
  }
  const priv = [];
  for (const c of privateKeys) {
    priv.push({ ...c, unread: await unreadFor(c) });
  }
  const grps = [];
  for (const c of groupKeys) {
    grps.push({ ...c, unread: await unreadFor(c) });
  }
  res.json({ private: priv, groups: grps });
});

// Messages history
app.get('/api/messages', authMiddleware, async (req, res) => {
  const { type, key, cursor } = req.query;
  if (!type || !key) return res.status(400).json({ error: '参数不完整' });
  const conv = await get('SELECT * FROM conversations WHERE type = ? AND key = ?', [type, key]);
  if (!conv) return res.status(404).json({ error: '会话不存在' });
  const rows = cursor
    ? await all('SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 50', [conv.id, Number(cursor)])
    : await all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 50', [conv.id]);
  res.json(rows.reverse());
});

// Set last seen for conversation
app.post('/api/conversations/seen', authMiddleware, async (req, res) => {
  const { type, key } = req.body || {};
  if (!type || !key) return res.status(400).json({ error: '参数不完整' });
  const conv = await get('SELECT id FROM conversations WHERE type = ? AND key = ?', [type, key]);
  if (!conv) return res.status(404).json({ error: '会话不存在' });
  const when = now();
  const existing = await get('SELECT * FROM conversation_last_seen WHERE conversation_id = ? AND user_id = ?', [conv.id, req.user.user_id]);
  if (existing) {
    await run('UPDATE conversation_last_seen SET last_seen_at = ? WHERE conversation_id = ? AND user_id = ?', [when, conv.id, req.user.user_id]);
  } else {
    await run('INSERT INTO conversation_last_seen (conversation_id, user_id, last_seen_at) VALUES (?, ?, ?)', [conv.id, req.user.user_id, when]);
  }
  res.json({ ok: true, last_seen_at: when });
});
// Upload image
app.post('/api/upload', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  if (!allowed.includes(ext)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: '不支持的图片类型' });
  }
  const newName = `${req.file.filename}${ext}`;
  const newPath = path.join(UPLOAD_DIR, newName);
  fs.renameSync(req.file.path, newPath);
  const url = `/uploads/${newName}`;
  res.json({ url });
});

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('未授权'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload;
    next();
  } catch {
    next(new Error('令牌无效'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.user_id;
  const sockets = onlineUsers.get(userId) || new Set();
  sockets.add(socket.id);
  onlineUsers.set(userId, sockets);
  io.emit('user_online', { user_id: userId });

  socket.on('join_group', async (groupId) => {
    const member = await get('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
    if (!member) return;
    socket.join(`group:${groupId}`);
  });

  socket.on('leave_group', (groupId) => {
    socket.leave(`group:${groupId}`);
  });

  socket.on('private_message', async ({ to_user_id, message_type, content }) => {
    const toId = Number(to_user_id);
    if (!toId || !content) return;
    const conv = await getOrCreatePrivateConversation(userId, toId);
    const info = await run('INSERT INTO messages (conversation_id, sender_id, message_type, content, created_at) VALUES (?, ?, ?, ?, ?)', [conv.id, userId, message_type || 'text', content, now()]);
    const payload = { id: info.lastID, conversation_id: conv.id, sender_id: userId, message_type: message_type || 'text', content, created_at: now() };
    socket.emit('private_message', { to_user_id: toId, message: payload });
    const toSocketIds = onlineUsers.get(toId);
    if (toSocketIds) {
      for (const sid of toSocketIds) io.to(sid).emit('private_message', { from_user_id: userId, message: payload });
    }
  });

  socket.on('group_message', async ({ group_id, message_type, content }) => {
    const groupId = Number(group_id);
    if (!groupId || !content) return;
    const member = await get('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
    if (!member) return;
    const conv = await getOrCreateGroupConversation(groupId);
    const info = await run('INSERT INTO messages (conversation_id, sender_id, message_type, content, created_at) VALUES (?, ?, ?, ?, ?)', [conv.id, userId, message_type || 'text', content, now()]);
    const payload = { id: info.lastID, conversation_id: conv.id, sender_id: userId, message_type: message_type || 'text', content, created_at: now() };
    io.to(`group:${groupId}`).emit('group_message', { group_id: groupId, message: payload });
  });

  socket.on('join_room', async ({ roomId }, ack) => {
    const id = Number(roomId);
    const member = await get('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?', [id, userId]);
    if (!member) {
      if (ack) ack({ ok: false, message: '未加入房间' });
      return;
    }
    socket.join(`group:${id}`);
    if (ack) ack({ ok: true, message: 'ok', data: { roomId: id } });
  });

  socket.on('leave_room', ({ roomId }, ack) => {
    const id = Number(roomId);
    socket.leave(`group:${id}`);
    if (ack) ack({ ok: true, message: 'ok', data: { roomId: id } });
  });

  socket.on('message_send', async (payload, ack) => {
    const roomId = Number(payload?.roomId);
    const type = payload?.type || 'text';
    const content = (payload?.content || '').toString();
    if (!roomId || !content) {
      if (ack) ack({ ok: false, message: '参数不完整' });
      return;
    }
    const member = await get('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?', [roomId, userId]);
    if (!member) {
      if (ack) ack({ ok: false, message: '未加入房间' });
      return;
    }
    const conv = await getOrCreateGroupConversation(roomId);
    const createdAt = now();
    const extra = JSON.stringify(payload?.extra || {});
    const info = await run(
      'INSERT INTO messages (conversation_id, sender_id, message_type, content, extra, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [conv.id, userId, type, content, extra, createdAt]
    );
    const row = await get(
      `SELECT m.*, c.key, u.username AS sender_name, COALESCE(u.avatar_url, '') AS sender_avatar
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN users u ON u.id = m.sender_id
       WHERE m.id = ?`,
      [info.lastID]
    );
    const msg = mapMessage(row);
    io.to(`group:${roomId}`).emit('message_receive', msg);
    if (ack) ack({ ok: true, message: 'ok', data: msg });
  });

  socket.on('direct_message_send', async (payload, ack) => {
    const peerId = Number(payload?.peerId);
    const type = payload?.type || 'text';
    const content = (payload?.content || '').toString();
    if (!peerId || !content || peerId === userId) {
      if (ack) ack({ ok: false, message: '参数不完整' });
      return;
    }
    const peer = await get('SELECT id FROM users WHERE id = ?', [peerId]);
    if (!peer) {
      if (ack) ack({ ok: false, message: '用户不存在' });
      return;
    }
    const conv = await getOrCreatePrivateConversation(userId, peerId);
    const createdAt = now();
    const extra = JSON.stringify(payload?.extra || {});
    const info = await run(
      'INSERT INTO messages (conversation_id, sender_id, message_type, content, extra, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [conv.id, userId, type, content, extra, createdAt]
    );
    const row = await get(
      `SELECT m.*, c.key, u.username AS sender_name, COALESCE(u.avatar_url, '') AS sender_avatar
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN users u ON u.id = m.sender_id
       WHERE m.id = ?`,
      [info.lastID]
    );
    const messageForSender = mapDirectMessage(row, userId);
    const messageForPeer = mapDirectMessage(row, peerId);
    socket.emit('direct_message_receive', messageForSender);
    const peerSocketIds = onlineUsers.get(peerId);
    if (peerSocketIds) {
      for (const sid of peerSocketIds) io.to(sid).emit('direct_message_receive', messageForPeer);
    }
    if (ack) ack({ ok: true, message: 'ok', data: messageForSender });
  });

  socket.on('typing', async ({ roomId, isTyping }, ack) => {
    const id = Number(roomId);
    const member = await get('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?', [id, userId]);
    if (!member) {
      if (ack) ack({ ok: false, message: '未加入房间' });
      return;
    }
    socket.to(`group:${id}`).emit('typing', { roomId: id, userId, isTyping: Boolean(isTyping), at: now() });
    if (ack) ack({ ok: true, message: 'ok', data: { roomId: id } });
  });

  socket.on('message_read', async ({ roomId, at }, ack) => {
    const id = Number(roomId);
    const member = await get('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?', [id, userId]);
    if (!member) {
      if (ack) ack({ ok: false, message: '未加入房间' });
      return;
    }
    const conv = await getOrCreateGroupConversation(id);
    const readAt = Number(at || now());
    const existing = await get('SELECT conversation_id FROM conversation_last_seen WHERE conversation_id = ? AND user_id = ?', [conv.id, userId]);
    if (existing) {
      await run('UPDATE conversation_last_seen SET last_seen_at = ? WHERE conversation_id = ? AND user_id = ?', [readAt, conv.id, userId]);
    } else {
      await run('INSERT INTO conversation_last_seen (conversation_id, user_id, last_seen_at) VALUES (?, ?, ?)', [conv.id, userId, readAt]);
    }
    io.to(`group:${id}`).emit('message_read', { roomId: id, userId, at: readAt });
    if (ack) ack({ ok: true, message: 'ok', data: { roomId: id, at: readAt } });
  });

  socket.on('message_recall', async ({ roomId, messageId }, ack) => {
    const id = Number(roomId);
    const mid = Number(messageId);
    if (!id || !mid) {
      if (ack) ack({ ok: false, message: '参数不完整' });
      return;
    }
    const conv = await getOrCreateGroupConversation(id);
    const message = await get('SELECT * FROM messages WHERE id = ? AND conversation_id = ?', [mid, conv.id]);
    if (!message) {
      if (ack) ack({ ok: false, message: '消息不存在' });
      return;
    }
    if (message.sender_id !== userId) {
      if (ack) ack({ ok: false, message: '仅发送者可撤回' });
      return;
    }
    const deletedAt = now();
    await run('UPDATE messages SET deleted_at = ?, message_type = ?, content = ? WHERE id = ?', [deletedAt, 'recall', '该消息已撤回', mid]);
    const recalled = { id: mid, roomId: id, deletedAt, type: 'recall', content: '该消息已撤回' };
    io.to(`group:${id}`).emit('message_recalled', recalled);
    if (ack) ack({ ok: true, message: 'ok', data: recalled });
  });

  socket.on('presence_sync', async ({ status }, ack) => {
    if (!status) {
      if (ack) ack({ ok: false, message: '状态不能为空' });
      return;
    }
    await run('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
    io.emit('presence_sync', { userId, status });
    if (ack) ack({ ok: true, message: 'ok', data: { userId, status } });
  });

  socket.on('disconnect', () => {
    const set = onlineUsers.get(userId);
    if (set) {
      set.delete(socket.id);
      if (!set.size) {
        onlineUsers.delete(userId);
        io.emit('user_offline', { user_id: userId });
      } else {
        onlineUsers.set(userId, set);
      }
    }
  });
});

// const PORT = process.env.PORT || 3000;
// server.listen(PORT, () => {
//   console.log(`Light chat running at http://localhost:${PORT}`);
// });
module.exports = app;
